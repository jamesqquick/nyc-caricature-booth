/**
 * Event context loader.
 *
 * Phase 0: returns a hardcoded NYC stub so handlers can begin consuming
 * EventContext without touching D1 yet. Phase 1 (migration) will swap
 * this to a real D1 query with KV caching.
 */

import type { EventContext, EventRecord, SceneRecord } from "./types";
import scenesSeed from "../../seed/scenes.json";

const KV_TTL_SECONDS = 60;

// -----------------------------------------------------------------------
// Hardcoded NYC event — replaced with D1 reads in Phase 1.
// -----------------------------------------------------------------------

const NYC_EVENT: EventRecord = {
	id: "nyc-tech-week-2026",
	name: "NY Tech Week 2026",
	status: "active",

	wordmark_text: "I 🧡 NY",
	wordmark_image_key: null,
	accent_color: "#f6821f",
	watermark_image_key: null,
	watermark_fallback_text: null,
	empty_state_emoji: "🗽",

	tagline: "Take a selfie, pick an iconic NYC scene, walk away with a printed postcard.",
	kiosk_idle_subhead: "Cloudflare \u00b7 NY Tech Week 2026",
	scene_picker_heading: "Pick your NYC scene",

	scene_style_preamble: null,
	scene_constraints: null,

	timezone: "America/New_York",
	privacy_email: "devrel@cloudflare.com",
	public_url: "https://nyc-caricature-booth.examples.workers.dev",

	created_at: Math.floor(Date.now() / 1000),
	created_by: null,
};

const NYC_SCENES: SceneRecord[] = (scenesSeed as Array<{
	id: string;
	name: string;
	emoji: string;
	description: string;
	prompt: string;
}>).map((s, i) => ({
	event_id: "nyc-tech-week-2026",
	id: s.id,
	name: s.name,
	emoji: s.emoji,
	description: s.description,
	prompt: s.prompt,
	sort_order: i,
	is_active: 1,
}));

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

/**
 * Load an event and its active scenes. Returns null if the event doesn't
 * exist or is not active.
 *
 * Phase 0: ignores `eventId` and always returns the hardcoded NYC event.
 * Phase 1: reads from D1, caches in KV for KV_TTL_SECONDS.
 */
export async function loadEventContext(
	_env: Env,
	_eventId: string,
): Promise<EventContext | null> {
	// Phase 0 stub — always returns NYC regardless of eventId
	return {
		event: NYC_EVENT,
		scenes: NYC_SCENES.filter((s) => s.is_active),
	};
}

/**
 * Invalidate the KV cache for an event so the next request picks up
 * admin edits immediately.
 *
 * Phase 0: no-op (nothing is cached yet).
 */
export async function invalidateEventCache(
	_env: Env,
	_eventId: string,
): Promise<void> {
	// Phase 0: no-op — KV caching comes in Phase 1
}

/**
 * List all events (for the admin index / root page).
 *
 * Phase 0: returns a single-element array with the NYC event.
 * Phase 1: reads from D1.
 */
export async function listEvents(
	_env: Env,
): Promise<EventRecord[]> {
	return [NYC_EVENT];
}
