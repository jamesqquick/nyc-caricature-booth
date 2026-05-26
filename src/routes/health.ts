import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => {
	return c.json({ status: 'ok', step: '11.4' });
});

export { app as healthRoutes };
