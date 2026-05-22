/**
 * Scene loading helpers.
 *
 * Scenes now live in the D1 `scenes` table, loaded via EventContext.
 * The bundled seed/scenes.json is kept only for backward-compat with
 * callers that haven't migrated to EventContext yet.
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
 * Load scenes from the bundled seed (legacy path).
 * Prefer using EventContext.scenes from loadEventContext() instead.
 */
export async function loadScenes(_env: Env): Promise<Scene[]> {
	return SCENES;
}

/**
 * Load a single scene by ID from the bundled seed (legacy path).
 * Prefer looking up scenes from EventContext.scenes instead.
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
