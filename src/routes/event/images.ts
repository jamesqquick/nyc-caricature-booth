import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';

const app = new Hono<EventEnv>();

/**
 * R2 image proxy constrained to `runs/` and `kiosk/` key prefixes.
 * GET /api/run-img?key=(runs|kiosk)/<sessionId>/...
 */
app.get('/api/run-img', async (c) => {
	const key = c.req.query('key');
	if (!key || (!key.startsWith('runs/') && !key.startsWith('kiosk/'))) {
		return c.json({ error: 'invalid key' }, 400);
	}
	const obj = await c.env.BUCKET.get(key);
	if (!obj) return c.json({ error: 'not found', key }, 404);

	const headers: Record<string, string> = {
		'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
		'content-length': String(obj.size),
		'cache-control': 'public, max-age=3600',
	};

	if (c.req.query('download')) {
		const tail = key.split('/').pop() ?? 'image';
		headers['content-disposition'] = `attachment; filename="caricature-${tail}"`;
	}

	return new Response(obj.body, { headers });
});

export { app as imagesRoutes };
