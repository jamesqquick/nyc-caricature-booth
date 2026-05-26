import { Hono } from 'hono';
import { runFlux } from '../../lib/flux';

const app = new Hono<{ Bindings: Env }>();

/**
 * Generate an image with Workers AI (FLUX.2). Returns image/png.
 * GET /api/test-ai?prompt=...
 */
app.get('/api/test-ai', async (c) => {
	const prompt =
		c.req.query('prompt') ??
		'A stylized illustration of a hot dog on a New York City sidewalk with yellow taxis blurred in the background, vibrant cartoon style.';

	try {
		const { bytes, contentType, elapsedMs } = await runFlux(c.env.AI, { prompt });
		return new Response(bytes, {
			headers: {
				'content-type': contentType,
				'content-length': String(bytes.byteLength),
				'x-elapsed-ms': String(elapsedMs),
				'x-prompt': prompt,
			},
		});
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

/**
 * Insert a row into D1 and read recent rows back.
 * GET /api/test-db
 */
app.get('/api/test-db', async (c) => {
	const id = crypto.randomUUID();
	const inserted = await c.env.DB.prepare('INSERT INTO sessions (id, status) VALUES (?, ?) RETURNING id, created_at, status')
		.bind(id, 'test')
		.first<{ id: string; created_at: number; status: string }>();

	const recent = await c.env.DB.prepare('SELECT id, created_at, status FROM sessions ORDER BY created_at DESC LIMIT 5').all<{
		id: string;
		created_at: number;
		status: string;
	}>();

	return c.json({ ok: true, inserted, recent: recent.results });
});

/**
 * Upload a hardcoded tiny PNG to R2.
 * GET /api/test-upload
 */
app.get('/api/test-upload', async (c) => {
	const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
	const bytes = Uint8Array.from(atob(tinyPngBase64), (ch) => ch.charCodeAt(0));

	const key = `test/${Date.now()}-tiny.png`;
	await c.env.BUCKET.put(key, bytes, {
		httpMetadata: { contentType: 'image/png' },
	});

	return c.json({ ok: true, key, size: bytes.byteLength });
});

/**
 * List the most recent R2 objects.
 * GET /api/test-list
 */
app.get('/api/test-list', async (c) => {
	const listing = await c.env.BUCKET.list({ limit: 10 });
	return c.json({
		count: listing.objects.length,
		truncated: listing.truncated,
		objects: listing.objects.map((obj) => ({
			key: obj.key,
			size: obj.size,
			uploaded: obj.uploaded,
		})),
	});
});

/**
 * Fetch a specific object from R2 by key.
 * GET /api/test-get?key=...
 */
app.get('/api/test-get', async (c) => {
	const key = c.req.query('key');
	if (!key) return c.json({ error: 'missing ?key=' }, 400);

	const obj = await c.env.BUCKET.get(key);
	if (!obj) return c.json({ error: 'not found', key }, 404);

	return new Response(obj.body, {
		headers: {
			'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
			'content-length': String(obj.size),
		},
	});
});

export { app as testBasicRoutes };
