import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";

import { moderateImage, type ModerationVerdict } from "../lib/moderation";
import { runFlux } from "../lib/flux";
import { loadSceneById } from "../lib/scenes";
import { buildPostcard } from "../lib/postcard";
import type {
	MarkStepPayload,
	SessionStatus,
} from "../session/session";

/**
 * Payload passed into the workflow when a session starts.
 * The selfie itself isn't passed inline — it's uploaded to R2 first and
 * referenced by key, because workflow payloads must be JSON-serializable
 * and stay small.
 */
export type CaricaturePayload = {
	sessionId: string;
	selfieKey?: string; // R2 key under the BUCKET binding
	sceneId?: string; // id matching seed/scenes.json
	publicOrigin?: string; // e.g. https://nyc-caricature-booth.examples.workers.dev
	note?: string;
};

export type ModerateStepOutput = ModerationVerdict & {
	selfieKey: string;
	selfieSize: number;
};

export type GenerateStepOutput = {
	caricatureKey: string;
	sceneId: string;
	sceneName: string;
	contentType: string;
	bytes: number;
	elapsedMs: number;
};

export type CompositeStepOutput = {
	postcardKey: string;
	postcardUrl: string;
	bytes: number;
	elapsedMs: number;
};

export type StoreStepOutput = {
	sessionId: string;
	rowsWritten: number;
};

/**
 * Caricature pipeline.
 *
 * Step 4.1: bare skeleton (hello).
 * Step 4.2: moderate step using Llama 3.2 Vision.
 * Step 4.3: generate step (FLUX.2 i2i) with retries.
 * Step 4.4: composite + store (full pipeline).
 * Step 5.4 (this commit): push live state to the SessionDO between every
 *   workflow step so iPad / phone clients can subscribe via WebSocket.
 *   The DO is best-effort UX, NOT the source of truth — markStep failures
 *   are caught and logged so they can't break the workflow itself.
 *
 * Upcoming: print queue, email notify.
 */
export class CaricatureWorkflow extends WorkflowEntrypoint<Env, CaricaturePayload> {
	async run(event: WorkflowEvent<CaricaturePayload>, step: WorkflowStep) {
		const { sessionId, selfieKey, sceneId, publicOrigin, note } = event.payload;
		const instanceId = event.instanceId;

		// Hello step is preserved for now so the skeleton test endpoint still works.
		const hello = await step.do("hello", async () => {
			console.log(
				`[caricature-workflow] session=${sessionId}` +
					(note ? ` note=${note}` : "") +
					(selfieKey ? ` selfieKey=${selfieKey}` : "") +
					(sceneId ? ` sceneId=${sceneId}` : ""),
			);
			return {
				greeting: "hello",
				sessionId,
				at: new Date().toISOString(),
			};
		});

		// No selfieKey => skeleton-only invocation (back-compat with step 4.1).
		// No DO involvement: nothing happened that's worth broadcasting.
		if (!selfieKey) {
			return { hello };
		}

		// All real work below pushes status into the SessionDO. The wrapping
		// try / catch / finally guarantees a terminal state lands in the DO
		// (either `done` after store, or `errored` on any throw) and that
		// the DO is cleaned up afterwards.
		try {
			await this.markSession(sessionId, "moderating", { selfieKey });

			const moderate: ModerateStepOutput = await step.do(
				"moderate",
				{
					retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
					timeout: "1 minute",
				},
				async () => {
					const obj = await this.env.BUCKET.get(selfieKey);
					if (!obj) throw new Error(`selfie not found in R2: ${selfieKey}`);
					const bytes = new Uint8Array(await obj.arrayBuffer());
					const verdict = await moderateImage(this.env.AI, bytes);

					console.log(
						`[caricature-workflow] moderation session=${sessionId} safe=${verdict.safe} elapsedMs=${verdict.elapsedMs}`,
					);

					if (!verdict.safe) {
						// Mark session with a specific, user-facing error message
						// instead of throwing raw. The kiosk status screen and
						// /p/:id check for "moderation rejected" to show tailored
						// copy. The raw reasons are logged for staff debugging.
						const rawReasons = verdict.reasons.join("; ");
						console.warn(
							`[caricature-workflow] moderation rejected session=${sessionId} reasons=${rawReasons}`,
						);
						await this.markSession(sessionId, "errored", {
							error: `moderation rejected selfie: ${rawReasons}`,
						});
						throw new Error(
							`moderation rejected selfie: ${rawReasons}`,
						);
					}

					return { ...verdict, selfieKey, selfieSize: bytes.byteLength };
				},
			);

			// No sceneId => stop after moderation (back-compat with step 4.2).
			// We don't reach a terminal DO state here — the workflow just
			// finishes early. The DO will self-delete via its 5-min alarm.
			if (!sceneId) {
				return { hello, moderate };
			}

			await this.markSession(sessionId, "generating", {
				elapsedMs: moderate.elapsedMs,
			});

			const generate: GenerateStepOutput = await step.do(
				"generate",
				{
					retries: { limit: 2, delay: "3 seconds", backoff: "exponential" },
					timeout: "2 minutes",
				},
				async () => {
					const scene = await loadSceneById(this.env, sceneId);

					const obj = await this.env.BUCKET.get(selfieKey);
					if (!obj) throw new Error(`selfie not found in R2: ${selfieKey}`);
					const selfieBytes = await obj.arrayBuffer();
					const selfieType = obj.httpMetadata?.contentType || "image/jpeg";

					const { bytes, contentType, elapsedMs } = await runFlux(this.env.AI, {
						prompt: scene.prompt,
						selfieBytes,
						selfieType,
					});

					const ext = contentType === "image/png" ? "png" : "jpg";
					const caricatureKey = `runs/${sessionId}/caricature.${ext}`;

					await this.env.BUCKET.put(caricatureKey, bytes, {
						httpMetadata: { contentType },
						customMetadata: {
							sessionId,
							sceneId: scene.id,
							sceneName: scene.name,
							elapsedMs: String(elapsedMs),
						},
					});

					console.log(
						`[caricature-workflow] generate session=${sessionId} scene=${scene.id} bytes=${bytes.byteLength} elapsedMs=${elapsedMs}`,
					);

					return {
						caricatureKey,
						sceneId: scene.id,
						sceneName: scene.name,
						contentType,
						bytes: bytes.byteLength,
						elapsedMs,
					};
				},
			);

			await this.markSession(sessionId, "compositing", {
				sceneId: generate.sceneId,
				sceneName: generate.sceneName,
				caricatureKey: generate.caricatureKey,
				elapsedMs: generate.elapsedMs,
			});

			const composite: CompositeStepOutput = await step.do(
				"composite",
				{
					retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
					timeout: "1 minute",
				},
				async () => {
					const started = Date.now();

					const caricature = await this.env.BUCKET.get(generate.caricatureKey);
					if (!caricature)
						throw new Error(
							`caricature not found in R2: ${generate.caricatureKey}`,
						);
					if (!caricature.body)
						throw new Error(
							`caricature has no body: ${generate.caricatureKey}`,
						);

				const origin = publicOrigin?.replace(/\/$/, "") ?? "";
				const postcardUrl = `${origin}/p/${sessionId}`;

				// QR removed from printed postcard (step 6.6). Users scan the
				// QR on the kiosk done screen instead; the printed postcard is
				// just caricature + watermark.
				const response = await buildPostcard(this.env, caricature.body);
					if (!response.ok)
						throw new Error(`postcard build failed: HTTP ${response.status}`);
					const postcardBytes = new Uint8Array(await response.arrayBuffer());

					const postcardKey = `runs/${sessionId}/postcard.jpg`;
					await this.env.BUCKET.put(postcardKey, postcardBytes, {
						httpMetadata: { contentType: "image/jpeg" },
						customMetadata: {
							sessionId,
							sceneId: generate.sceneId,
							sceneName: generate.sceneName,
							postcardUrl,
						},
					});

					const elapsedMs = Date.now() - started;
					console.log(
						`[caricature-workflow] composite session=${sessionId} bytes=${postcardBytes.byteLength} elapsedMs=${elapsedMs}`,
					);

					return {
						postcardKey,
						postcardUrl,
						bytes: postcardBytes.byteLength,
						elapsedMs,
					};
				},
			);

			const store: StoreStepOutput = await step.do(
				"store",
				{
					retries: { limit: 3, delay: "1 second", backoff: "exponential" },
					timeout: "30 seconds",
				},
				async () => {
					// Print job is NOT enqueued here anymore — printing is now
					// user-initiated from the /kiosk/done screen via POST
					// /api/kiosk/print. Workflow's only D1 write is the session
					// upsert. Attendees who only want the digital copy never
					// produce a print_jobs row.
					const sessionResult = await this.env.DB.prepare(
						`INSERT INTO sessions
							(id, status, scene_id, scene_name, selfie_key, caricature_key, postcard_key, workflow_instance_id, completed_at)
						 VALUES (?, 'completed', ?, ?, ?, ?, ?, ?, unixepoch())
						 ON CONFLICT(id) DO UPDATE SET
							status='completed',
							scene_id=excluded.scene_id,
							scene_name=excluded.scene_name,
							selfie_key=excluded.selfie_key,
							caricature_key=excluded.caricature_key,
							postcard_key=excluded.postcard_key,
							workflow_instance_id=excluded.workflow_instance_id,
							completed_at=excluded.completed_at,
							error_msg=NULL`,
					)
						.bind(
							sessionId,
							generate.sceneId,
							generate.sceneName,
							selfieKey,
							generate.caricatureKey,
							composite.postcardKey,
							instanceId,
						)
						.run();

					const rowsWritten = sessionResult.meta.changes ?? 0;
					console.log(
						`[caricature-workflow] store session=${sessionId} rowsWritten=${rowsWritten} printJob=deferred`,
					);

					return { sessionId, rowsWritten };
				},
			);

			// Terminal: push the full set of artifact keys into the DO so any
			// final WS frame contains everything a client needs to render the
			// done screen, even if it just connected.
			await this.markSession(sessionId, "done", {
				postcardKey: composite.postcardKey,
				postcardUrl: composite.postcardUrl,
				elapsedMs: composite.elapsedMs,
			});

			return { hello, moderate, generate, composite, store };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(
				`[caricature-workflow] failed session=${sessionId} err=${message}`,
			);
			await this.markSession(sessionId, "errored", { error: message });

			// Persist the error in D1 so /p/:id can display a user-facing
			// error state even after the DO self-deletes. Uses ON CONFLICT
			// so it works regardless of whether the session row already exists.
			try {
				await this.env.DB.prepare(
					`INSERT INTO sessions (id, status, error_msg, scene_id)
					 VALUES (?, 'errored', ?, ?)
					 ON CONFLICT(id) DO UPDATE SET
						status='errored',
						error_msg=excluded.error_msg`,
				)
					.bind(sessionId, message, sceneId ?? null)
					.run();
			} catch (dbErr) {
				console.warn(
					`[caricature-workflow] failed to persist error to D1 session=${sessionId}: ${String(dbErr)}`,
				);
			}

			// Re-throw so the workflow instance itself ends in `errored` state.
			throw err;
		}
		// NOTE: we don't explicitly delete the session DO here. Both
		// markStep('done') and markStep('errored') schedule the DO's 5-min
		// self-delete alarm, which is the grace window that lets late
		// connectors (or page refreshes) see the final state.
	}

	// -------- SessionDO helpers --------
	//
	// These are intentionally NOT wrapped in `step.do` — we don't want them
	// participating in workflow durability / retries. They're best-effort UX
	// pushes; if they fail the workflow continues regardless.

	private async markSession(
		sessionId: string,
		next: SessionStatus,
		payload: MarkStepPayload = {},
	): Promise<void> {
		try {
			const id = this.env.SESSION.idFromName(sessionId);
			const stub = this.env.SESSION.get(id);
			await stub.markStep(next, payload, sessionId);
		} catch (err) {
			// Swallow: DO updates are best-effort. An invalid transition or
			// a DO crash should never break the workflow.
			console.warn(
				`[caricature-workflow] markSession failed session=${sessionId} next=${next}: ${String(err)}`,
			);
		}
	}

}
