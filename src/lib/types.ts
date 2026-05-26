/**
 * Shared types for the multi-event caricature booth.
 *
 * EventRecord maps 1:1 with the `events` D1 table.
 * SceneRecord maps 1:1 with the `scenes` D1 table.
 * EventContext bundles both for request handlers.
 */

export interface EventRecord {
	id: string;
	name: string;
	status: "draft" | "active" | "archived";

	// branding
	accent_color: string;
	watermark_image_key: string | null;
	watermark_image_key_left: string | null;

	// copy
	tagline: string;
	kiosk_idle_subhead: string;
	scene_picker_heading: string;

	// prompt defaults (used as starter text when creating new scenes)
	scene_style_preamble: string | null;
	scene_constraints: string | null;

	// misc
	timezone: string;
	privacy_email: string;

	created_at: number;
	created_by: string | null;
}

export interface SceneRecord {
	event_id: string;
	id: string;
	name: string;
	emoji: string;
	description: string;
	prompt: string;
	sort_order: number;
	is_active: number; // 0 | 1 — SQLite boolean
}

export interface EventContext {
	event: EventRecord;
	scenes: SceneRecord[];
}
