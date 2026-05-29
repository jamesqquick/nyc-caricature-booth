import { Hono } from 'hono';
import { adminAuthMiddleware } from './lib/admin-auth';
import { printAgentAuthMiddleware } from './lib/print-agent-auth';
import { loadEventContext } from './lib/event-ctx';
import { page, escapeAttr } from './lib/html';
import type { EventEnv } from './lib/types';

// Global routes
import { healthRoutes } from './routes/health';
import { rootRoutes } from './routes/root';
import { scenesApiRoutes } from './routes/scenes-api';
import { printAgentRoutes } from './routes/print-agent';

// Admin routes
import { adminAuthPages } from './routes/admin-auth-pages';
import { adminDashboardRoutes } from './routes/admin-dashboard';
import { adminDashboardApiRoutes } from './routes/admin-dashboard-api';
import { adminMetricsRoutes } from './routes/admin-metrics';
import { adminMetricsApiRoutes } from './routes/admin-metrics-api';
import { adminSessionApiRoutes } from './routes/admin-session-api';
import { adminEventsPagesRoutes } from './routes/admin-events-pages';
import { adminEventEditorRoutes } from './routes/admin-event-editor';
import { adminEventsApiRoutes } from './routes/admin-events-api';
import { adminWatermarksApiRoutes } from './routes/admin-watermarks-api';
import { adminScenesApiRoutes } from './routes/admin-scenes-api';

// Event-scoped routes
import { eventLandingRoutes } from './routes/event/landing';
import { privacyRoutes } from './routes/event/privacy';
import { kioskIdleRoutes } from './routes/event/kiosk-idle';
import { kioskCaptureRoutes } from './routes/event/kiosk-capture';
import { kioskSceneRoutes } from './routes/event/kiosk-scene';
import { kioskReviewRoutes } from './routes/event/kiosk-review';
import { kioskStatusRoutes } from './routes/event/kiosk-status';
import { kioskDoneRoutes } from './routes/event/kiosk-done';
import { kioskApiRoutes } from './routes/event/kiosk-api';
import { galleryRoutes } from './routes/event/gallery';
import { sessionWsRoutes } from './routes/event/session-ws';
import { pickupRoutes } from './routes/event/pickup';
import { imagesRoutes } from './routes/event/images';


// Re-export Durable Objects and Workflows so wrangler can find them.
export { CaricatureWorkflow } from './workflows/caricature';
export { SessionDO } from './session/session';

// ---------------------------------------------------------------------------
// Root app
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// Admin auth middleware — applies to all /admin/* and /api/admin/* routes.
// /admin/login (GET + POST) and /admin/logout are exempted inside the middleware.
app.use('/admin/*', adminAuthMiddleware());
app.use('/api/admin/*', adminAuthMiddleware());

// Print-agent auth middleware — bearer token (ADMIN_PASSWORD) on the
// machine-to-machine print queue endpoints.
app.use('/api/print-agent/*', printAgentAuthMiddleware());

// Global routes
app.route('/', healthRoutes);
app.route('/', rootRoutes);
app.route('/', scenesApiRoutes);
app.route('/', printAgentRoutes);

// Admin pages
app.route('/', adminAuthPages);
app.route('/', adminDashboardRoutes);
app.route('/', adminDashboardApiRoutes);
app.route('/', adminMetricsRoutes);
app.route('/', adminMetricsApiRoutes);
app.route('/', adminSessionApiRoutes);
app.route('/', adminEventsPagesRoutes);
app.route('/', adminEventEditorRoutes);
app.route('/', adminEventsApiRoutes);
app.route('/', adminWatermarksApiRoutes);
app.route('/', adminScenesApiRoutes);


// ---------------------------------------------------------------------------
// Event-scoped sub-app (/e/:eventId/*)
//
// Middleware loads EventContext from the :eventId URL param and 404s if the
// event doesn't exist or isn't active. All user-facing routes live here.
// ---------------------------------------------------------------------------

const eventApp = new Hono<EventEnv>();

eventApp.use('*', async (c, next) => {
	const eventId = c.req.param('eventId');
	if (!eventId) return c.notFound();
	const ctx = await loadEventContext(c.env, eventId);
	if (!ctx) {
		return c.html(
			page(
				'Event not found',
				`<main class="min-h-screen flex flex-col items-center justify-center px-6 py-12">
					<div class="text-center max-w-xl">
						<div class="text-6xl mb-6">🔍</div>
						<h1 class="text-3xl font-bold mb-3">Event not found</h1>
						<p class="text-white/60 mb-8">No active event matches <code class="text-cf-orange">${escapeAttr(eventId)}</code>.</p>
						<a href="/" class="inline-block rounded-full bg-cf-orange px-6 py-3 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">
							Browse events
						</a>
					</div>
				</main>`,
			),
			404,
		);
	}
	c.set('eventCtx', ctx);
	c.set('basePath', `/e/${eventId}`);
	await next();
});

// Mount event-scoped routes
eventApp.route('/', eventLandingRoutes);
eventApp.route('/', privacyRoutes);
eventApp.route('/', kioskIdleRoutes);
eventApp.route('/', kioskCaptureRoutes);
eventApp.route('/', kioskSceneRoutes);
eventApp.route('/', kioskReviewRoutes);
eventApp.route('/', kioskStatusRoutes);
eventApp.route('/', kioskDoneRoutes);
eventApp.route('/', kioskApiRoutes);
eventApp.route('/', galleryRoutes);
eventApp.route('/', sessionWsRoutes);
eventApp.route('/', pickupRoutes);
eventApp.route('/', imagesRoutes);

app.route('/e/:eventId', eventApp);

export default app;
