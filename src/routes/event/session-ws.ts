import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';
import { UUID_RE, getSessionStub } from '../../lib/helpers';

const app = new Hono<EventEnv>();

/**
 * WebSocket upgrade — proxied to the SessionDO Hibernation API.
 * GET /api/session/:id/ws  (with Upgrade: websocket)
 */
app.get('/api/session/:id/ws', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) return c.json({ error: 'invalid session id' }, 400);
	if (c.req.header('Upgrade') !== 'websocket') {
		return c.json({ error: 'expected websocket upgrade' }, 426);
	}
	const stub = getSessionStub(c.env, id);
	return stub.fetch(c.req.raw);
});

export { app as sessionWsRoutes };
