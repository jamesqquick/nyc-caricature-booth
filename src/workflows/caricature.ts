import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";

/**
 * Payload passed into the workflow when a session starts.
 * Will grow as we add real steps (moderation, generation, composition, store).
 * For step 4.1 we only need the bare minimum to test the plumbing.
 */
export type CaricaturePayload = {
	sessionId: string;
	note?: string;
};

/**
 * Bare workflow skeleton — just one step that logs and returns a value.
 * We'll grow this in steps 4.2-4.4.
 */
export class CaricatureWorkflow extends WorkflowEntrypoint<Env, CaricaturePayload> {
	async run(event: WorkflowEvent<CaricaturePayload>, step: WorkflowStep) {
		const hello = await step.do("hello", async () => {
			console.log(
				`[caricature-workflow] hello from session ${event.payload.sessionId}` +
					(event.payload.note ? ` (note: ${event.payload.note})` : ""),
			);
			return {
				greeting: "hello",
				sessionId: event.payload.sessionId,
				at: new Date().toISOString(),
			};
		});

		return hello;
	}
}
