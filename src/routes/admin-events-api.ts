import { Hono } from 'hono';
import { loadEvent, loadAllScenes, invalidateEventCache } from '../lib/event-ctx';
import { SLUG_RE } from '../lib/admin-render';

const app = new Hono<{ Bindings: Env }>();

/** Create a new event. POST /api/admin/events */
app.post('/api/admin/events', async (c) => {
	const body = await c.req.json<{ id: string; name: string; status?: string }>();
	if (!body.id || !body.name) return c.json({ error: 'id and name are required' }, 400);
	if (!SLUG_RE.test(body.id)) return c.json({ error: 'Invalid slug. Lowercase letters, numbers, hyphens, 3–64 chars.' }, 400);

	const status = body.status || 'draft';
	if (!['draft', 'active', 'archived'].includes(status)) return c.json({ error: 'Invalid status' }, 400);

	try {
		await c.env.DB.prepare(`INSERT INTO events (id, name, status) VALUES (?, ?, ?)`).bind(body.id, body.name, status).run();
	} catch (err: any) {
		if (err?.message?.includes('UNIQUE constraint')) {
			return c.json({ error: 'An event with this slug already exists' }, 409);
		}
		throw err;
	}

	return c.json({ ok: true, id: body.id });
});

/** Update an event's fields. Supports partial updates + slug rename. PUT /api/admin/events/:eventId */
app.put('/api/admin/events/:eventId', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) return c.json({ error: 'Event not found' }, 404);

	const body = await c.req.json<Record<string, any>>();

	const ALLOWED = new Set([
		'id', 'name', 'status', 'accent_color', 'watermark_w', 'watermark_left_w',
		'tagline', 'kiosk_idle_subhead', 'scene_picker_heading',
		'scene_style_preamble', 'scene_constraints', 'timezone', 'privacy_email',
	]);

	const sets: string[] = [];
	const vals: any[] = [];
	for (const [key, val] of Object.entries(body)) {
		if (!ALLOWED.has(key)) continue;
		if (key === 'id') continue;
		if (key === 'status' && !['draft', 'active', 'archived'].includes(val)) {
			return c.json({ error: 'Invalid status' }, 400);
		}
		if ((key === 'watermark_w' || key === 'watermark_left_w') && val !== null) {
			const n = Number(val);
			if (!Number.isInteger(n) || n < 100 || n > 900) {
				return c.json({ error: `${key} must be an integer between 100 and 900, or null` }, 400);
			}
		}
		sets.push(`${key} = ?`);
		vals.push(val === '' ? null : val);
	}

	const newSlug = body.id;
	const slugChanging = newSlug && newSlug !== eventId;
	if (slugChanging) {
		if (!SLUG_RE.test(newSlug)) return c.json({ error: 'Invalid slug' }, 400);
		sets.push('id = ?');
		vals.push(newSlug);
	}

	if (sets.length === 0) return c.json({ error: 'No valid fields to update' }, 400);
	vals.push(eventId);

	try {
		await c.env.DB.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
	} catch (err: any) {
		if (err?.message?.includes('UNIQUE constraint')) {
			return c.json({ error: 'An event with this slug already exists' }, 409);
		}
		throw err;
	}

	if (slugChanging) {
		await c.env.DB.batch([
			c.env.DB.prepare(`UPDATE scenes SET event_id = ? WHERE event_id = ?`).bind(newSlug, eventId),
			c.env.DB.prepare(`UPDATE sessions SET event_id = ? WHERE event_id = ?`).bind(newSlug, eventId),
			c.env.DB.prepare(`UPDATE print_jobs SET event_id = ? WHERE event_id = ?`).bind(newSlug, eventId),
			c.env.DB.prepare(`UPDATE event_admins SET event_id = ? WHERE event_id = ?`).bind(newSlug, eventId),
		]);
		await invalidateEventCache(c.env, eventId);
	}

	await invalidateEventCache(c.env, slugChanging ? newSlug : eventId);
	return c.json({ ok: true, id: slugChanging ? newSlug : eventId });
});

/** Delete a draft event with no sessions. DELETE /api/admin/events/:eventId */
app.delete('/api/admin/events/:eventId', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) return c.json({ error: 'Event not found' }, 404);
	if (ev.status !== 'draft') return c.json({ error: 'Only draft events can be deleted' }, 409);

	const cnt = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM sessions WHERE event_id = ?`).bind(eventId).first<{ cnt: number }>();
	if (cnt && cnt.cnt > 0) return c.json({ error: 'Cannot delete event with existing sessions' }, 409);

	await c.env.DB.batch([
		c.env.DB.prepare(`DELETE FROM scenes WHERE event_id = ?`).bind(eventId),
		c.env.DB.prepare(`DELETE FROM event_admins WHERE event_id = ?`).bind(eventId),
		c.env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(eventId),
	]);

	await invalidateEventCache(c.env, eventId);
	return c.json({ ok: true });
});

/** Clone an event with all its scenes. POST /api/admin/events/:eventId/clone */
app.post('/api/admin/events/:eventId/clone', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) return c.json({ error: 'Event not found' }, 404);

	const scenes = await loadAllScenes(c.env, eventId);

	let newSlug = `${ev.id}-copy`;
	let attempt = 0;
	while (true) {
		const slug = attempt === 0 ? newSlug : `${ev.id}-copy-${attempt}`;
		const existing = await c.env.DB.prepare(`SELECT id FROM events WHERE id = ?`).bind(slug).first();
		if (!existing) {
			newSlug = slug;
			break;
		}
		attempt++;
		if (attempt > 20) return c.json({ error: 'Could not generate unique slug' }, 500);
	}

	await c.env.DB.prepare(
		`INSERT INTO events (id, name, status, accent_color,
			tagline, kiosk_idle_subhead, scene_picker_heading,
			scene_style_preamble, scene_constraints,
			timezone, privacy_email)
		 VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			newSlug,
			`${ev.name} (Copy)`,
			ev.accent_color,
			ev.tagline,
			ev.kiosk_idle_subhead,
			ev.scene_picker_heading,
			ev.scene_style_preamble,
			ev.scene_constraints,
			ev.timezone,
			ev.privacy_email,
		)
		.run();

	if (scenes.length > 0) {
		const stmts = scenes.map((s) =>
			c.env.DB.prepare(
				`INSERT INTO scenes (event_id, id, name, emoji, description, prompt, sort_order, is_active)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			).bind(newSlug, s.id, s.name, s.emoji, s.description, s.prompt, s.sort_order, s.is_active),
		);
		await c.env.DB.batch(stmts);
	}

	return c.json({ ok: true, newEventId: newSlug });
});

export { app as adminEventsApiRoutes };
