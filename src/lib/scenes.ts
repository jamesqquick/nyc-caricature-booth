/**
 * Scene loading helpers.
 *
 * Production scenes live in the D1 `scenes` table, loaded per-event via
 * loadEventContext() in src/lib/event-ctx.ts.
 *
 * The bundled seed/scenes.json + legacy loadScenes/loadSceneById below
 * are retained ONLY for the /test-* dev endpoints that haven't been
 * migrated to event-scoped context. They are NOT used by any production
 * kiosk, display, or admin route.
 */

import scenesSeed from "../../seed/scenes.json";
import type { SceneRecord } from "./types";

export type Scene = {
	id: string;
	name: string;
	emoji: string;
	description: string;
	prompt: string;
};

const SCENES = scenesSeed as Scene[];

/**
 * Load scenes from the bundled seed.
 * LEGACY — only used by /test-* dev endpoints.
 * Production routes use EventContext.scenes instead.
 */
export async function loadScenes(_env: Env): Promise<Scene[]> {
	return SCENES;
}

/**
 * Load a single scene by ID from the bundled seed.
 * LEGACY — only used by /test-* dev endpoints.
 * Production routes use EventContext.scenes instead.
 */
export async function loadSceneById(_env: Env, sceneId: string): Promise<Scene> {
	const scene = SCENES.find((s) => s.id === sceneId);
	if (!scene) throw new Error(`unknown scene_id: ${sceneId}`);
	return scene;
}

/**
 * Find a scene by ID within a pre-loaded SceneRecord array (from EventContext).
 */
export function findScene(scenes: SceneRecord[], sceneId: string): SceneRecord | undefined {
	return scenes.find((s) => s.id === sceneId);
}
