import { Hono } from 'hono';
import { sendPostcardEmail } from '../lib/email';
import { trackEvent } from '../lib/analytics';
import { UUID_RE } from '../lib/helpers';

const app = new Hono<{ Bindings: Env }>();

/**
 * Manual control: force-enqueue a new print job for a session.
 * Unlike /api/kiosk/print (idempotent), this always inserts a fresh row.
 * POST /api/admin/reprint/:id
 */
app.post('/api/admin/reprint/:id', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) {
		return c.json({ error: 'invalid session id' }, 400);
	}

	const session = await c.env.DB.prepare('SELECT id, event_id, status, postcard_key, scene_name FROM sessions WHERE id = ?')
		.bind(id)
		.first<{
			id: string;
			event_id: string | null;
			status: string | null;
			postcard_key: string | null;
			scene_name: string | null;
		}>();

	if (!session) {
		return c.json({ error: 'session not found' }, 404);
	}
	if (session.status !== 'completed' || !session.postcard_key) {
		return c.json({ error: 'session is not completed' }, 409);
	}

	const origin = new URL(c.req.url).origin;
	const postcardUrl = `${origin}/p/${id}`;
	const sceneName = session.scene_name ?? 'Scene';

	const result = await c.env.DB.prepare(
		`INSERT INTO print_jobs (session_id, event_id, postcard_key, postcard_url, scene_name)
		 VALUES (?, ?, ?, ?, ?)
		 RETURNING id`,
	)
		.bind(id, session.event_id, session.postcard_key, postcardUrl, sceneName)
		.first<{ id: string }>();

	if (!result) {
		return c.json({ error: 'failed to enqueue reprint' }, 500);
	}

	console.log(`[admin-reprint] session=${id} jobId=${result.id} sceneName=${sceneName}`);

	return c.json({ ok: true, jobId: result.id, status: 'pending' });
});

/**
 * Manual control: re-fire the postcard email for a session.
 * POST /api/admin/resend-email/:id
 */
app.post('/api/admin/resend-email/:id', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) {
		return c.json({ error: 'invalid session id' }, 400);
	}

	const session = await c.env.DB.prepare('SELECT id, event_id, status, postcard_key, scene_name, email FROM sessions WHERE id = ?').bind(id).first<{
		id: string;
		event_id: string;
		status: string | null;
		postcard_key: string | null;
		scene_name: string | null;
		email: string | null;
	}>();

	if (!session) {
		return c.json({ error: 'session not found' }, 404);
	}
	if (session.status !== 'completed' || !session.postcard_key) {
		return c.json({ error: 'session is not completed' }, 409);
	}
	if (!session.email) {
		return c.json({ error: 'no email on file for this session' }, 409);
	}

	const origin = new URL(c.req.url).origin;
	const basePath = `/e/${session.event_id}`;
	const email = session.email;
	const postcardKey = session.postcard_key;
	const sceneName = session.scene_name ?? 'Scene';

	console.log(`[admin-resend] session=${id} email=${email.slice(0, 3)}***`);

	c.executionCtx.waitUntil(
		sendPostcardEmail(c.env, {
			to: email,
			sessionId: id,
			sceneName,
			pickupUrl: `${origin}${basePath}/p/${id}`,
			postcardImageUrl: `${origin}${basePath}/api/run-img?key=${encodeURIComponent(postcardKey)}`,
			downloadUrl: `${origin}${basePath}/api/run-img?key=${encodeURIComponent(postcardKey)}&download=1`,
		}).catch((err) => {
			console.error(`[admin-resend] send failed session=${id} err=${err}`);
		}),
	);

	return c.json({ ok: true, queued: true });
});

/**
 * Manual control: delete all data for a session (privacy right-to-delete).
 * Removes D1 rows, R2 objects, and SessionDO storage.
 * DELETE /api/admin/session/:id
 */
app.delete('/api/admin/session/:id', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) {
		return c.json({ error: 'invalid session id' }, 400);
	}

	const session = await c.env.DB.prepare('SELECT id, selfie_key, caricature_key, postcard_key FROM sessions WHERE id = ?').bind(id).first<{
		id: string;
		selfie_key: string | null;
		caricature_key: string | null;
		postcard_key: string | null;
	}>();

	if (!session) {
		return c.json({ error: 'session not found' }, 404);
	}

	const deleted: string[] = [];

	const r2Keys = [`kiosk/${id}/selfie.jpg`, session.selfie_key, session.caricature_key, session.postcard_key].filter(
		(k): k is string => !!k,
	);
	const uniqueR2Keys = [...new Set(r2Keys)];
	for (const key of uniqueR2Keys) {
		try {
			await c.env.BUCKET.delete(key);
			deleted.push(`r2:${key}`);
		} catch (err) {
			console.warn(`[admin-delete] R2 delete failed key=${key}: ${err}`);
		}
	}

	const printResult = await c.env.DB.prepare('DELETE FROM print_jobs WHERE session_id = ?').bind(id).run();
	const printDeleted = printResult.meta.changes ?? 0;
	if (printDeleted > 0) deleted.push(`d1:print_jobs(${printDeleted})`);

	await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
	deleted.push('d1:sessions');

	try {
		const doId = c.env.SESSION.idFromName(id);
		const stub = c.env.SESSION.get(doId);
		await stub.delete();
		deleted.push('do:session');
	} catch (err) {
		console.warn(`[admin-delete] DO delete failed session=${id}: ${err}`);
	}

	console.log(`[admin-delete] session=${id} deleted=[${deleted.join(', ')}]`);
	trackEvent(c.env.ANALYTICS, 'session.deleted', id);

	return c.json({ ok: true, sessionId: id, deleted });
});

export { app as adminSessionApiRoutes };
