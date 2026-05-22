/**
 * Scene definitions are bundled into the worker at build time from
 * `seed/scenes.json`. KV is no longer the source of truth — edit the
 * JSON file and redeploy to update prompts.
 *
 * The functions remain async-compatible (callers `await` them) and still
 * accept `env` for signature compatibility, even though neither is needed.
 */

import scenesSeed from "../../seed/scenes.json";

export type Scene = {
	id: string;
	name: string;
	emoji: string;
	description: string;
	prompt: string;
};

const SCENES = scenesSeed as Scene[];

export async function loadScenes(_env: Env): Promise<Scene[]> {
	return SCENES;
}

export async function loadSceneById(_env: Env, sceneId: string): Promise<Scene> {
	const scene = SCENES.find((s) => s.id === sceneId);
	if (!scene) throw new Error(`unknown scene_id: ${sceneId}`);
	return scene;
}
