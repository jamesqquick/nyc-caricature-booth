/**
 * Event context loader — reads events + scenes from D1, caches in KV.
 */

import type { EventContext, EventRecord, SceneRecord } from "./types";

const KV_TTL_SECONDS = 60;
const KV_PREFIX = "event:";

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

/**
 * Load an event and its active scenes. Returns null if the event doesn't
 * exist or is not active.
 *
 * Reads from KV cache first; falls back to D1 and populates the cache.
 */
export async function loadEventContext(
	env: Env,
	eventId: string,
): Promise<EventContext | null> {
	const cacheKey = `${KV_PREFIX}${eventId}`;

	// Try KV cache first
	const cached = await env.CONFIG.get(cacheKey, "json");
	if (cached) return cached as EventContext;

	// Miss — query D1
	const [eventRes, scenesRes] = await env.DB.batch([
		env.DB.prepare(
			`SELECT * FROM events WHERE id = ? AND status = 'active'`,
		).bind(eventId),
		env.DB.prepare(
			`SELECT * FROM scenes WHERE event_id = ? AND is_active = 1 ORDER BY sort_order`,
		).bind(eventId),
	]);

	const eventRow = eventRes.results[0] as EventRecord | undefined;
	if (!eventRow) return null;

	const scenes = (scenesRes.results ?? []) as SceneRecord[];

	const ctx: EventContext = { event: eventRow, scenes };

	// Populate cache (fire-and-forget)
	env.CONFIG.put(cacheKey, JSON.stringify(ctx), {
		expirationTtl: KV_TTL_SECONDS,
	}).catch(() => {});

	return ctx;
}

/**
 * Invalidate the KV cache for an event so the next request picks up
 * admin edits immediately.
 */
export async function invalidateEventCache(
	env: Env,
	eventId: string,
): Promise<void> {
	await env.CONFIG.delete(`${KV_PREFIX}${eventId}`);
}

/**
 * List all events (for the admin index / root page).
 * Not cached — admin-only, low frequency.
 */
export async function listEvents(env: Env): Promise<EventRecord[]> {
	const { results } = await env.DB.prepare(
		`SELECT * FROM events ORDER BY created_at DESC`,
	).all<EventRecord>();
	return results;
}

/**
 * Load a single event record by ID (any status, not just active).
 * Used by admin pages that need to edit draft/archived events.
 */
export async function loadEvent(
	env: Env,
	eventId: string,
): Promise<EventRecord | null> {
	const row = await env.DB.prepare(
		`SELECT * FROM events WHERE id = ?`,
	).bind(eventId).first<EventRecord>();
	return row ?? null;
}

/**
 * Load all scenes for an event (including inactive), ordered by sort_order.
 * Used by admin scene editor.
 */
export async function loadAllScenes(
	env: Env,
	eventId: string,
): Promise<SceneRecord[]> {
	const { results } = await env.DB.prepare(
		`SELECT * FROM scenes WHERE event_id = ? ORDER BY sort_order`,
	).bind(eventId).all<SceneRecord>();
	return results;
}
