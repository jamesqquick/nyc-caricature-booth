import { Hono } from 'hono';
import { loadEvent, invalidateEventCache } from '../lib/event-ctx';

const app = new Hono<{ Bindings: Env }>();

/** Create a scene. POST /api/admin/events/:eventId/scenes */
app.post('/api/admin/events/:eventId/scenes', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) return c.json({ error: 'Event not found' }, 404);

	const body = await c.req.json<{
		id: string;
		name: string;
		emoji: string;
		description: string;
		prompt: string;
		sort_order: number;
		is_active: number;
	}>();

	if (!body.id || !body.name) return c.json({ error: 'id and name are required' }, 400);

	try {
		await c.env.DB.prepare(
			`INSERT INTO scenes (event_id, id, name, emoji, description, prompt, sort_order, is_active)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				eventId,
				body.id,
				body.name,
				body.emoji || '',
				body.description || '',
				body.prompt || '',
				body.sort_order ?? 0,
				body.is_active ?? 1,
			)
			.run();
	} catch (err: any) {
		if (err?.message?.includes('UNIQUE constraint')) {
			return c.json({ error: 'A scene with this ID already exists for this event' }, 409);
		}
		throw err;
	}

	await invalidateEventCache(c.env, eventId);
	return c.json({ ok: true, id: body.id });
});

/** Bulk reorder scenes. PUT /api/admin/events/:eventId/scenes/reorder */
app.put('/api/admin/events/:eventId/scenes/reorder', async (c) => {
	const eventId = c.req.param('eventId');
	const body = await c.req.json<{ id: string; sort_order: number }[]>();

	if (!Array.isArray(body) || body.length === 0) return c.json({ error: 'Expected array' }, 400);

	const stmts = body.map((item) =>
		c.env.DB.prepare(`UPDATE scenes SET sort_order = ? WHERE event_id = ? AND id = ?`).bind(item.sort_order, eventId, item.id),
	);
	await c.env.DB.batch(stmts);

	await invalidateEventCache(c.env, eventId);
	return c.json({ ok: true });
});

/** Update a scene. Supports partial updates. PUT /api/admin/events/:eventId/scenes/:sceneId */
app.put('/api/admin/events/:eventId/scenes/:sceneId', async (c) => {
	const eventId = c.req.param('eventId');
	const sceneId = c.req.param('sceneId');
	const body = await c.req.json<Record<string, any>>();

	const ALLOWED = new Set(['name', 'emoji', 'description', 'prompt', 'sort_order', 'is_active']);
	const sets: string[] = [];
	const vals: any[] = [];
	for (const [key, val] of Object.entries(body)) {
		if (!ALLOWED.has(key)) continue;
		sets.push(`${key} = ?`);
		vals.push(val);
	}

	if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);

	vals.push(eventId, sceneId);
	await c.env.DB.prepare(`UPDATE scenes SET ${sets.join(', ')} WHERE event_id = ? AND id = ?`)
		.bind(...vals)
		.run();

	await invalidateEventCache(c.env, eventId);
	return c.json({ ok: true });
});

/** Delete a scene. DELETE /api/admin/events/:eventId/scenes/:sceneId */
app.delete('/api/admin/events/:eventId/scenes/:sceneId', async (c) => {
	const eventId = c.req.param('eventId');
	const sceneId = c.req.param('sceneId');

	await c.env.DB.prepare(`DELETE FROM scenes WHERE event_id = ? AND id = ?`).bind(eventId, sceneId).run();

	await invalidateEventCache(c.env, eventId);
	return c.json({ ok: true });
});

export { app as adminScenesApiRoutes };
