import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

/**
 * Returns the list of available NYC scenes from KV.
 * GET /api/scenes
 */
app.get('/api/scenes', async (c) => {
	const raw = await c.env.CONFIG.get('scenes');
	if (!raw) return c.json({ error: 'scenes not configured' }, 500);

	try {
		const scenes = JSON.parse(raw);
		return c.json({ count: scenes.length, scenes });
	} catch (err) {
		return c.json({ error: 'invalid scenes JSON', details: String(err) }, 500);
	}
});

export { app as scenesApiRoutes };
