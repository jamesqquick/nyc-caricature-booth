/**
 * SessionDO — one Durable Object per caricature session.
 *
 * Identified by `idFromName(sessionId)` so any code with the sessionId can
 * reach the same instance.
 *
 * Responsibilities (built up across phase 5):
 *   - 5.1 (this commit): hold the live status of a session (queued, moderating,
 *     generating, compositing, done, errored). Permissive setStatus for now;
 *     5.2 locks down transitions.
 *   - 5.2: validated state machine + per-step payloads + self-delete alarm.
 *   - 5.3: WebSocket fan-out so iPad/phone can subscribe live.
 *   - 5.4: workflow drives state changes from each step.
 *
 * Storage shape: KV-style. The whole SessionState object lives under one key
 * ("state") so reads/writes are atomic. We still register the DO with
 * `new_sqlite_classes` in wrangler.jsonc so we can later add SQL tables
 * (e.g. a per-session event log) without a class-replacement migration.
 */

import { DurableObject } from "cloudflare:workers";

export type SessionStatus =
	| "queued"
	| "moderating"
	| "generating"
	| "compositing"
	| "done"
	| "errored";

export type SessionState = {
	sessionId: string;
	status: SessionStatus;
	createdAt: number; // ms epoch
	updatedAt: number; // ms epoch
};

const STATE_KEY = "state";

export class SessionDO extends DurableObject<Env> {
	/**
	 * Returns the current state. Initializes a row on first access so callers
	 * don't have to call setStatus before getState.
	 */
	async getState(sessionId?: string): Promise<SessionState> {
		const existing = await this.ctx.storage.get<SessionState>(STATE_KEY);
		if (existing) return existing;

		// First touch: seed with the sessionId we were called with (if any).
		const now = Date.now();
		const seeded: SessionState = {
			sessionId: sessionId ?? "(unset)",
			status: "queued",
			createdAt: now,
			updatedAt: now,
		};
		await this.ctx.storage.put(STATE_KEY, seeded);
		return seeded;
	}

	/**
	 * Step 5.1: permissive status setter — accepts any SessionStatus, no
	 * transition validation. Step 5.2 replaces this with `markStep`.
	 *
	 * If the row hasn't been seeded yet, we seed it with the provided
	 * sessionId so the first call doubles as the initializer.
	 */
	async setStatus(
		status: SessionStatus,
		sessionId?: string,
	): Promise<SessionState> {
		const now = Date.now();
		const existing = await this.ctx.storage.get<SessionState>(STATE_KEY);
		const next: SessionState = existing
			? { ...existing, status, updatedAt: now }
			: {
					sessionId: sessionId ?? "(unset)",
					status,
					createdAt: now,
					updatedAt: now,
				};
		await this.ctx.storage.put(STATE_KEY, next);
		return next;
	}
}
