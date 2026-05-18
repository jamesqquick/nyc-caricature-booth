/**
 * Scene definitions live in KV under the "scenes" key.
 * Seeded from `seed/scenes.json`. Shared between test endpoints and workflow.
 */

export type Scene = {
	id: string;
	name: string;
	emoji: string;
	description: string;
	prompt: string;
};

export async function loadScenes(env: Env): Promise<Scene[]> {
	const raw = await env.CONFIG.get("scenes");
	if (!raw) throw new Error("scenes not configured in KV");
	return JSON.parse(raw) as Scene[];
}

export async function loadSceneById(env: Env, sceneId: string): Promise<Scene> {
	const scenes = await loadScenes(env);
	const scene = scenes.find((s) => s.id === sceneId);
	if (!scene) throw new Error(`unknown scene_id: ${sceneId}`);
	return scene;
}
