import { Hono } from 'hono';
import { loadEvent, invalidateEventCache } from '../lib/event-ctx';

const app = new Hono<{ Bindings: Env }>();

/** Serve the right watermark image for admin preview. GET /api/admin/events/:eventId/watermark */
app.get('/api/admin/events/:eventId/watermark', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev?.watermark_image_key) return c.notFound();
	const obj = await c.env.BUCKET.get(ev.watermark_image_key);
	if (!obj) return c.notFound();
	return new Response(obj.body, {
		headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' },
	});
});

/** Upload right watermark PNG to R2. POST /api/admin/events/:eventId/watermark */
app.post('/api/admin/events/:eventId/watermark', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) return c.json({ error: 'Event not found' }, 404);

	let form: FormData;
	try {
		form = await c.req.formData();
	} catch {
		return c.json({ error: 'Expected multipart/form-data' }, 400);
	}

	const file = form.get('file');
	if (!file || !(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);
	if (file.size > 2 * 1024 * 1024) return c.json({ error: 'File too large (max 2 MB)' }, 400);
	if (!file.type.includes('png')) return c.json({ error: 'Only PNG files are accepted' }, 400);

	const r2Key = `events/${eventId}/watermark.png`;
	const bytes = await file.arrayBuffer();
	await c.env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: 'image/png' } });

	await c.env.DB.prepare(`UPDATE events SET watermark_image_key = ? WHERE id = ?`).bind(r2Key, eventId).run();
	await invalidateEventCache(c.env, eventId);

	return c.json({ ok: true, key: r2Key });
});

/** Remove right watermark from R2 + DB. DELETE /api/admin/events/:eventId/watermark */
app.delete('/api/admin/events/:eventId/watermark', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) return c.json({ error: 'Event not found' }, 404);

	if (ev.watermark_image_key) {
		await c.env.BUCKET.delete(ev.watermark_image_key);
	}
	await c.env.DB.prepare(`UPDATE events SET watermark_image_key = NULL WHERE id = ?`).bind(eventId).run();
	await invalidateEventCache(c.env, eventId);

	return c.json({ ok: true });
});

/** Serve the left watermark image for admin preview. GET /api/admin/events/:eventId/watermark-left */
app.get('/api/admin/events/:eventId/watermark-left', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev?.watermark_image_key_left) return c.notFound();
	const obj = await c.env.BUCKET.get(ev.watermark_image_key_left);
	if (!obj) return c.notFound();
	return new Response(obj.body, {
		headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' },
	});
});

/** Upload left watermark PNG to R2. POST /api/admin/events/:eventId/watermark-left */
app.post('/api/admin/events/:eventId/watermark-left', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) return c.json({ error: 'Event not found' }, 404);

	let form: FormData;
	try {
		form = await c.req.formData();
	} catch {
		return c.json({ error: 'Expected multipart/form-data' }, 400);
	}

	const file = form.get('file');
	if (!file || !(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);
	if (file.size > 2 * 1024 * 1024) return c.json({ error: 'File too large (max 2 MB)' }, 400);
	if (!file.type.includes('png')) return c.json({ error: 'Only PNG files are accepted' }, 400);

	const r2Key = `events/${eventId}/watermark-left.png`;
	const bytes = await file.arrayBuffer();
	await c.env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: 'image/png' } });

	await c.env.DB.prepare(`UPDATE events SET watermark_image_key_left = ? WHERE id = ?`).bind(r2Key, eventId).run();
	await invalidateEventCache(c.env, eventId);

	return c.json({ ok: true, key: r2Key });
});

/** Remove left watermark from R2 + DB. DELETE /api/admin/events/:eventId/watermark-left */
app.delete('/api/admin/events/:eventId/watermark-left', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) return c.json({ error: 'Event not found' }, 404);

	if (ev.watermark_image_key_left) {
		await c.env.BUCKET.delete(ev.watermark_image_key_left);
	}
	await c.env.DB.prepare(`UPDATE events SET watermark_image_key_left = NULL WHERE id = ?`).bind(eventId).run();
	await invalidateEventCache(c.env, eventId);

	return c.json({ ok: true });
});

export { app as adminWatermarksApiRoutes };
