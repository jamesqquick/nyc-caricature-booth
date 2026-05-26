import { Hono } from 'hono';
import { loadAdminSessions, loadAdminStats } from '../lib/admin-data';

const app = new Hono<{ Bindings: Env }>();

/**
 * Sessions JSON feed for the admin dashboard. Polled every 10s by /admin.
 * GET /api/admin/sessions  →  { sessions: AdminSessionRow[] }
 */
app.get('/api/admin/sessions', async (c) => {
	const rows = await loadAdminSessions(c.env);
	return c.json({ sessions: rows });
});

/**
 * Aggregate stats for the dashboard cards. Polled every 10s alongside sessions.
 * GET /api/admin/stats  →  AdminStats
 */
app.get('/api/admin/stats', async (c) => {
	const stats = await loadAdminStats(c.env);
	return c.json(stats);
});

export { app as adminDashboardApiRoutes };
