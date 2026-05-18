import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";

import { moderateImage, type ModerationVerdict } from "../lib/moderation";

/**
 * Payload passed into the workflow when a session starts.
 * The selfie itself isn't passed inline — it's uploaded to R2 first and
 * referenced by key, because workflow payloads must be JSON-serializable
 * and stay small.
 */
export type CaricaturePayload = {
	sessionId: string;
	selfieKey?: string; // R2 key under the BUCKET binding
	note?: string;
};

export type ModerateStepOutput = ModerationVerdict & {
	selfieKey: string;
	selfieSize: number;
};

/**
 * Caricature pipeline.
 *
 * Step 4.1: bare skeleton (hello).
 * Step 4.2 (this commit): adds a real moderate step using Llama 3.2 Vision.
 *   - reads the selfie bytes from R2
 *   - runs the moderation model
 *   - throws if unsafe (which surfaces as instance status "errored")
 *
 * Upcoming steps will append generate / composite / store / notify.
 */
export class CaricatureWorkflow extends WorkflowEntrypoint<Env, CaricaturePayload> {
	async run(event: WorkflowEvent<CaricaturePayload>, step: WorkflowStep) {
		const { sessionId, selfieKey, note } = event.payload;

		// Hello step is preserved for now so the skeleton test endpoint still works.
		const hello = await step.do("hello", async () => {
			console.log(
				`[caricature-workflow] session=${sessionId}` +
					(note ? ` note=${note}` : "") +
					(selfieKey ? ` selfieKey=${selfieKey}` : ""),
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

		return { hello, moderate };
	}
}
