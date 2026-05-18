import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";

import { moderateImage, type ModerationVerdict } from "../lib/moderation";
import { runFlux } from "../lib/flux";
import { loadSceneById } from "../lib/scenes";
import { buildPostcard } from "../lib/postcard";

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
 * Step 4.4 (this commit): composite + store.
 *   - composite: build the 1800x1200 postcard (caricature + watermark + QR
 *     pointing at /p/<sessionId>), save to R2.
 *   - store: upsert a sessions row in D1 with every artifact key.
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
		if (!selfieKey) {
			return { hello };
		}

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
					// Throwing fails the step (and the workflow) with this message.
					throw new Error(
						`moderation rejected selfie: ${verdict.reasons.join("; ")}`,
					);
				}

				return { ...verdict, selfieKey, selfieSize: bytes.byteLength };
			},
		);

		// No sceneId => stop after moderation (back-compat with step 4.2).
		if (!sceneId) {
			return { hello, moderate };
		}

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

				// QR url: prefer the explicit origin passed in payload, otherwise
				// emit a relative path so the post-event pickup page still works
				// even if the host moves.
				const origin = publicOrigin?.replace(/\/$/, "") ?? "";
				const postcardUrl = `${origin}/p/${sessionId}`;

				const response = await buildPostcard(this.env, caricature.body, {
					qrUrl: postcardUrl,
				});
				if (!response.ok)
					throw new Error(
						`postcard build failed: HTTP ${response.status}`,
					);
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
				// Upsert: a row may already exist (e.g. if the workflow was
				// retried after the store step failed). ON CONFLICT replaces
				// every artifact field with the latest values.
				const result = await this.env.DB.prepare(
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

				const rowsWritten = result.meta.changes ?? 0;
				console.log(
					`[caricature-workflow] store session=${sessionId} rowsWritten=${rowsWritten}`,
				);

				return { sessionId, rowsWritten };
			},
		);

		return { hello, moderate, generate, composite, store };
	}
}
