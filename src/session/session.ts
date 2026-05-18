/**
 * SessionDO — one Durable Object per caricature session.
 *
 * Identified by `idFromName(sessionId)` so any code with the sessionId can
 * reach the same instance.
 *
 * Phase 5 buildup:
 *   - 5.1: bare DO with permissive setStatus.
 *   - 5.2: validated state machine + per-step payloads + self-delete alarm.
 *   - 5.3 (this commit): WebSocket fan-out so iPad/phone can subscribe live.
 *     Uses the Hibernation API so idle sessions don't keep the DO in memory.
 *   - 5.4: workflow drives state changes from each step.
 *
 * State machine (strict):
 *
 *   queued ──► moderating ──► generating ──► compositing ──► done
 *      └──────────────┴──────────────┴──────────────┴───────► errored
 *
 * Any non-terminal state may transition directly to `errored`. From `done`
 * or `errored` no further transitions are allowed (the DO is about to
 * delete itself).
 *
 * Lifecycle: when status becomes `done` or `errored`, the DO sets an alarm
 * 5 minutes out. The alarm clears storage so the DO becomes effectively
 * deleted. This gives clients a grace window to see the final state and
 * survives the workflow crashing after it finished its real work.
 *
 * Storage: KV-style (the whole SessionState under one key) so reads/writes
 * are atomic. The DO is still registered with `new_sqlite_classes` so we
 * can add SQL tables later without a class-replacement migration.
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

	// Per-step payloads, populated as the workflow progresses.
	sceneId?: string;
	sceneName?: string;
	selfieKey?: string;
	caricatureKey?: string;
	postcardKey?: string;
	postcardUrl?: string;

	// Set when status === 'errored'.
	error?: string;

	// step name -> elapsed ms for that step
	timings?: Record<string, number>;
};

/**
 * Payload accepted by markStep. Only the fields relevant to a given step
 * need to be passed; everything is merged into SessionState.
 */
export type MarkStepPayload = {
	sceneId?: string;
	sceneName?: string;
	selfieKey?: string;
	caricatureKey?: string;
	postcardKey?: string;
	postcardUrl?: string;
	error?: string;
	elapsedMs?: number;
};

const STATE_KEY = "state";
const SELF_DELETE_GRACE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Valid forward transitions. errored is allowed from any non-terminal state.
 */
const TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
	queued: ["moderating", "errored"],
	moderating: ["generating", "errored"],
	generating: ["compositing", "errored"],
	compositing: ["done", "errored"],
	done: [],
	errored: [],
};

export class InvalidTransitionError extends Error {
	constructor(from: SessionStatus, to: SessionStatus) {
		super(`invalid session transition: ${from} → ${to}`);
		this.name = "InvalidTransitionError";
	}
}

const TERMINAL: ReadonlySet<SessionStatus> = new Set(["done", "errored"]);

/**
 * Message shape pushed to connected WebSocket clients.
 */
export type SessionWsMessage =
	| { type: "state"; state: SessionState }
	| { type: "deleted"; sessionId: string };

export class SessionDO extends DurableObject<Env> {
	/**
	 * Handles the WebSocket upgrade request proxied from the Worker.
	 * Path-agnostic: any GET with Upgrade: websocket is accepted.
	 */
	override async fetch(request: Request): Promise<Response> {
		const upgrade = request.headers.get("Upgrade");
		if (upgrade !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

		// Accept via hibernation API so the DO can be evicted between events
		// while connections stay open. webSocketMessage / webSocketClose are
		// the inbound handlers below.
		this.ctx.acceptWebSocket(server);

		// Send the current state immediately so the client has something to
		// render on connect (avoid an extra HTTP round-trip).
		try {
			const state = await this.ensureState();
			server.send(JSON.stringify({ type: "state", state }));
		} catch (err) {
			console.error("[SessionDO] failed to send initial state:", err);
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	/**
	 * Inbound message handler. Currently we only support a tiny RPC:
	 *   - "ping" → "pong"
	 *   - "get-state" → emits a fresh state frame to this socket
	 * Anything else is ignored (we don't expect clients to drive state).
	 */
	async webSocketMessage(
		ws: WebSocket,
		message: ArrayBuffer | string,
	): Promise<void> {
		const text =
			typeof message === "string"
				? message
				: new TextDecoder().decode(message);
		const trimmed = text.trim();
		if (trimmed === "ping") {
			ws.send("pong");
			return;
		}
		if (trimmed === "get-state") {
			const state = await this.ensureState();
			ws.send(JSON.stringify({ type: "state", state }));
			return;
		}
	}

	/**
	 * Close handler. The runtime's web_socket_auto_reply_to_close handles
	 * the close frame for us under compat dates >= 2026-04-07, but we leave
	 * a defensive close() in place anyway.
	 */
	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
	): Promise<void> {
		try {
			ws.close(code, reason);
		} catch {
			// already closed
		}
	}

	async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
		console.error("[SessionDO] websocket error:", error);
	}

	/**
	 * Returns current state. Initializes a queued row on first access so
	 * callers don't have to mark a step before reading.
	 */
	async getState(sessionId?: string): Promise<SessionState> {
		return await this.ensureState(sessionId);
	}

	/**
	 * Advances the state machine to `next` and merges any payload fields.
	 * Throws `InvalidTransitionError` if the transition isn't allowed.
	 *
	 * Side effect: when `next` is a terminal status (done / errored) we
	 * schedule the self-delete alarm.
	 */
	async markStep(
		next: SessionStatus,
		payload: MarkStepPayload = {},
		sessionId?: string,
	): Promise<SessionState> {
		const current = await this.ensureState(sessionId);

		// Same status: treat as an idempotent payload merge (no transition,
		// no error). Useful for retries that re-call the same step.
		if (current.status !== next) {
			const allowed = TRANSITIONS[current.status] ?? [];
			if (!allowed.includes(next)) {
				throw new InvalidTransitionError(current.status, next);
			}
		}

		const now = Date.now();
		const timings = { ...(current.timings ?? {}) };
		if (typeof payload.elapsedMs === "number") {
			timings[next] = payload.elapsedMs;
		}

		// elapsedMs is folded into timings; don't persist it as a top-level field.
		const { elapsedMs: _unused, ...payloadWithoutElapsed } = payload;
		void _unused;

		const merged: SessionState = {
			...current,
			...stripUndefined(payloadWithoutElapsed),
			status: next,
			updatedAt: now,
			timings,
		};

		await this.ctx.storage.put(STATE_KEY, merged);

		this.broadcast({ type: "state", state: merged });

		if (TERMINAL.has(next)) {
			await this.scheduleSelfDelete();
		}

		return merged;
	}

	/**
	 * Explicitly tears down this DO instance's storage. The workflow can
	 * call this directly if it wants to clean up immediately rather than
	 * wait for the grace window; the test endpoints expose it for debugging.
	 */
	async delete(): Promise<void> {
		const existing = await this.ctx.storage.get<SessionState>(STATE_KEY);
		const sessionId = existing?.sessionId ?? "(unset)";
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
		this.broadcast({ type: "deleted", sessionId });
		this.closeAllSockets(1000, "session deleted");
	}

	/**
	 * Alarm handler: clears all storage. The DO will be evicted by the
	 * runtime shortly after.
	 */
	async alarm(): Promise<void> {
		const existing = await this.ctx.storage.get<SessionState>(STATE_KEY);
		const sessionId = existing?.sessionId ?? "(unset)";
		await this.ctx.storage.deleteAll();
		this.broadcast({ type: "deleted", sessionId });
		this.closeAllSockets(1000, "session expired");
	}

	// -------- ws helpers --------

	private broadcast(msg: SessionWsMessage): void {
		const payload = JSON.stringify(msg);
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.send(payload);
			} catch (err) {
				console.error("[SessionDO] broadcast send failed:", err);
			}
		}
	}

	private closeAllSockets(code: number, reason: string): void {
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.close(code, reason);
			} catch {
				// already closed
			}
		}
	}

	// -------- internals --------

	private async ensureState(sessionId?: string): Promise<SessionState> {
		const existing = await this.ctx.storage.get<SessionState>(STATE_KEY);
		if (existing) return existing;
		const now = Date.now();
		const seeded: SessionState = {
			sessionId: sessionId ?? "(unset)",
			status: "queued",
			createdAt: now,
			updatedAt: now,
			timings: {},
		};
		await this.ctx.storage.put(STATE_KEY, seeded);
		return seeded;
	}

	private async scheduleSelfDelete(): Promise<void> {
		const existing = await this.ctx.storage.getAlarm();
		if (existing !== null) return; // already scheduled
		await this.ctx.storage.setAlarm(Date.now() + SELF_DELETE_GRACE_MS);
	}
}

/**
 * Drop undefined values so we don't overwrite existing state fields with
 * `undefined` during the spread-merge in markStep.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
	const out: Partial<T> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) (out as Record<string, unknown>)[k] = v;
	}
	return out;
}
