import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";

import { moderateImage, type ModerationVerdict } from "../lib/moderation";
import { runFlux } from "../lib/flux";
import { loadSceneById } from "../lib/scenes";

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

/**
 * Caricature pipeline.
 *
 * Step 4.1: bare skeleton (hello).
 * Step 4.2: moderate step using Llama 3.2 Vision.
 * Step 4.3 (this commit): generate step — runs FLUX.2 i2i on the selfie with
 *   the chosen scene's prompt, saves the result to R2.
 *
 *   The step is configured with 2 retries (exponential backoff) since FLUX
 *   calls can occasionally time out / 5xx during peak load.
 *
 * Upcoming steps will append composite / store / notify.
 */
export class CaricatureWorkflow extends WorkflowEntrypoint<Env, CaricaturePayload> {
	async run(event: WorkflowEvent<CaricaturePayload>, step: WorkflowStep) {
		const { sessionId, selfieKey, sceneId, note } = event.payload;

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

		return { hello, moderate, generate };
	}
}
