import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';
import { trackEvent } from '../../lib/analytics';
import { qrPng } from '../../lib/postcard';
import { UUID_RE } from '../../lib/helpers';

const app = new Hono<EventEnv>();

/**
 * Uploads a kiosk selfie blob to R2 and mints a fresh sessionId.
 * POST /api/kiosk/selfie  (multipart: selfie=file)
 */
app.post('/api/kiosk/selfie', async (c) => {
	let inForm: FormData;
	try {
		inForm = await c.req.formData();
	} catch (err) {
		return c.json({ error: "expected multipart/form-data with 'selfie'", details: String(err) }, 400);
	}
	const selfie = inForm.get('selfie');
	if (!(selfie instanceof File) || selfie.size === 0) {
		return c.json({ error: 'missing selfie file' }, 400);
	}

	const sessionId = crypto.randomUUID();
	const selfieKey = `kiosk/${sessionId}/selfie.jpg`;

	const buf = await selfie.arrayBuffer();
	await c.env.BUCKET.put(selfieKey, buf, {
		httpMetadata: { contentType: selfie.type || 'image/jpeg' },
		customMetadata: { sessionId, source: 'kiosk', capturedAt: new Date().toISOString() },
	});

	trackEvent(c.env.ANALYTICS, 'session.created', sessionId);

	return c.json({
		ok: true,
		sessionId,
		selfieKey,
		size: buf.byteLength,
		contentType: selfie.type || 'image/jpeg',
	});
});

/**
 * Kicks off the caricature workflow from the review screen.
 * POST /api/kiosk/start  body: { sessionId, selfieKey, sceneId }
 */
app.post('/api/kiosk/start', async (c) => {
	let body: { sessionId?: unknown; selfieKey?: unknown; sceneId?: unknown };
	try {
		body = await c.req.json();
	} catch (err) {
		return c.json({ error: 'expected JSON body { sessionId, selfieKey, sceneId }', details: String(err) }, 400);
	}

	const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
	const selfieKey = typeof body.selfieKey === 'string' ? body.selfieKey : '';
	const sceneId = typeof body.sceneId === 'string' ? body.sceneId : '';

	if (!UUID_RE.test(sessionId)) {
		return c.json({ error: 'invalid sessionId' }, 400);
	}
	const expectedPrefix = `kiosk/${sessionId}/`;
	if (!selfieKey.startsWith(expectedPrefix)) {
		return c.json({ error: `selfieKey must start with ${expectedPrefix}`, got: selfieKey }, 400);
	}
	if (!sceneId) {
		return c.json({ error: 'missing sceneId' }, 400);
	}

	const eventCtx = c.get('eventCtx');
	if (!eventCtx.scenes.some((s) => s.id === sceneId)) {
		return c.json({ error: `unknown sceneId: ${sceneId} for event ${eventCtx.event.id}` }, 400);
	}

	const head = await c.env.BUCKET.head(selfieKey);
	if (!head) {
		return c.json({ error: `selfie not found in R2: ${selfieKey}` }, 404);
	}

	const basePath = c.get('basePath');
	const publicOrigin = new URL(c.req.url).origin;
	const instance = await c.env.CARICATURE_WORKFLOW.create({
		params: {
			sessionId,
			eventId: eventCtx.event.id,
			selfieKey,
			sceneId,
			publicOrigin,
			note: 'kiosk',
		},
	});

	const statusUrl = `${basePath}/kiosk/status/${instance.id}?session=${sessionId}`;
	return c.json({ ok: true, instanceId: instance.id, sessionId, statusUrl });
});

/**
 * Idempotently enqueues a print job for a completed session.
 * POST /api/kiosk/print  body: { sessionId }
 */
app.post('/api/kiosk/print', async (c) => {
	let body: { sessionId?: unknown };
	try {
		body = await c.req.json();
	} catch (err) {
		return c.json({ error: 'expected JSON body { sessionId }', details: String(err) }, 400);
	}

	const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
	if (!UUID_RE.test(sessionId)) {
		return c.json({ error: 'invalid sessionId' }, 400);
	}

	const session = await c.env.DB.prepare('SELECT id, event_id, status, postcard_key, scene_name FROM sessions WHERE id = ?')
		.bind(sessionId)
		.first<{ id: string; event_id: string | null; status: string | null; postcard_key: string | null; scene_name: string | null }>();

	if (!session) return c.json({ error: 'session not found' }, 404);
	if (session.status !== 'completed' || !session.postcard_key) {
		return c.json({ error: 'session is not ready to print', status: session.status }, 409);
	}

	const existing = await c.env.DB.prepare(
		`SELECT id, status FROM print_jobs WHERE session_id = ? AND status IN ('pending', 'printing', 'printed') ORDER BY created_at DESC LIMIT 1`,
	)
		.bind(sessionId)
		.first<{ id: string; status: string }>();

	if (existing) {
		console.log(`[kiosk-print] session=${sessionId} already queued jobId=${existing.id} status=${existing.status}`);
		return c.json({ ok: true, alreadyQueued: true, jobId: existing.id, status: existing.status });
	}

	const origin = new URL(c.req.url).origin;
	const postcardUrl = `${origin}/p/${sessionId}`;
	const sceneName = session.scene_name ?? 'Scene';

	const insertResult = await c.env.DB.prepare(
		`INSERT INTO print_jobs (session_id, event_id, postcard_key, postcard_url, scene_name) VALUES (?, ?, ?, ?, ?) RETURNING id`,
	)
		.bind(sessionId, session.event_id, session.postcard_key, postcardUrl, sceneName)
		.first<{ id: string }>();

	if (!insertResult) return c.json({ error: 'failed to enqueue print job' }, 500);

	console.log(`[kiosk-print] session=${sessionId} jobId=${insertResult.id} queued sceneName=${sceneName}`);
	trackEvent(c.env.ANALYTICS, 'print.requested', sessionId, sceneName);

	return c.json({ ok: true, alreadyQueued: false, jobId: insertResult.id, status: 'pending' });
});

/**
 * Returns the current status of a print job.
 * GET /api/kiosk/print/:jobId/status
 */
app.get('/api/kiosk/print/:jobId/status', async (c) => {
	const jobId = c.req.param('jobId');
	if (!jobId) return c.json({ error: 'missing jobId' }, 400);

	const row = await c.env.DB.prepare('SELECT status, printed_at, error_msg FROM print_jobs WHERE id = ?')
		.bind(jobId)
		.first<{ status: string; printed_at: number | null; error_msg: string | null }>();

	if (!row) return c.json({ error: 'job not found' }, 404);

	return c.json({
		status: row.status,
		...(row.printed_at ? { printedAt: row.printed_at } : {}),
		...(row.error_msg ? { errorMsg: row.error_msg } : {}),
	});
});

/**
 * Generates a QR code PNG for the given URL. Only allows same-origin URLs.
 * GET /api/kiosk/qr?url=<encoded>
 */
app.get('/api/kiosk/qr', (c) => {
	const raw = c.req.query('url');
	if (!raw) return c.json({ error: 'missing url param' }, 400);

	let target: string;
	try {
		target = decodeURIComponent(raw);
	} catch {
		return c.json({ error: 'invalid url encoding' }, 400);
	}

	const workerOrigin = new URL(c.req.url).origin;
	if (!target.startsWith(workerOrigin + '/') && target !== workerOrigin) {
		return c.json({ error: 'url must be on this origin' }, 403);
	}

	const png = qrPng(target, 400);
	return new Response(png, {
		headers: {
			'content-type': 'image/png',
			'cache-control': 'public, max-age=31536000, immutable',
		},
	});
});

export { app as kioskApiRoutes };
