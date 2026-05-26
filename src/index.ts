import { Hono, type Context } from 'hono';

import { moderateImage } from './lib/moderation';
import { runFlux } from './lib/flux';
import { runReplicate } from './lib/replicate';
import { loadScenes, type Scene } from './lib/scenes';
import { POSTCARD_H, POSTCARD_W, buildPostcard, newPostcardId, qrPng } from './lib/postcard';
import { sendPostcardEmail } from './lib/email';
import { trackEvent } from './lib/analytics';
import { adminAuthMiddleware, clearAdminCookie, setAdminCookie, signAdminToken } from './lib/admin-auth';
import { type AdminSessionRow, type AdminStats, loadAdminSessions, loadAdminStats } from './lib/admin-data';
import { loadEventContext, listEvents, loadEvent, loadAllScenes, invalidateEventCache } from './lib/event-ctx';
import type { EventContext, EventRecord, SceneRecord } from './lib/types';
import { renderSceneOptions } from './components/wordmark';

// ---------------------------------------------------------------------------
// Hono type augmentation for event-scoped routes
// ---------------------------------------------------------------------------

/**
 * Variables set by the event middleware and available on c.get() / c.var
 * inside the /e/:eventId sub-app.
 */
type EventVars = {
	eventCtx: EventContext;
	/** URL prefix for the current event, e.g. "/e/nyc-tech-week-2026" */
	basePath: string;
};

type EventEnv = { Bindings: Env; Variables: EventVars };

/** Shorthand for the event-scoped Hono context. */
type EventCtx = Context<EventEnv>;

export { CaricatureWorkflow } from './workflows/caricature';
export { SessionDO } from './session/session';

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Event-scoped sub-app (/e/:eventId/*)
//
// Middleware loads EventContext from the :eventId URL param and 404s if the
// event doesn't exist or isn't active. All user-facing routes live here;
// admin, test, and utility routes stay on the root app.
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

// Postcard composition (constants, qrPng, encodePng, buildPostcard,
// newPostcardId) lives in src/lib/postcard.ts so the workflow's composite
// step can share it.

// Moderation helpers are now in src/lib/moderation.ts (shared with workflows).

/** Escape a string for safe interpolation inside an HTML attribute value. */
const escapeAttr = (s: string): string =>
	s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${title}</title>
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<link rel="stylesheet" href="/app.css" />
		<link rel="icon" href="/favicon.png" />
	</head>
	<body class="min-h-screen bg-cf-ink text-white font-display antialiased">
		${body}
	</body>
</html>`;

/**
 * Kiosk shell — used for every /kiosk/* screen. Differs from the dev `page()`
 * shell in three ways:
 *   1. viewport locks zoom (kiosks shouldn't be pinch-zoomable)
 *   2. `viewport-fit=cover` so we can paint behind the home indicator
 *   3. `html.h-full` so full-bleed flex layouts work without min-height hacks
 *
 * No dev chrome (no /api/health link, no nav). The kiosk runs in Safari
 * Guided Access — anything that helps the user escape the flow is a bug.
 */
const kioskPage = (title: string, body: string) => `<!doctype html>
<html lang="en" class="h-full">
	<head>
		<meta charset="utf-8" />
		<title>${title}</title>
		<meta
			name="viewport"
			content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
		/>
		<meta name="apple-mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
		<meta name="theme-color" content="#000000" />
		<link rel="stylesheet" href="/app.css" />
		<link rel="icon" href="/favicon.png" />
	</head>
	<!--
		min-h-[100dvh] + overscroll-none = looks like a locked kiosk on iPad
		but degrades gracefully on short desktop windows (content stays
		reachable instead of being clipped behind the bottom of the viewport).
	-->
	<body class="min-h-[100dvh] bg-cf-ink text-white font-display antialiased overscroll-none select-none touch-manipulation">
		${body}
	</body>
</html>`;

eventApp.get('/', async (c) => {
	const { event } = c.get('eventCtx');
	const basePath = c.get('basePath');
	const origin = new URL(c.req.url).origin;
	const eventUrl = `${origin}${basePath}/`;
	const qrSrc = `${basePath}/api/kiosk/qr?url=${encodeURIComponent(eventUrl)}`;
	return c.html(
		page(
			`${event.name} — AI Caricature Booth`,
			`			<div class="fixed top-4 left-4 z-50">
				<img src="${qrSrc}" alt="QR code — scan to open this page"
					class="w-20 sm:w-24 rounded-xl border border-white/10 bg-white p-1.5" />
			</div>
			<main class="px-6 sm:px-8 pb-20">
				<!-- Hero -->
				<section class="max-w-4xl mx-auto pt-12 sm:pt-20 flex flex-col items-center text-center">
					<h1 class="text-[clamp(2rem,5vw,3.5rem)] font-bold leading-tight text-balance">
						AI Caricature Booth
					</h1>
					<p class="mt-4 max-w-xl text-lg text-white/70 text-balance">
						${escapeAttr(event.tagline)}
						Built end-to-end on Cloudflare.
					</p>

					<a href="${basePath}/kiosk"
						class="mt-12 inline-flex items-center justify-center rounded-full bg-cf-orange px-10 py-4 text-base font-bold text-black shadow-[0_0_60px_rgba(246,130,31,0.35)] hover:bg-cf-orange-dark active:scale-[0.98] transition">
						Open the booth
					</a>
				</section>

				<!-- How it works -->
				<section class="max-w-4xl mx-auto mt-24 sm:mt-32">
					<h2 class="text-center text-xs uppercase tracking-[0.3em] text-white/40 mb-8">
						How it works
					</h2>
					<ol class="grid sm:grid-cols-3 gap-4 sm:gap-6">
						<li class="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
							<div class="text-cf-orange font-mono text-xs tracking-widest">STEP 01</div>
							<div class="mt-3 text-lg font-semibold">Snap a selfie</div>
							<p class="mt-2 text-sm text-white/60">
								Step up to the booth and take a photo. No app, no signup.
							</p>
						</li>
						<li class="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
							<div class="text-cf-orange font-mono text-xs tracking-widest">STEP 02</div>
							<div class="mt-3 text-lg font-semibold">Pick a scene</div>
							<p class="mt-2 text-sm text-white/60">
								Choose your backdrop from the scene picker.
							</p>
						</li>
						<li class="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
							<div class="text-cf-orange font-mono text-xs tracking-widest">STEP 03</div>
							<div class="mt-3 text-lg font-semibold">Take home a postcard</div>
							<p class="mt-2 text-sm text-white/60">
								We print it on the spot. Optionally email yourself a digital copy.
							</p>
						</li>
					</ol>
				</section>

				<!-- Built on Cloudflare -->
				<section class="max-w-4xl mx-auto mt-20 sm:mt-24">
					<div class="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-8 sm:px-8">
						<div class="text-center text-xs uppercase tracking-[0.3em] text-white/40">
							Built on Cloudflare
						</div>
						<div class="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-white/70">
							<span>Workers</span>
							<span class="text-white/20">·</span>
							<span>Workers AI</span>
							<span class="text-white/20">·</span>
							<span>Workflows</span>
							<span class="text-white/20">·</span>
							<span>Durable Objects</span>
							<span class="text-white/20">·</span>
							<span>D1</span>
							<span class="text-white/20">·</span>
							<span>R2</span>
							<span class="text-white/20">·</span>
							<span>KV</span>
							<span class="text-white/20">·</span>
							<span>Analytics Engine</span>
						</div>
					</div>
				</section>
			</main>

			<footer class="px-6 sm:px-8 pb-10 text-center text-[11px] uppercase tracking-[0.25em] text-white/30">
				We don't store your photo after the event &middot;
				<a href="${basePath}/privacy" class="underline underline-offset-2 hover:text-white/50">Privacy</a>
			</footer>`,
		),
	);
});

app.get('/api/health', (c) => {
	return c.json({ status: 'ok', step: '11.4' });
});

// ---------------------------------------------------------------------------
// Admin auth (Phase 10.1)
//
// Cookie-based auth for the /admin/* dashboard. The middleware runs on every
// /admin/* and /api/admin/* route. /admin/login (GET + POST) and /admin/logout
// are exempt inside the middleware itself.
// ---------------------------------------------------------------------------

app.use('/admin/*', adminAuthMiddleware());
app.use('/api/admin/*', adminAuthMiddleware());

// ---- Admin server-side rendering helpers (10.2) -----------------------------

/**
 * Escape a JSON string for safe embedding inside a <script>…</script> block.
 * Without this, a `</script>` substring inside the JSON would close the tag.
 * U+2028/U+2029 are also legal in JSON but illegal in raw JS source.
 */
function escapeScriptJson(json: string): string {
	return json
		.replace(/<\/script/gi, '<\\/script')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}

/** Status pill class — must match the client-side `statusClass` in /admin JS. */
function adminStatusClass(s: string): string {
	if (s === 'completed') return 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/30';
	if (s === 'errored') return 'bg-red-500/20 text-red-300 ring-red-400/30';
	if (!s || s === 'pending') return 'bg-white/10 text-white/60 ring-white/20';
	return 'bg-amber-500/20 text-amber-300 ring-amber-400/30';
}

function adminPrintClass(s: string | null): string {
	if (s === 'printed') return 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/30';
	if (s === 'failed') return 'bg-red-500/20 text-red-300 ring-red-400/30';
	if (s === 'printing') return 'bg-cf-orange/20 text-cf-orange ring-cf-orange/30';
	if (s === 'pending') return 'bg-amber-500/20 text-amber-300 ring-amber-400/30';
	return 'bg-white/5 text-white/40 ring-white/10';
}

/**
 * Server-side, we emit a <time data-ts="<unix-seconds>"> placeholder and
 * let the client JS format it in the viewer's locale on load. This avoids
 * the "flips from UTC 24h to local AM/PM after the first poll" bug.
 */
function adminTimeTag(secs: number | null): string {
	if (!secs) return `<span class="text-white/40">—</span>`;
	return `<time data-ts="${secs}" class="whitespace-nowrap">…</time>`;
}

function adminFmtDuration(ms: number | null): string {
	if (ms == null) return '—';
	if (ms < 1000) return `${ms} ms`;
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return `${m}m ${s % 60}s`;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function adminFmtAvg(secs: number | null): string {
	if (secs == null) return '—';
	if (secs < 60) return `${secs.toFixed(1)}s`;
	const m = Math.floor(secs / 60);
	const s = Math.round(secs - m * 60);
	return `${m}m ${s}s`;
}

function statCard(label: string, value: string, accentCls = 'text-white'): string {
	return (
		`<div class="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">` +
		`<div class="text-[10px] uppercase tracking-widest text-white/40">${escapeHtml(label)}</div>` +
		`<div class="mt-1 text-2xl font-bold ${accentCls}">${escapeHtml(value)}</div>` +
		`</div>`
	);
}

function renderAdminStatCards(stats: AdminStats): string {
	return (
		statCard('Total', String(stats.totalSessions)) +
		statCard('Completed', String(stats.completed), 'text-emerald-300') +
		statCard('Errored', String(stats.errored), 'text-red-300') +
		statCard('Avg pipeline', adminFmtAvg(stats.avgPipelineSec)) +
		statCard('Emails', String(stats.emailsCollected), 'text-cf-orange') +
		statCard('Printed', String(stats.postcardsPrinted), 'text-cf-orange')
	);
}

function renderAdminSceneBreakdown(stats: AdminStats): string {
	if (stats.sceneBreakdown.length === 0) {
		return `<span class="text-xs text-white/40">No scenes used yet.</span>`;
	}
	return stats.sceneBreakdown
		.map(
			(s) =>
				`<span class="inline-flex items-center gap-2 rounded-full bg-white/[0.04] border border-white/10 px-3 py-1.5 text-xs">` +
				`<span class="text-white/80">${escapeHtml(s.sceneName)}</span>` +
				`<span class="text-white/40">·</span>` +
				`<span class="font-mono text-cf-orange">${s.count}</span>` +
				`</span>`,
		)
		.join('');
}

function renderAdminTableBody(rows: AdminSessionRow[]): string {
	if (rows.length === 0) {
		return `<tr><td colspan="8" class="px-4 py-8 text-center text-white/40">No sessions yet.</td></tr>`;
	}
	return rows
		.map((r) => {
			const shortId = r.sessionId.slice(0, 8);
			const status = r.status || 'pending';
			const printStatus = r.printStatus ?? '—';
			return (
				`<tr class="hover:bg-white/[0.03]">` +
				`<td class="px-4 py-3 font-mono text-xs text-white/80">${escapeHtml(shortId)}</td>` +
				`<td class="px-4 py-3"><span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${adminStatusClass(status)}">${escapeHtml(status)}</span></td>` +
				`<td class="px-4 py-3 text-white/80">${escapeHtml(r.sceneName ?? '—')}</td>` +
				`<td class="px-4 py-3 text-white/60 whitespace-nowrap">${adminTimeTag(r.createdAt)}</td>` +
				`<td class="px-4 py-3 text-white/60 whitespace-nowrap">${escapeHtml(adminFmtDuration(r.pipelineDurationMs))}</td>` +
				`<td class="px-4 py-3 text-white/60">${escapeHtml(r.emailMasked ?? '—')}</td>` +
				`<td class="px-4 py-3"><span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${adminPrintClass(r.printStatus)}">${escapeHtml(printStatus)}</span></td>` +
				`<td class="px-4 py-3 text-right whitespace-nowrap">${renderAdminRowActions(r)}</td>` +
				`</tr>`
			);
		})
		.join('');
}

/**
 * Per-row action buttons. Both buttons appear for any completed session with
 * a postcard; the underlying endpoints are idempotent and will toast the
 * appropriate "already queued" / "no email on file" response.
 *
 *   - "Retry print"  → completed (POST /api/kiosk/print is idempotent: returns
 *                      `alreadyQueued` for pending/printing/printed, only
 *                      actually inserts a new row for failed/missing jobs)
 *   - "Resend email" → completed + hasEmail
 *
 * Each button carries data-action + data-session for the JS click delegator.
 */
function renderAdminRowActions(r: AdminSessionRow): string {
	const buttons: string[] = [];
	const isCompleted = r.status === 'completed' && !!r.postcardKey;
	if (isCompleted) {
		buttons.push(
			`<button type="button"
				data-action="retry-print"
				data-session="${escapeAttr(r.sessionId)}"
				class="inline-flex items-center rounded-full border border-cf-orange/40 bg-cf-orange/10 px-3 py-1 text-xs text-cf-orange hover:bg-cf-orange/20 hover:border-cf-orange/60 disabled:opacity-50 disabled:cursor-not-allowed transition">
				🖨️ Retry print
			</button>`,
		);
	}
	if (r.hasEmail && isCompleted) {
		buttons.push(
			`<button type="button"
				data-action="resend-email"
				data-session="${escapeAttr(r.sessionId)}"
				class="inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-white/80 hover:border-white/30 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition">
				📧 Resend email
			</button>`,
		);
	}
	// Delete button — always available (privacy right-to-delete).
	buttons.push(
		`<button type="button"
			data-action="delete-session"
			data-session="${escapeAttr(r.sessionId)}"
			class="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-400 hover:bg-red-500/20 hover:border-red-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition">
			🗑️ Delete
		</button>`,
	);
	return `<div class="inline-flex items-center gap-1.5 justify-end">${buttons.join('')}</div>`;
}

/**
 * Login form. Plain HTML, single password field. Honors a `?next=` redirect
 * target (only relative URLs, to avoid open-redirects).
 */
app.get('/admin/login', (c) => {
	const next = c.req.query('next') ?? '/admin';
	const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/admin';
	const errMsg = c.req.query('err') === '1' ? 'Wrong password.' : '';

	return c.html(
		page(
			'Admin · Caricature Booth',
			`<main class="min-h-screen flex flex-col items-center justify-center px-6">
				<div class="w-full max-w-sm">
					<div class="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-white/50 justify-center">
						Booth admin
					</div>
					<h1 class="mt-3 text-3xl font-bold text-center">Sign in</h1>
					<p class="mt-1 text-sm text-white/60 text-center">Restricted — staff only.</p>

					<form method="POST" action="/admin/login" class="mt-8 flex flex-col gap-3">
						<input type="hidden" name="next" value="${escapeAttr(safeNext)}" />
						<label class="text-xs uppercase tracking-widest text-white/50" for="pw">Password</label>
						<input
							id="pw"
							name="password"
							type="password"
							required
							autofocus
							autocomplete="current-password"
							class="rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-base text-white outline-none focus:border-cf-orange/60 focus:bg-white/10"
						/>
						${errMsg ? `<p class="text-sm text-red-400">${errMsg}</p>` : ''}
						<button
							type="submit"
							class="mt-2 rounded-full bg-cf-orange px-6 py-3 text-base font-bold text-black hover:bg-cf-orange-dark active:scale-[0.98] transition"
						>
							Sign in
						</button>
					</form>
					<p class="mt-8 text-center text-[11px] uppercase tracking-[0.25em] text-white/30">
						<a href="/" class="hover:text-white/60">← Back to site</a>
					</p>
				</div>
			</main>`,
		),
	);
});

/**
 * Login submit. Accepts either form-urlencoded or JSON {password, next?}.
 * On success: sets the cookie and 303-redirects to `next` (or /admin).
 * On failure: redirects back to /admin/login?err=1&next=<next>.
 */
app.post('/admin/login', async (c) => {
	const password = c.env.ADMIN_PASSWORD;
	if (!password) {
		return c.text('ADMIN_PASSWORD not configured', 500);
	}

	let submitted = '';
	let next = '/admin';
	const ct = c.req.header('content-type') ?? '';

	if (ct.includes('application/json')) {
		try {
			const body = (await c.req.json()) as { password?: unknown; next?: unknown };
			submitted = typeof body.password === 'string' ? body.password : '';
			if (typeof body.next === 'string') next = body.next;
		} catch {
			// fall through with empty submitted → will fail
		}
	} else {
		const form = await c.req.parseBody();
		submitted = typeof form.password === 'string' ? form.password : '';
		if (typeof form.next === 'string') next = form.next;
	}

	// Sanitize `next` — must be a same-origin path.
	const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/admin';

	if (submitted !== password) {
		return c.redirect(`/admin/login?err=1&next=${encodeURIComponent(safeNext)}`, 302);
	}

	const token = await signAdminToken(password);
	setAdminCookie(c, token);
	return c.redirect(safeNext, 303);
});

/**
 * Logout — clear the cookie and bounce to the login screen.
 */
app.get('/admin/logout', (c) => {
	clearAdminCookie(c);
	return c.redirect('/admin/login', 302);
});

/**
 * Admin metrics page (Phase 11.4).
 *
 * Queries the Analytics Engine SQL API for event counts over the last 24h.
 * Requires the AE_API_TOKEN secret (Account Analytics Read permission).
 * If the token isn't set, shows a setup message instead of crashing.
 *
 * GET /admin/metrics
 */
app.get('/admin/metrics', async (c) => {
	const apiToken = c.env.AE_API_TOKEN;
	const accountId = 'e9bc21da719562a3e45d77de7dd042de';

	const noTokenHtml = `<main class="min-h-screen px-6 py-8 max-w-4xl mx-auto">
		<header class="flex items-center justify-between mb-8">
			<div>
				<div class="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-white/50">
					Booth admin
				</div>
				<h1 class="mt-1 text-2xl font-bold">Event metrics</h1>
			</div>
			<div class="flex items-center gap-4 text-xs text-white/50">
				<a href="/admin" class="text-cf-orange hover:text-white underline underline-offset-4">\u2190 Dashboard</a>
				<a href="/admin/events" class="text-cf-orange hover:text-white underline underline-offset-4">Events</a>
				<a href="/admin/logout" class="text-cf-orange hover:text-white underline underline-offset-4">Sign out</a>
			</div>
		</header>
		<div class="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
			<p class="text-white/60 mb-4">Analytics Engine querying requires an API token.</p>
			<p class="text-xs text-white/40">Run <code class="text-cf-orange">npx wrangler secret put AE_API_TOKEN</code> with a token that has <em>Account Analytics Read</em> permission.</p>
		</div>
	</main>`;

	if (!apiToken) {
		return c.html(page('Metrics \u2014 Admin', noTokenHtml));
	}

	return c.html(
		page(
			'Metrics \u2014 Admin',
			`<main class="min-h-screen px-6 py-8 max-w-4xl mx-auto">
				<header class="flex items-center justify-between mb-8">
					<div>
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-white/50">
							Booth admin
						</div>
						<h1 class="mt-1 text-2xl font-bold">Event metrics</h1>
						<p class="text-xs text-white/40 mt-1">Last 24 hours \u2014 from Analytics Engine</p>
					</div>
					<div class="flex items-center gap-4 text-xs text-white/50">
						<a href="/admin" class="text-cf-orange hover:text-white underline underline-offset-4">\u2190 Dashboard</a>
						<a href="/admin/events" class="text-cf-orange hover:text-white underline underline-offset-4">Events</a>
						<a href="/admin/logout" class="text-cf-orange hover:text-white underline underline-offset-4">Sign out</a>
					</div>
				</header>

				<section id="metrics-cards" class="mb-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
					<div class="col-span-full text-center text-white/40 py-8">Loading metrics\u2026</div>
				</section>

				<section class="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
					<div class="px-5 py-4 border-b border-white/5">
						<h2 class="text-sm font-semibold text-white/80">Events timeline (hourly)</h2>
					</div>
					<div id="metrics-timeline" class="p-5 min-h-[200px]">
						<div class="text-center text-white/40 py-8">Loading\u2026</div>
					</div>
				</section>

				<p id="metrics-updated" class="mt-4 text-center text-[11px] uppercase tracking-widest text-white/30"></p>
			</main>
			<script>
			(function () {
				var cardsEl = document.getElementById("metrics-cards");
				var timelineEl = document.getElementById("metrics-timeline");
				var updatedEl = document.getElementById("metrics-updated");

				function escapeHtml(s) {
					return String(s == null ? "" : s)
						.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
				}

				function renderCard(label, value, accent) {
					return '<div class="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">'
						+ '<div class="text-[10px] uppercase tracking-widest text-white/40">' + escapeHtml(label) + '</div>'
						+ '<div class="mt-1 text-2xl font-bold ' + (accent || "text-white") + '">' + escapeHtml(String(value)) + '</div>'
						+ '</div>';
				}

				function renderTimeline(rows) {
					if (!rows || rows.length === 0) {
						return '<div class="text-center text-white/40 py-8">No events in the last 24 hours.</div>';
					}
					// Simple text table
					var html = '<div class="overflow-x-auto"><table class="w-full text-xs">';
					html += '<thead class="text-left text-[10px] uppercase tracking-widest text-white/40"><tr>';
					html += '<th class="px-3 py-2 font-medium">Hour</th>';
					html += '<th class="px-3 py-2 font-medium text-right">Events</th>';
					html += '<th class="px-3 py-2 font-medium">Bar</th>';
					html += '</tr></thead><tbody class="divide-y divide-white/5">';
					var maxCount = Math.max.apply(null, rows.map(function (r) { return r.count; }));
					for (var i = 0; i < rows.length; i++) {
						var r = rows[i];
						var pct = maxCount > 0 ? Math.round((r.count / maxCount) * 100) : 0;
						html += '<tr class="hover:bg-white/[0.02]">';
						html += '<td class="px-3 py-2 text-white/60 whitespace-nowrap">' + escapeHtml(r.hour) + '</td>';
						html += '<td class="px-3 py-2 text-right font-mono text-white/80">' + r.count + '</td>';
						html += '<td class="px-3 py-2 w-full"><div class="h-4 rounded bg-cf-orange/30" style="width:' + pct + '%"></div></td>';
						html += '</tr>';
					}
					html += '</tbody></table></div>';
					return html;
				}

				async function loadMetrics() {
					try {
						var res = await fetch("/api/admin/metrics", { credentials: "same-origin" });
						if (res.status === 401) { window.location.href = "/admin/login"; return; }
						if (!res.ok) throw new Error("HTTP " + res.status);
						var data = await res.json();

						// Render cards
						var counts = data.counts || {};
						cardsEl.innerHTML = ""
							+ renderCard("Sessions", counts["session.created"] || 0)
							+ renderCard("Completed", counts["workflow.done"] || 0, "text-emerald-300")
							+ renderCard("Errored", counts["workflow.errored"] || 0, "text-red-300")
							+ renderCard("Prints requested", counts["print.requested"] || 0)
							+ renderCard("Prints completed", counts["print.completed"] || 0, "text-emerald-300")
							+ renderCard("Prints failed", counts["print.failed"] || 0, "text-red-300")
							+ renderCard("Emails captured", counts["email.captured"] || 0, "text-cf-orange")
							+ renderCard("Sessions deleted", counts["session.deleted"] || 0);

						// Render timeline
						timelineEl.innerHTML = renderTimeline(data.timeline || []);

						updatedEl.textContent = "Updated " + new Date().toLocaleTimeString();
					} catch (err) {
						console.error("[metrics] load failed:", err);
						cardsEl.innerHTML = '<div class="col-span-full text-center text-red-400 py-4">Failed to load metrics: ' + escapeHtml(err.message) + '</div>';
					}
				}

				loadMetrics();
			})();
			</script>`,
		),
	);
});

/**
 * Metrics JSON feed — queries Analytics Engine SQL API.
 * GET /api/admin/metrics
 *
 * Returns { counts: { eventName: number }, timeline: [{ hour, count }] }
 */
app.get('/api/admin/metrics', async (c) => {
	const apiToken = c.env.AE_API_TOKEN;
	if (!apiToken) {
		return c.json({ error: 'AE_API_TOKEN not configured' }, 503);
	}

	const accountId = 'e9bc21da719562a3e45d77de7dd042de';
	const aeUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;

	async function aeQuery(sql: string) {
		const res = await fetch(aeUrl, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiToken}` },
			body: sql,
		});
		if (!res.ok) {
			const text = await res.text();
			console.error(`[metrics] AE query failed HTTP ${res.status}: ${text}`);
			return null;
		}
		return (await res.json()) as { data: Record<string, unknown>[]; rows: number };
	}

	// Query 1: event counts for last 24h
	const countsResult = await aeQuery(`
		SELECT blob1 AS event_name, SUM(_sample_interval) AS count
		FROM nyc_booth_events
		WHERE timestamp > NOW() - INTERVAL '1' DAY
		GROUP BY event_name
		ORDER BY count DESC
	`);

	// Query 2: hourly timeline for last 24h
	const timelineResult = await aeQuery(`
		SELECT
			toStartOfInterval(timestamp, INTERVAL '1' HOUR) AS hour,
			SUM(_sample_interval) AS count
		FROM nyc_booth_events
		WHERE timestamp > NOW() - INTERVAL '1' DAY
		GROUP BY hour
		ORDER BY hour ASC
	`);

	const counts: Record<string, number> = {};
	if (countsResult?.data) {
		for (const row of countsResult.data) {
			counts[String(row.event_name)] = Number(row.count) || 0;
		}
	}

	const timeline: { hour: string; count: number }[] = [];
	if (timelineResult?.data) {
		for (const row of timelineResult.data) {
			timeline.push({
				hour: String(row.hour),
				count: Number(row.count) || 0,
			});
		}
	}

	return c.json({ counts, timeline });
});

/**
 * Admin dashboard (Phase 10.2).
 *
 * Server-renders the initial sessions table; client polls /api/admin/sessions
 * every 10s and re-renders the <tbody>. Stats / manual controls land in 10.3 + 10.4.
 */
app.get('/admin', async (c) => {
	const [rows, stats] = await Promise.all([loadAdminSessions(c.env), loadAdminStats(c.env)]);
	const initialJson = JSON.stringify({ sessions: rows, stats });

	return c.html(
		page(
			'Admin dashboard',
			`<main class="min-h-screen px-6 py-8 max-w-6xl mx-auto">
				<header class="flex items-center justify-between mb-8">
					<div>
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-white/50">
							Booth admin
						</div>
						<h1 class="mt-1 text-2xl font-bold">Live sessions</h1>
					</div>
					<div class="flex items-center gap-4 text-xs text-white/50">
						<span id="admin-poll-indicator" class="inline-flex items-center gap-2">
							<span class="size-2 rounded-full bg-emerald-400 animate-pulse"></span>
							<span>Auto-refresh · 10s</span>
						</span>
						<a href="/admin/events" class="text-cf-orange hover:text-white underline underline-offset-4">Events</a>
						<a href="/admin/metrics" class="text-cf-orange hover:text-white underline underline-offset-4">Metrics</a>
						<a href="/admin/logout" class="text-cf-orange hover:text-white underline underline-offset-4">Sign out</a>
					</div>
				</header>



				<!-- Notyf toast library (loaded only on /admin) -->
				<link rel="stylesheet" href="https://unpkg.com/notyf@3.10.0/notyf.min.css" />
				<script src="https://unpkg.com/notyf@3.10.0/notyf.min.js"></script>
				<style>
					/* Theme Notyf to match the dashboard (orange success, red error).
					   The library wraps its checkmark/x glyph in a circular .notyf__icon
					   tile with a default gray background — we make that tile transparent
					   so only the glyph shows on top of the toast color. */
					.notyf__toast { font-family: inherit; border-radius: 12px; }
					.notyf__toast--success { background: #f6821f; }
					.notyf__toast--error   { background: #ef4444; }
					.notyf__icon { background: transparent !important; }
					.notyf__icon-success, .notyf__icon-error {
						background: transparent !important;
						border-color: rgba(255,255,255,0.9) !important;
					}
					.notyf__icon-success::after, .notyf__icon-success::before,
					.notyf__icon-error::after,   .notyf__icon-error::before {
						background: #ffffff !important;
					}
					.notyf__message { font-weight: 500; }
				</style>

				<section id="admin-stats" class="mb-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
					${renderAdminStatCards(stats)}
				</section>

				<section class="mb-8 rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4">
					<div class="flex items-center justify-between mb-3">
						<h2 class="text-sm font-semibold text-white/80">Sessions by scene</h2>
						<span class="text-[11px] uppercase tracking-widest text-white/40">All-time</span>
					</div>
					<div id="admin-scene-breakdown" class="flex flex-wrap gap-2">
						${renderAdminSceneBreakdown(stats)}
					</div>
				</section>

				<section class="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead class="bg-white/5 text-left text-[11px] uppercase tracking-widest text-white/50">
								<tr>
									<th class="px-4 py-3 font-medium">Session</th>
									<th class="px-4 py-3 font-medium">Status</th>
									<th class="px-4 py-3 font-medium">Scene</th>
									<th class="px-4 py-3 font-medium">Created</th>
									<th class="px-4 py-3 font-medium">Duration</th>
									<th class="px-4 py-3 font-medium">Email</th>
									<th class="px-4 py-3 font-medium">Print</th>
									<th class="px-4 py-3 font-medium text-right">Actions</th>
								</tr>
							</thead>
							<tbody id="admin-tbody" class="divide-y divide-white/5">
								${renderAdminTableBody(rows)}
							</tbody>
						</table>
					</div>
					<div class="px-4 py-2 text-[11px] uppercase tracking-widest text-white/40 border-t border-white/5 flex items-center justify-between">
						<span><span id="admin-row-count">${rows.length}</span> sessions · last 30</span>
						<span id="admin-last-updated">Updated just now</span>
					</div>
				</section>
			</main>

			<script id="admin-initial" type="application/json">${escapeScriptJson(initialJson)}</script>
			<script>
			(function () {
				var initialEl = document.getElementById("admin-initial");
				var lastSnapshot = JSON.parse(initialEl.textContent || '{"sessions":[],"stats":null}');
				var tbody = document.getElementById("admin-tbody");
				var rowCount = document.getElementById("admin-row-count");
				var lastUpdated = document.getElementById("admin-last-updated");
				var statsEl = document.getElementById("admin-stats");
				var sceneEl = document.getElementById("admin-scene-breakdown");

				function escapeHtml(s) {
					return String(s == null ? "" : s)
						.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
						.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
				}

				function statusClass(s) {
					if (s === "completed") return "bg-emerald-500/20 text-emerald-300 ring-emerald-400/30";
					if (s === "errored")   return "bg-red-500/20 text-red-300 ring-red-400/30";
					if (!s || s === "pending") return "bg-white/10 text-white/60 ring-white/20";
					// queued | moderating | generating | compositing
					return "bg-amber-500/20 text-amber-300 ring-amber-400/30";
				}

				function printClass(s) {
					if (s === "printed")  return "bg-emerald-500/20 text-emerald-300 ring-emerald-400/30";
					if (s === "failed")   return "bg-red-500/20 text-red-300 ring-red-400/30";
					if (s === "printing") return "bg-cf-orange/20 text-cf-orange ring-cf-orange/30";
					if (s === "pending")  return "bg-amber-500/20 text-amber-300 ring-amber-400/30";
					return "bg-white/5 text-white/40 ring-white/10";
				}

				function fmtTs(secs) {
					if (!secs) return "—";
					var d = new Date(Number(secs) * 1000);
					return d.toLocaleString(undefined, {
						month: "short", day: "numeric",
						hour: "numeric", minute: "2-digit",
					});
				}

				// Format every <time data-ts="..."> on the page in the viewer's locale.
				// Called once on initial load (server emits placeholders) and again
				// after each poll re-render.
				function formatTimes() {
					var nodes = document.querySelectorAll("time[data-ts]");
					for (var i = 0; i < nodes.length; i++) {
						var n = nodes[i];
						var secs = Number(n.getAttribute("data-ts"));
						if (secs > 0) n.textContent = fmtTs(secs);
					}
				}

				function fmtDuration(ms) {
					if (ms == null) return "—";
					if (ms < 1000) return ms + " ms";
					var s = Math.round(ms / 1000);
					if (s < 60) return s + "s";
					var m = Math.floor(s / 60);
					return m + "m " + (s % 60) + "s";
				}

				function renderActions(r) {
					var buttons = [];
					var isCompleted = r.status === "completed" && !!r.postcardKey;
					if (isCompleted) {
						buttons.push(
							'<button type="button" data-action="retry-print" data-session="' + escapeHtml(r.sessionId) + '"'
							+ ' class="inline-flex items-center rounded-full border border-cf-orange/40 bg-cf-orange/10 px-3 py-1 text-xs text-cf-orange hover:bg-cf-orange/20 hover:border-cf-orange/60 disabled:opacity-50 disabled:cursor-not-allowed transition">🖨️ Retry print</button>'
						);
					}
					if (r.hasEmail && isCompleted) {
						buttons.push(
							'<button type="button" data-action="resend-email" data-session="' + escapeHtml(r.sessionId) + '"'
							+ ' class="inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-white/80 hover:border-white/30 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition">📧 Resend email</button>'
						);
					}
					// Delete button — always available (privacy right-to-delete).
					buttons.push(
						'<button type="button" data-action="delete-session" data-session="' + escapeHtml(r.sessionId) + '"'
						+ ' class="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-400 hover:bg-red-500/20 hover:border-red-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition">🗑️ Delete</button>'
					);
					return '<div class="inline-flex items-center gap-1.5 justify-end">' + buttons.join("") + '</div>';
				}

				function renderTimeTag(secs) {
					if (!secs) return '<span class="text-white/40">—</span>';
					return '<time data-ts="' + Number(secs) + '" class="whitespace-nowrap">' + escapeHtml(fmtTs(secs)) + '</time>';
				}

				function renderRow(r) {
					var shortId = (r.sessionId || "").slice(0, 8);
					var status = r.status || "pending";
					var printStatus = r.printStatus || "—";
					return ''
						+ '<tr class="hover:bg-white/[0.03]">'
						+ '<td class="px-4 py-3 font-mono text-xs text-white/80">' + escapeHtml(shortId) + '</td>'
						+ '<td class="px-4 py-3"><span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ' + statusClass(status) + '">' + escapeHtml(status) + '</span></td>'
						+ '<td class="px-4 py-3 text-white/80">' + escapeHtml(r.sceneName || "—") + '</td>'
						+ '<td class="px-4 py-3 text-white/60 whitespace-nowrap">' + renderTimeTag(r.createdAt) + '</td>'
						+ '<td class="px-4 py-3 text-white/60 whitespace-nowrap">' + escapeHtml(fmtDuration(r.pipelineDurationMs)) + '</td>'
						+ '<td class="px-4 py-3 text-white/60">' + escapeHtml(r.emailMasked || "—") + '</td>'
						+ '<td class="px-4 py-3"><span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ' + printClass(r.printStatus) + '">' + escapeHtml(printStatus) + '</span></td>'
						+ '<td class="px-4 py-3 text-right whitespace-nowrap">' + renderActions(r) + '</td>'
						+ '</tr>';
				}

				function fmtAvg(secs) {
					if (secs == null) return "—";
					if (secs < 60) return secs.toFixed(1) + "s";
					var m = Math.floor(secs / 60);
					var s = Math.round(secs - m * 60);
					return m + "m " + s + "s";
				}

				function renderStatCard(label, value, accent) {
					var accentCls = accent || "text-white";
					return ''
						+ '<div class="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">'
						+ '<div class="text-[10px] uppercase tracking-widest text-white/40">' + escapeHtml(label) + '</div>'
						+ '<div class="mt-1 text-2xl font-bold ' + accentCls + '">' + escapeHtml(value) + '</div>'
						+ '</div>';
				}

				function renderStats(stats) {
					if (!stats) return;
					statsEl.innerHTML = ''
						+ renderStatCard("Total", String(stats.totalSessions))
						+ renderStatCard("Completed", String(stats.completed), "text-emerald-300")
						+ renderStatCard("Errored", String(stats.errored), "text-red-300")
						+ renderStatCard("Avg pipeline", fmtAvg(stats.avgPipelineSec))
						+ renderStatCard("Emails", String(stats.emailsCollected), "text-cf-orange")
						+ renderStatCard("Printed", String(stats.postcardsPrinted), "text-cf-orange");

					var scenes = stats.sceneBreakdown || [];
					if (scenes.length === 0) {
						sceneEl.innerHTML = '<span class="text-xs text-white/40">No scenes used yet.</span>';
					} else {
						sceneEl.innerHTML = scenes.map(function (s) {
							return '<span class="inline-flex items-center gap-2 rounded-full bg-white/[0.04] border border-white/10 px-3 py-1.5 text-xs">'
								+ '<span class="text-white/80">' + escapeHtml(s.sceneName) + '</span>'
								+ '<span class="text-white/40">·</span>'
								+ '<span class="font-mono text-cf-orange">' + s.count + '</span>'
								+ '</span>';
						}).join("");
					}
				}

				function renderSessions(sessions) {
					if (sessions.length === 0) {
						tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-white/40">No sessions yet.</td></tr>';
					} else {
						tbody.innerHTML = sessions.map(renderRow).join("");
					}
					rowCount.textContent = String(sessions.length);
				}

				function render(snapshot) {
					renderSessions(snapshot.sessions || []);
					if (snapshot.stats) renderStats(snapshot.stats);
					formatTimes();
					lastUpdated.textContent = "Updated " + new Date().toLocaleTimeString();
				}

				async function poll() {
					try {
						var results = await Promise.all([
							fetch("/api/admin/sessions", { credentials: "same-origin" }),
							fetch("/api/admin/stats",    { credentials: "same-origin" }),
						]);
						if (results[0].status === 401 || results[1].status === 401) {
							window.location.href = "/admin/login";
							return;
						}
						if (!results[0].ok || !results[1].ok) {
							throw new Error("HTTP " + results[0].status + "/" + results[1].status);
						}
						var sessionsBody = await results[0].json();
						var stats = await results[1].json();
						lastSnapshot = { sessions: sessionsBody.sessions, stats: stats };
						render(lastSnapshot);
					} catch (err) {
						console.error("[admin] poll failed:", err);
					}
				}

				// ----- Manual controls (10.4) -----
				// Notyf is loaded from CDN above. We init once with bottom-right
				// positioning, 4s duration, and dismiss-on-click for sticky errors.
				var notyf = new Notyf({
					duration: 4000,
					position: { x: "right", y: "bottom" },
					dismissible: true,
					ripple: false,
				});
				function toast(msg, isError) {
					if (isError) notyf.error(msg);
					else         notyf.success(msg);
				}

				async function callJson(url, opts) {
					var r = await fetch(url, Object.assign({ credentials: "same-origin" }, opts || {}));
					if (r.status === 401) {
						window.location.href = "/admin/login";
						throw new Error("unauthorized");
					}
					var body = await r.json().catch(function () { return {}; });
					if (!r.ok) {
						var err = (body && body.error) ? body.error : ("HTTP " + r.status);
						throw new Error(err);
					}
					return body;
				}

				// Per-row action buttons (delegated)
				tbody.addEventListener("click", function (ev) {
					var btn = ev.target.closest && ev.target.closest("button[data-action]");
					if (!btn) return;
					var action = btn.getAttribute("data-action");
					var sessionId = btn.getAttribute("data-session");
					if (!sessionId) return;
					if (btn.disabled) return;
					btn.disabled = true;
					var shortId = sessionId.slice(0, 8);

					var promise;
					if (action === "retry-print") {
						// /api/admin/reprint always inserts a new print_jobs row,
						// unlike /api/kiosk/print which is idempotent. Staff need the
						// unconditional path so they can recover from physical jams /
						// print bad copies / hand out duplicate postcards.
						promise = callJson("/api/admin/reprint/" + encodeURIComponent(sessionId), {
							method: "POST",
						}).then(function () {
							toast("Queued reprint for " + shortId);
							// Force a quick refresh so the new print_status pill shows up.
							poll();
						});
					} else if (action === "resend-email") {
						promise = callJson("/api/admin/resend-email/" + encodeURIComponent(sessionId), {
							method: "POST",
						}).then(function () {
							toast("Resent email for " + shortId);
						});
					} else if (action === "delete-session") {
						if (!confirm("Permanently delete ALL data for session " + shortId + "...?" + "\\n\\n" + "This removes the selfie, caricature, postcard, print jobs, and email from our systems. Cannot be undone.")) {
							btn.disabled = false;
							return;
						}
						promise = callJson("/api/admin/session/" + encodeURIComponent(sessionId), {
							method: "DELETE",
						}).then(function (j) {
							toast("Deleted session " + shortId + " (" + (j.deleted || []).length + " items)");
							poll();
						});
					} else {
						btn.disabled = false;
						return;
					}

					promise.catch(function (err) {
						toast("Failed: " + err.message, true);
					}).finally(function () {
						btn.disabled = false;
					});
				});



				// Initial paint is server-rendered; format the timestamp placeholders
				// in the viewer's locale right away so they don't show "…" for 10s.
				formatTimes();

				// First client refresh fires after 10s.
				setInterval(poll, 10000);
			})();
			</script>`,
		),
	);
});

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

/**
 * Manual control: force-enqueue a new print job for a session, even if one
 * already exists. Unlike POST /api/kiosk/print (which is idempotent so an
 * attendee can't spam the queue from /kiosk/done), this endpoint always
 * inserts a fresh print_jobs row. Use cases:
 *   - Physical postcard jammed / printed badly — staff need another copy
 *   - Attendee wants a second postcard
 *   - The job is marked `printed` in D1 but the agent crashed before delivery
 *
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
 * Manual control: re-fire the postcard email for a session. Looks up the
 * session's existing email + postcard and calls sendPostcardEmail() via
 * waitUntil — same code path as the original opt-in flow. The email body
 * itself is currently stubbed (see lib/email.ts) so this primarily exercises
 * the wiring; once real sending is enabled this lets staff bail people out
 * who didn't get the original message.
 *
 * POST /api/admin/resend-email/:id
 */
app.post('/api/admin/resend-email/:id', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) {
		return c.json({ error: 'invalid session id' }, 400);
	}

	const session = await c.env.DB.prepare('SELECT id, status, postcard_key, scene_name, email FROM sessions WHERE id = ?').bind(id).first<{
		id: string;
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
	const email = session.email;
	const postcardKey = session.postcard_key;
	const sceneName = session.scene_name ?? 'Scene';

	console.log(`[admin-resend] session=${id} email=${email.slice(0, 3)}***`);

	c.executionCtx.waitUntil(
		sendPostcardEmail(c.env, {
			to: email,
			sessionId: id,
			sceneName,
			pickupUrl: `${origin}/p/${id}`,
			postcardImageUrl: `${origin}/api/run-img?key=${encodeURIComponent(postcardKey)}`,
			downloadUrl: `${origin}/api/run-img?key=${encodeURIComponent(postcardKey)}&download=1`,
		}).catch((err) => {
			console.error(`[admin-resend] send failed session=${id} err=${err}`);
		}),
	);

	return c.json({ ok: true, queued: true });
});



/**
 * Manual control: delete all data for a session (privacy right-to-delete).
 *
 * Removes:
 *   - D1 sessions row
 *   - D1 print_jobs rows for this session
 *   - R2 objects: kiosk/<id>/selfie.jpg, runs/<id>/caricature.*, runs/<id>/postcard.jpg
 *   - SessionDO storage (if the DO is still alive)
 *
 * Does NOT recall already-printed physical postcards — that's out of scope.
 * After deletion, /p/:id shows the branded 404.
 *
 * DELETE /api/admin/session/:id
 */
app.delete('/api/admin/session/:id', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) {
		return c.json({ error: 'invalid session id' }, 400);
	}

	// Check the session exists before doing destructive work.
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

	// 1. Delete R2 objects. We try all known key patterns; missing keys
	//    are silently ignored by R2.delete().
	const r2Keys = [`kiosk/${id}/selfie.jpg`, session.selfie_key, session.caricature_key, session.postcard_key].filter(
		(k): k is string => !!k,
	);

	// Deduplicate (selfie_key may equal the kiosk/ path).
	const uniqueR2Keys = [...new Set(r2Keys)];
	for (const key of uniqueR2Keys) {
		try {
			await c.env.BUCKET.delete(key);
			deleted.push(`r2:${key}`);
		} catch (err) {
			console.warn(`[admin-delete] R2 delete failed key=${key}: ${err}`);
		}
	}

	// 2. Delete print_jobs rows.
	const printResult = await c.env.DB.prepare('DELETE FROM print_jobs WHERE session_id = ?').bind(id).run();
	const printDeleted = printResult.meta.changes ?? 0;
	if (printDeleted > 0) deleted.push(`d1:print_jobs(${printDeleted})`);

	// 3. Delete the sessions row.
	await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
	deleted.push('d1:sessions');

	// 4. Force-delete the SessionDO (best-effort — it may already be gone).
	try {
		const doId = c.env.SESSION.idFromName(id);
		const stub = c.env.SESSION.get(doId);
		await stub.delete();
		deleted.push('do:session');
	} catch (err) {
		// DO may have already self-deleted via alarm — that's fine.
		console.warn(`[admin-delete] DO delete failed session=${id}: ${err}`);
	}

	console.log(`[admin-delete] session=${id} deleted=[${deleted.join(', ')}]`);
	trackEvent(c.env.ANALYTICS, 'session.deleted', id);

	return c.json({ ok: true, sessionId: id, deleted });
});

// ---------------------------------------------------------------------------
// Admin: Event management (Phase 5)
//
// CRUD for events and scenes. All routes are behind adminAuthMiddleware.
// ---------------------------------------------------------------------------

/** Slug validation: lowercase alphanumeric + hyphens, 3-64 chars. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/** Shared admin nav for event management pages. */
function adminEventNav(crumbs: string = ''): string {
	return `<header class="flex items-center justify-between mb-8">
		<div>
			<div class="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-white/50">
				Booth admin
			</div>
			${crumbs}
		</div>
		<div class="flex items-center gap-4 text-xs text-white/50">
			<a href="/admin" class="text-cf-orange hover:text-white underline underline-offset-4">Dashboard</a>
			<a href="/admin/events" class="text-cf-orange hover:text-white underline underline-offset-4">Events</a>
			<a href="/admin/logout" class="text-cf-orange hover:text-white underline underline-offset-4">Sign out</a>
		</div>
	</header>`;
}

/** Status pill for event status. */
function eventStatusPill(status: string): string {
	const cls =
		status === 'active'
			? 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/30'
			: status === 'archived'
				? 'bg-amber-500/20 text-amber-300 ring-amber-400/30'
				: 'bg-white/10 text-white/60 ring-white/20';
	return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${cls}">${escapeHtml(status)}</span>`;
}

// ---- Event list page -------------------------------------------------------

app.get('/admin/events', async (c) => {
	const events = await listEvents(c.env);

	// Get session counts per event
	const countRows = await c.env.DB.prepare(`SELECT event_id, COUNT(*) as cnt FROM sessions GROUP BY event_id`).all<{
		event_id: string | null;
		cnt: number;
	}>();
	const counts = new Map(countRows.results.map((r) => [r.event_id, r.cnt]));

	const eventCards = events
		.map((ev) => {
			const cnt = counts.get(ev.id) ?? 0;
			const canDelete = ev.status === 'draft' && cnt === 0;
			return `<div class="px-4 py-3 hover:bg-white/[0.03] border-b border-white/5 last:border-b-0" data-event-card="${escapeAttr(ev.id)}">
				<div class="flex items-center gap-3 flex-wrap">
					<a href="/e/${escapeAttr(ev.id)}" target="_blank" rel="noopener"
						class="font-semibold text-sm text-white hover:text-cf-orange transition inline-flex items-center gap-1.5">
						${escapeHtml(ev.name)} <span class="text-xs">\u2197</span>
					</a>
					${eventStatusPill(ev.status)}
					<span class="hidden sm:inline font-mono text-xs text-white/40">${escapeHtml(ev.id)}</span>
					<span class="hidden sm:inline text-white/40 text-xs">\u00B7</span>
					<span class="hidden sm:inline text-white/50 text-xs">${cnt} session${cnt !== 1 ? 's' : ''}</span>
				</div>
				<div class="flex items-center gap-1.5 mt-2">
					<a href="/admin/events/${escapeAttr(ev.id)}" aria-label="Edit event" data-tooltip="Edit"
						class="inline-flex items-center gap-1 rounded-full border border-cf-orange/40 bg-cf-orange/10 px-2.5 sm:px-3 py-1 text-xs text-cf-orange hover:bg-cf-orange/20 transition">
						\u270E<span class="hidden sm:inline"> Edit</span>
					</a>
					<button type="button" data-action="clone-event" data-event-id="${escapeAttr(ev.id)}" aria-label="Clone event" data-tooltip="Clone"
						class="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2.5 sm:px-3 py-1 text-xs text-white/80 hover:border-white/30 transition">
						\u2398<span class="hidden sm:inline"> Clone</span>
					</button>
					${
						canDelete
							? `<button type="button" data-action="delete-event" data-event-id="${escapeAttr(ev.id)}" aria-label="Delete event" data-tooltip="Delete"
						class="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 sm:px-3 py-1 text-xs text-red-400 hover:bg-red-500/20 transition">
						\u2716<span class="hidden sm:inline"> Delete</span>
					</button>`
							: ''
					}
				</div>
			</div>`;
		})
		.join('');

	return c.html(
		page(
			'Events — Admin',
			`<main class="min-h-screen px-6 py-8 max-w-6xl mx-auto">
				${adminEventNav(`<h1 class="mt-1 text-2xl font-bold">Events</h1>`)}

				<link rel="stylesheet" href="https://unpkg.com/notyf@3.10.0/notyf.min.css" />
				<script src="https://unpkg.com/notyf@3.10.0/notyf.min.js"></script>
				<style>
					.notyf__toast { font-family: inherit; border-radius: 12px; }
					.notyf__toast--success { background: #f6821f; }
					.notyf__toast--error   { background: #ef4444; }
					.notyf__icon { background: transparent !important; }
					.notyf__icon-success, .notyf__icon-error { background: transparent !important; border-color: rgba(255,255,255,0.9) !important; }
					.notyf__icon-success::after, .notyf__icon-success::before,
					.notyf__icon-error::after,   .notyf__icon-error::before { background: #ffffff !important; }
					.notyf__message { font-weight: 500; }
				</style>

				<section class="mb-6 flex items-center justify-between">
					<p class="hidden sm:block text-sm text-white/50">${events.length} event${events.length !== 1 ? 's' : ''}</p>
					<a href="/admin/events/new"
						class="inline-flex items-center gap-2 rounded-full bg-cf-orange px-5 py-2 text-sm font-semibold text-black hover:bg-cf-orange-dark transition sm:ml-auto">
						+ Create event
					</a>
				</section>

				<section class="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
					${eventCards || `<div class="px-4 py-8 text-center text-white/40">No events yet.</div>`}
				</section>
			</main>
			<script>
			(function () {
				var notyf = new Notyf({ duration: 3000, position: { x: "right", y: "top" } });
				function toast(msg, isErr) { notyf[isErr ? "error" : "success"](msg); }

				document.addEventListener("click", function (e) {
					var btn = e.target.closest("[data-action]");
					if (!btn) return;
					var action = btn.getAttribute("data-action");
					var eventId = btn.getAttribute("data-event-id");

					if (action === "clone-event") {
						btn.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(eventId) + "/clone", { method: "POST", credentials: "same-origin" })
							.then(function (r) { return r.json(); })
							.then(function (j) {
								if (j.error) { toast(j.error, true); btn.disabled = false; return; }
								toast("Cloned as " + j.newEventId);
								setTimeout(function () { window.location.href = "/admin/events/" + encodeURIComponent(j.newEventId); }, 800);
							})
							.catch(function (err) { toast("Clone failed: " + err.message, true); btn.disabled = false; });
					}

					if (action === "delete-event") {
						if (!confirm("Delete event '" + eventId + "'? This cannot be undone.")) return;
						btn.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(eventId), { method: "DELETE", credentials: "same-origin" })
							.then(function (r) { return r.json(); })
							.then(function (j) {
								if (j.error) { toast(j.error, true); btn.disabled = false; return; }
								toast("Deleted");
								var card = document.querySelector('[data-event-card="' + eventId + '"]');
								if (card) card.remove();
							})
							.catch(function (err) { toast("Delete failed: " + err.message, true); btn.disabled = false; });
					}
				});
			})();
			</script>`,
		),
	);
});

// ---- Create event form ------------------------------------------------------

app.get('/admin/events/new', (c) => {
	return c.html(
		page(
			'New event — Admin',
			`<main class="min-h-screen px-6 py-8 max-w-2xl mx-auto">
				${adminEventNav(`<h1 class="mt-1 text-2xl font-bold">Create event</h1>`)}

				<form id="create-form" class="space-y-4">
					<div>
						<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Name</label>
						<input name="name" type="text" required placeholder="NYC Tech Week 2026"
							class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cf-orange/50 focus:outline-none" />
					</div>
					<div>
						<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Slug (URL-safe ID)</label>
						<input name="id" type="text" required placeholder="nyc-tech-week-2026" pattern="[a-z0-9][a-z0-9\\-]{1,62}[a-z0-9]"
							class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white font-mono placeholder:text-white/30 focus:border-cf-orange/50 focus:outline-none" />
						<p class="mt-1 text-xs text-white/40">Lowercase letters, numbers, hyphens. 3–64 chars.</p>
					</div>
					<div>
						<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Status</label>
						<select name="status"
							class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none">
							<option value="draft">Draft</option>
							<option value="active">Active</option>
							<option value="archived">Archived</option>
						</select>
					</div>
					<button type="submit"
						class="inline-flex items-center gap-2 rounded-full bg-cf-orange px-6 py-3 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">
						Create event
					</button>
				</form>
			</main>
			<script>
			(function () {
				var form = document.getElementById("create-form");
				var nameInput = form.querySelector('[name="name"]');
				var slugInput = form.querySelector('[name="id"]');
				var slugEdited = false;

				slugInput.addEventListener("input", function () { slugEdited = true; });
				nameInput.addEventListener("input", function () {
					if (slugEdited) return;
					slugInput.value = nameInput.value
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.replace(/^-|-$/g, "")
						.slice(0, 64);
				});

				form.addEventListener("submit", function (e) {
					e.preventDefault();
					var btn = form.querySelector('button[type="submit"]');
					btn.disabled = true;
					var body = {
						id: slugInput.value,
						name: nameInput.value,
						status: form.querySelector('[name="status"]').value,
					};
					fetch("/api/admin/events", {
						method: "POST",
						credentials: "same-origin",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					})
						.then(function (r) { return r.json(); })
						.then(function (j) {
							if (j.error) { alert(j.error); btn.disabled = false; return; }
							window.location.href = "/admin/events/" + encodeURIComponent(j.id);
						})
						.catch(function (err) { alert("Failed: " + err.message); btn.disabled = false; });
				});
			})();
			</script>`,
		),
	);
});

// ---- Event editor -----------------------------------------------------------

app.get('/admin/events/:eventId', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) {
		return c.html(
			page('Not found', `<main class="min-h-screen flex items-center justify-center"><p class="text-white/60">Event not found.</p></main>`),
			404,
		);
	}
	const scenes = await loadAllScenes(c.env, eventId);

	// Session count for delete guard
	const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM sessions WHERE event_id = ?`).bind(eventId).first<{ cnt: number }>();
	const sessionCount = countRow?.cnt ?? 0;
	const canDelete = ev.status === 'draft' && sessionCount === 0;

	const scenesJson = escapeScriptJson(JSON.stringify(scenes));

	return c.html(
		page(
			`${ev.name} — Admin`,
			`<main class="min-h-screen px-6 py-8 max-w-4xl mx-auto">
				${adminEventNav(`
					<div class="flex items-center gap-2 mt-1">
						<a href="/admin/events" class="text-cf-orange hover:text-white text-sm">\u2190 Events</a>
						<span class="text-white/30">/</span>
						<h1 class="text-2xl font-bold">${escapeHtml(ev.name)}</h1>
						${eventStatusPill(ev.status)}
					</div>
				`)}

				<link rel="stylesheet" href="https://unpkg.com/notyf@3.10.0/notyf.min.css" />
				<script src="https://unpkg.com/notyf@3.10.0/notyf.min.js"></script>
				<style>
					.notyf__toast { font-family: inherit; border-radius: 12px; }
					.notyf__toast--success { background: #f6821f; }
					.notyf__toast--error   { background: #ef4444; }
					.notyf__icon { background: transparent !important; }
					.notyf__icon-success, .notyf__icon-error { background: transparent !important; border-color: rgba(255,255,255,0.9) !important; }
					.notyf__icon-success::after, .notyf__icon-success::before,
					.notyf__icon-error::after,   .notyf__icon-error::before { background: #ffffff !important; }
					.notyf__message { font-weight: 500; }
				</style>

				<!-- Tabs -->
				<nav class="flex gap-1 mb-6 border-b border-white/10 pb-px">
					<button data-tab="settings" class="tab-btn px-4 py-2 text-sm rounded-t-lg border border-transparent -mb-px transition">Settings</button>
					<button data-tab="branding" class="tab-btn px-4 py-2 text-sm rounded-t-lg border border-transparent -mb-px transition">Branding</button>
					<button data-tab="copy" class="tab-btn px-4 py-2 text-sm rounded-t-lg border border-transparent -mb-px transition">Copy</button>
					<button data-tab="scenes" class="tab-btn px-4 py-2 text-sm rounded-t-lg border border-transparent -mb-px transition">Scenes</button>
					<button data-tab="prompts" class="tab-btn px-4 py-2 text-sm rounded-t-lg border border-transparent -mb-px transition">Prompts</button>
				</nav>

				<!-- Tab: Settings -->
				<section data-panel="settings" class="tab-panel hidden">
					<form id="settings-form" class="space-y-6 max-w-xl">
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Slug</label>
							<input name="id" type="text" value="${escapeAttr(ev.id)}" pattern="[a-z0-9][a-z0-9\\-]{1,62}[a-z0-9]"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white font-mono focus:border-cf-orange/50 focus:outline-none" />
							<p class="mt-1 text-xs text-white/40">Changing the slug changes all URLs for this event.</p>
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Name</label>
							<input name="name" type="text" value="${escapeAttr(ev.name)}" required
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none" />
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Status</label>
							<select name="status"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none">
								<option value="draft" ${ev.status === 'draft' ? 'selected' : ''}>Draft</option>
								<option value="active" ${ev.status === 'active' ? 'selected' : ''}>Active</option>
								<option value="archived" ${ev.status === 'archived' ? 'selected' : ''}>Archived</option>
							</select>
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Timezone</label>
							<input name="timezone" type="text" value="${escapeAttr(ev.timezone)}"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none" />
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Privacy email</label>
							<input name="privacy_email" type="email" value="${escapeAttr(ev.privacy_email)}"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none" />
						</div>
						<button type="submit" class="rounded-full bg-cf-orange px-6 py-2.5 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">Save settings</button>
					</form>
					${
						canDelete
							? `
					<div class="mt-12 pt-8 border-t border-red-500/20">
						<h3 class="text-sm font-semibold text-red-400 mb-2">Danger zone</h3>
						<p class="text-xs text-white/50 mb-3">This event is a draft with no sessions. Deleting it is permanent.</p>
						<button type="button" id="delete-event-btn"
							class="rounded-full border border-red-500/40 bg-red-500/10 px-5 py-2 text-sm text-red-400 hover:bg-red-500/20 transition">
							Delete event
						</button>
					</div>`
							: ''
					}
				</section>

				<!-- Tab: Branding -->
				<section data-panel="branding" class="tab-panel hidden">
					<div class="space-y-8 max-w-xl">
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-2">Bottom-right watermark (PNG)</label>
							<p class="text-xs text-white/40 mb-3">Composited onto the bottom-right corner of every postcard. Nothing is shown if not set.</p>
							<div id="watermark-preview" class="mb-3">
								${
									ev.watermark_image_key
										? `<div class="inline-flex items-center gap-3 rounded-lg bg-white/5 border border-white/10 p-3">
										<img src="/api/admin/events/${escapeAttr(ev.id)}/watermark" alt="watermark" class="h-12" />
										<button type="button" id="remove-watermark-btn" class="text-xs text-red-400 hover:text-red-300 underline">Remove</button>
									</div>`
										: `<p class="text-xs text-white/40 italic">No watermark set.</p>`
								}
							</div>
							${
								ev.watermark_image_key
									? `<div class="mb-3">
									<label class="block text-xs text-white/50 mb-1">Width</label>
									<div class="flex items-center gap-3">
										<input type="range" id="wm-right-slider" min="100" max="900" step="10" value="${ev.watermark_w ?? 540}"
											class="w-48 accent-cf-orange" />
										<span id="wm-right-label" class="text-xs text-white/60 font-mono w-36">${ev.watermark_w ?? 540}px · ${Math.round(((ev.watermark_w ?? 540) / 1800) * 100)}%</span>
									</div>
								</div>`
									: ''
							}
							<form id="watermark-form" enctype="multipart/form-data" class="flex items-center gap-3">
								<input type="file" name="file" accept="image/png" class="text-xs text-white/60 file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-xs file:text-white/80 file:cursor-pointer hover:file:bg-white/15" />
								<button type="submit" class="rounded-full bg-cf-orange px-4 py-2 text-xs font-semibold text-black hover:bg-cf-orange-dark transition">Upload</button>
							</form>
						</div>

						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-2">Bottom-left watermark (PNG)</label>
							<p class="text-xs text-white/40 mb-3">Composited onto the bottom-left corner of every postcard. Nothing is shown if not set.</p>
							<div id="watermark-left-preview" class="mb-3">
								${
									ev.watermark_image_key_left
										? `<div class="inline-flex items-center gap-3 rounded-lg bg-white/5 border border-white/10 p-3">
										<img src="/api/admin/events/${escapeAttr(ev.id)}/watermark-left" alt="watermark left" class="h-12" />
										<button type="button" id="remove-watermark-left-btn" class="text-xs text-red-400 hover:text-red-300 underline">Remove</button>
									</div>`
										: `<p class="text-xs text-white/40 italic">No watermark set.</p>`
								}
							</div>
							${
								ev.watermark_image_key_left
									? `<div class="mb-3">
									<label class="block text-xs text-white/50 mb-1">Width</label>
									<div class="flex items-center gap-3">
										<input type="range" id="wm-left-slider" min="100" max="900" step="10" value="${ev.watermark_left_w ?? 540}"
											class="w-48 accent-cf-orange" />
										<span id="wm-left-label" class="text-xs text-white/60 font-mono w-36">${ev.watermark_left_w ?? 540}px · ${Math.round(((ev.watermark_left_w ?? 540) / 1800) * 100)}%</span>
									</div>
								</div>`
									: ''
							}
							<form id="watermark-left-form" enctype="multipart/form-data" class="flex items-center gap-3">
								<input type="file" name="file" accept="image/png" class="text-xs text-white/60 file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-xs file:text-white/80 file:cursor-pointer hover:file:bg-white/15" />
								<button type="submit" class="rounded-full bg-cf-orange px-4 py-2 text-xs font-semibold text-black hover:bg-cf-orange-dark transition">Upload</button>
							</form>
						</div>

						${
							ev.watermark_image_key || ev.watermark_image_key_left
								? `<div>
								<label class="block text-xs uppercase tracking-widest text-white/50 mb-2">Postcard preview</label>
								<p class="text-xs text-white/40 mb-3">Approximate layout — actual postcard is 1800×1200 px. Drag the sliders above to resize.</p>
								<div id="postcard-preview" style="position:relative;aspect-ratio:3/2;max-width:640px;overflow:hidden;border-radius:0.5rem;border:1px solid rgba(255,255,255,0.1);background-color:#e5e7eb;background-image:repeating-conic-gradient(#d1d5db 0% 25%,#e5e7eb 0% 50%);background-size:16px 16px;">
									${
										ev.watermark_image_key
											? `<img id="preview-wm-right" src="/api/admin/events/${escapeAttr(ev.id)}/watermark"
												style="position:absolute;bottom:${((56 / 1200) * 100).toFixed(2)}%;right:${((56 / 1800) * 100).toFixed(2)}%;width:${(((ev.watermark_w ?? 540) / 1800) * 100).toFixed(2)}%;opacity:0.95;" />`
											: ''
									}
									${
										ev.watermark_image_key_left
											? `<img id="preview-wm-left" src="/api/admin/events/${escapeAttr(ev.id)}/watermark-left"
												style="position:absolute;bottom:${((56 / 1200) * 100).toFixed(2)}%;left:${((56 / 1800) * 100).toFixed(2)}%;width:${(((ev.watermark_left_w ?? 540) / 1800) * 100).toFixed(2)}%;opacity:0.95;" />`
											: ''
									}
								</div>
							</div>`
								: ''
						}

						<form id="branding-form" class="space-y-6">
							<div>
								<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Accent color</label>
								<div class="flex items-center gap-3">
									<input name="accent_color" type="text" value="${escapeAttr(ev.accent_color)}" placeholder="#f6821f"
										class="w-40 rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white font-mono focus:border-cf-orange/50 focus:outline-none" />
									<div id="color-swatch" class="size-10 rounded-lg border border-white/10" style="background:${escapeAttr(ev.accent_color)}"></div>
								</div>
							</div>
							<button type="submit" class="rounded-full bg-cf-orange px-6 py-2.5 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">Save branding</button>
						</form>
					</div>
				</section>

				<!-- Tab: Copy -->
				<section data-panel="copy" class="tab-panel hidden">
					<form id="copy-form" class="space-y-6 max-w-xl">
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Tagline</label>
							<p class="text-xs text-white/40 mb-2">Shown on the event landing page below the title.</p>
							<input name="tagline" type="text" value="${escapeAttr(ev.tagline)}"
								placeholder="Take a selfie, pick a scene, walk away with a printed postcard."
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cf-orange/50 focus:outline-none" />
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Kiosk idle subhead</label>
							<p class="text-xs text-white/40 mb-2">Shown on the kiosk idle screen below the main heading.</p>
							<input name="kiosk_idle_subhead" type="text" value="${escapeAttr(ev.kiosk_idle_subhead)}"
								placeholder="Cloudflare Kiosk \u00B7 For more information on Cloudflare, visit cloudflare.com"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cf-orange/50 focus:outline-none" />
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Scene picker heading</label>
							<p class="text-xs text-white/40 mb-2">Heading above the scene picker cards in the kiosk flow.</p>
							<input name="scene_picker_heading" type="text" value="${escapeAttr(ev.scene_picker_heading)}"
								placeholder="Pick your scene"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cf-orange/50 focus:outline-none" />
						</div>
						<button type="submit" class="rounded-full bg-cf-orange px-6 py-2.5 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">Save copy</button>
					</form>
				</section>

				<!-- Tab: Scenes -->
				<section data-panel="scenes" class="tab-panel hidden">
					<div id="scenes-container" class="space-y-3"></div>
					<button type="button" id="add-scene-btn"
						class="mt-4 inline-flex items-center gap-2 rounded-full bg-cf-orange px-5 py-2.5 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">
						+ Add scene
					</button>
				</section>

				<!-- Tab: Prompts -->
				<section data-panel="prompts" class="tab-panel hidden">
					<form id="prompts-form" class="space-y-6 max-w-xl">
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Style preamble</label>
							<p class="text-xs text-white/40 mb-2">Prepended to every scene prompt. Describe the overall art style.</p>
							<textarea name="scene_style_preamble" rows="4"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none">${escapeHtml(ev.scene_style_preamble ?? '')}</textarea>
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Constraints</label>
							<p class="text-xs text-white/40 mb-2">Appended to every scene prompt. Negative constraints, safety rules, etc.</p>
							<textarea name="scene_constraints" rows="4"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none">${escapeHtml(ev.scene_constraints ?? '')}</textarea>
						</div>
						<button type="submit" class="rounded-full bg-cf-orange px-6 py-2.5 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">Save prompts</button>
					</form>
				</section>
			</main>

			<script id="scenes-data" type="application/json">${scenesJson}</script>
			<script>
			(function () {
				var EVENT_ID = ${JSON.stringify(ev.id)};
				var notyf = new Notyf({ duration: 3000, position: { x: "right", y: "top" } });
				function toast(msg, isErr) { notyf[isErr ? "error" : "success"](msg); }

				// ---- Tabs ----
				var tabs = document.querySelectorAll(".tab-btn");
				var panels = document.querySelectorAll(".tab-panel");
				function activateTab(name) {
					tabs.forEach(function (t) {
						var active = t.getAttribute("data-tab") === name;
						t.className = "tab-btn px-4 py-2 text-sm rounded-t-lg border -mb-px transition " +
							(active ? "border-white/10 border-b-cf-ink bg-cf-ink text-white" : "border-transparent text-white/50 hover:text-white/80");
					});
					panels.forEach(function (p) {
						p.classList.toggle("hidden", p.getAttribute("data-panel") !== name);
					});
					history.replaceState(null, "", "#" + name);
				}
				tabs.forEach(function (t) {
					t.addEventListener("click", function () { activateTab(t.getAttribute("data-tab")); });
				});
				activateTab(location.hash.slice(1) || "settings");

				// ---- Generic save helper ----
				function saveFields(fields) {
					return fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID), {
						method: "PUT",
						credentials: "same-origin",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(fields),
					}).then(function (r) { return r.json(); })
					.then(function (j) {
						if (j.error) throw new Error(j.error);
						// If slug changed, redirect to new URL
						if (fields.id && fields.id !== EVENT_ID) {
							window.location.href = "/admin/events/" + encodeURIComponent(fields.id);
							return;
						}
						toast("Saved");
					});
				}

				// ---- Settings form ----
				document.getElementById("settings-form").addEventListener("submit", function (e) {
					e.preventDefault();
					var f = e.target;
					saveFields({
						id: f.querySelector('[name="id"]').value,
						name: f.querySelector('[name="name"]').value,
						status: f.querySelector('[name="status"]').value,
						timezone: f.querySelector('[name="timezone"]').value,
						privacy_email: f.querySelector('[name="privacy_email"]').value,
					}).catch(function (err) { toast(err.message, true); });
				});

				// ---- Delete event ----
				var delBtn = document.getElementById("delete-event-btn");
				if (delBtn) {
					delBtn.addEventListener("click", function () {
						if (!confirm("Permanently delete this event?")) return;
						delBtn.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID), { method: "DELETE", credentials: "same-origin" })
							.then(function (r) { return r.json(); })
							.then(function (j) {
								if (j.error) { toast(j.error, true); delBtn.disabled = false; return; }
								window.location.href = "/admin/events";
							})
							.catch(function (err) { toast(err.message, true); delBtn.disabled = false; });
					});
				}

				// ---- Branding form ----
				document.getElementById("branding-form").addEventListener("submit", function (e) {
					e.preventDefault();
					var f = e.target;
					saveFields({
						accent_color: f.querySelector('[name="accent_color"]').value,
					}).catch(function (err) { toast(err.message, true); });
				});

				// Color swatch live preview
				var accentInput = document.querySelector('[name="accent_color"]');
				var swatch = document.getElementById("color-swatch");
				if (accentInput && swatch) {
					accentInput.addEventListener("input", function () { swatch.style.background = accentInput.value; });
				}

				// ---- Watermark upload (right) ----
				document.getElementById("watermark-form").addEventListener("submit", function (e) {
					e.preventDefault();
					var form = e.target;
					var fd = new FormData(form);
					if (!fd.get("file") || !fd.get("file").size) { toast("Select a PNG file", true); return; }
					fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/watermark", {
						method: "POST", credentials: "same-origin", body: fd,
					}).then(function (r) { return r.json(); })
					.then(function (j) {
						if (j.error) { toast(j.error, true); return; }
						toast("Watermark uploaded");
						setTimeout(function () { location.reload(); }, 600);
					}).catch(function (err) { toast(err.message, true); });
				});

				// ---- Remove watermark (right) ----
				var rmWm = document.getElementById("remove-watermark-btn");
				if (rmWm) {
					rmWm.addEventListener("click", function () {
						rmWm.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/watermark", { method: "DELETE", credentials: "same-origin" })
							.then(function (r) { return r.json(); })
							.then(function (j) {
								if (j.error) { toast(j.error, true); rmWm.disabled = false; return; }
								toast("Watermark removed");
								setTimeout(function () { location.reload(); }, 600);
							}).catch(function (err) { toast(err.message, true); rmWm.disabled = false; });
					});
				}

				// ---- Watermark upload (left) ----
				document.getElementById("watermark-left-form").addEventListener("submit", function (e) {
					e.preventDefault();
					var form = e.target;
					var fd = new FormData(form);
					if (!fd.get("file") || !fd.get("file").size) { toast("Select a PNG file", true); return; }
					fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/watermark-left", {
						method: "POST", credentials: "same-origin", body: fd,
					}).then(function (r) { return r.json(); })
					.then(function (j) {
						if (j.error) { toast(j.error, true); return; }
						toast("Left watermark uploaded");
						setTimeout(function () { location.reload(); }, 600);
					}).catch(function (err) { toast(err.message, true); });
				});

				// ---- Remove watermark (left) ----
				var rmWmL = document.getElementById("remove-watermark-left-btn");
				if (rmWmL) {
					rmWmL.addEventListener("click", function () {
						rmWmL.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/watermark-left", { method: "DELETE", credentials: "same-origin" })
							.then(function (r) { return r.json(); })
							.then(function (j) {
								if (j.error) { toast(j.error, true); rmWmL.disabled = false; return; }
								toast("Left watermark removed");
								setTimeout(function () { location.reload(); }, 600);
							}).catch(function (err) { toast(err.message, true); rmWmL.disabled = false; });
					});
				}

				// ---- Watermark size sliders + preview ----
				var POSTCARD_W = 1800;
				var POSTCARD_H = 1200;
				var WM_MARGIN = 56;
				var previewRight = document.getElementById("preview-wm-right");
				var previewLeft = document.getElementById("preview-wm-left");
				var wmRightSlider = document.getElementById("wm-right-slider");
				var wmLeftSlider = document.getElementById("wm-left-slider");
				var wmRightLabel = document.getElementById("wm-right-label");
				var wmLeftLabel = document.getElementById("wm-left-label");
				function wmLabel(px) {
					return px + "px \u00B7 " + Math.round((px / POSTCARD_W) * 100) + "%";
				}

				if (wmRightSlider) {
					wmRightSlider.addEventListener("input", function () {
						var v = Number(wmRightSlider.value);
						if (wmRightLabel) wmRightLabel.textContent = wmLabel(v);
						if (previewRight) previewRight.style.width = ((v / POSTCARD_W) * 100).toFixed(2) + "%";
					});
					wmRightSlider.addEventListener("change", function () {
						saveFields({ watermark_w: Number(wmRightSlider.value) })
							.catch(function (err) { toast(err.message, true); });
					});
				}
				if (wmLeftSlider) {
					wmLeftSlider.addEventListener("input", function () {
						var v = Number(wmLeftSlider.value);
						if (wmLeftLabel) wmLeftLabel.textContent = wmLabel(v);
						if (previewLeft) previewLeft.style.width = ((v / POSTCARD_W) * 100).toFixed(2) + "%";
					});
					wmLeftSlider.addEventListener("change", function () {
						saveFields({ watermark_left_w: Number(wmLeftSlider.value) })
							.catch(function (err) { toast(err.message, true); });
					});
				}

				// ---- Copy form ----
				document.getElementById("copy-form").addEventListener("submit", function (e) {
					e.preventDefault();
					var f = e.target;
					saveFields({
						tagline: f.querySelector('[name="tagline"]').value,
						kiosk_idle_subhead: f.querySelector('[name="kiosk_idle_subhead"]').value,
						scene_picker_heading: f.querySelector('[name="scene_picker_heading"]').value,
					}).catch(function (err) { toast(err.message, true); });
				});

				// ---- Prompts form ----
				document.getElementById("prompts-form").addEventListener("submit", function (e) {
					e.preventDefault();
					var f = e.target;
					saveFields({
						scene_style_preamble: f.querySelector('[name="scene_style_preamble"]').value,
						scene_constraints: f.querySelector('[name="scene_constraints"]').value,
					}).catch(function (err) { toast(err.message, true); });
				});

				// ---- Scenes ----
				var scenesData = JSON.parse(document.getElementById("scenes-data").textContent || "[]");
				var container = document.getElementById("scenes-container");
				var expanded = {};

				function renderScenes() {
					container.innerHTML = scenesData.map(function (s, idx) {
						var isOpen = expanded[s.id];
						return '<div class="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden" data-scene-id="' + escapeH(s.id) + '">'
							+ '<div class="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.03]" data-toggle-scene="' + escapeH(s.id) + '">'
							+ '<span class="text-lg">' + escapeH(s.emoji) + '</span>'
							+ '<span class="font-semibold text-sm flex-1">' + escapeH(s.name) + '</span>'
							+ '<label class="flex items-center gap-2 text-xs text-white/50" onclick="event.stopPropagation()">'
							+   '<input type="checkbox" ' + (s.is_active ? "checked" : "") + ' data-active-toggle="' + escapeH(s.id) + '" class="accent-orange-500" />'
							+   'Active'
							+ '</label>'
							+ (idx > 0 ? '<button type="button" data-move="up" data-scene-idx="' + idx + '" onclick="event.stopPropagation()" class="text-white/40 hover:text-white text-xs px-1">\u25B2</button>' : '<span class="w-5"></span>')
							+ (idx < scenesData.length - 1 ? '<button type="button" data-move="down" data-scene-idx="' + idx + '" onclick="event.stopPropagation()" class="text-white/40 hover:text-white text-xs px-1">\u25BC</button>' : '<span class="w-5"></span>')
							+ '<span class="text-white/30 text-sm">' + (isOpen ? "\u25B4" : "\u25BE") + '</span>'
							+ '</div>'
							+ (isOpen ? renderSceneForm(s) : '')
							+ '</div>';
					}).join("");
				}

				function renderSceneForm(s) {
					return '<div class="px-4 pb-4 pt-2 border-t border-white/5 space-y-3">'
						+ '<div class="grid grid-cols-2 gap-3">'
						+ '<div><label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Name</label>'
						+ '<input data-field="name" value="' + escapeA(s.name) + '" class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-cf-orange/50 focus:outline-none" /></div>'
						+ '<div><label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Emoji</label>'
						+ '<input data-field="emoji" value="' + escapeA(s.emoji) + '" maxlength="4" class="w-24 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-cf-orange/50 focus:outline-none" /></div>'
						+ '</div>'
						+ '<div><label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Description</label>'
						+ '<input data-field="description" value="' + escapeA(s.description) + '" class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-cf-orange/50 focus:outline-none" /></div>'
						+ '<div><label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Prompt</label>'
						+ '<textarea data-field="prompt" rows="5" class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white font-mono focus:border-cf-orange/50 focus:outline-none">' + escapeH(s.prompt) + '</textarea></div>'
						+ '<div class="flex items-center gap-3">'
						+ '<button type="button" data-save-scene="' + escapeA(s.id) + '" class="rounded-full bg-cf-orange px-5 py-2 text-xs font-semibold text-black hover:bg-cf-orange-dark transition">Save scene</button>'
						+ '<button type="button" data-delete-scene="' + escapeA(s.id) + '" class="rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400 hover:bg-red-500/20 transition">Delete</button>'
						+ '</div></div>';
				}

				function escapeH(s) {
					return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
				}
				function escapeA(s) { return escapeH(s); }

				renderScenes();

				// Scene interactions
				container.addEventListener("click", function (e) {
					var toggle = e.target.closest("[data-toggle-scene]");
					if (toggle) {
						var sid = toggle.getAttribute("data-toggle-scene");
						expanded[sid] = !expanded[sid];
						renderScenes();
						return;
					}

					var moveBtn = e.target.closest("[data-move]");
					if (moveBtn) {
						var dir = moveBtn.getAttribute("data-move");
						var idx = parseInt(moveBtn.getAttribute("data-scene-idx"), 10);
						var swapIdx = dir === "up" ? idx - 1 : idx + 1;
						if (swapIdx < 0 || swapIdx >= scenesData.length) return;
						var tmp = scenesData[idx];
						scenesData[idx] = scenesData[swapIdx];
						scenesData[swapIdx] = tmp;
						// Update sort_orders and save
						var reorder = scenesData.map(function (s, i) { return { id: s.id, sort_order: i }; });
						fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/scenes/reorder", {
							method: "PUT", credentials: "same-origin",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(reorder),
						}).then(function (r) { return r.json(); })
						.then(function (j) {
							if (j.error) toast(j.error, true); else toast("Reordered");
						}).catch(function (err) { toast(err.message, true); });
						renderScenes();
						return;
					}

					var saveBtn = e.target.closest("[data-save-scene]");
					if (saveBtn) {
						var sceneId = saveBtn.getAttribute("data-save-scene");
						var card = container.querySelector('[data-scene-id="' + sceneId + '"]');
						var body = {
							name: card.querySelector('[data-field="name"]').value,
							emoji: card.querySelector('[data-field="emoji"]').value,
							description: card.querySelector('[data-field="description"]').value,
							prompt: card.querySelector('[data-field="prompt"]').value,
						};
						saveBtn.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/scenes/" + encodeURIComponent(sceneId), {
							method: "PUT", credentials: "same-origin",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(body),
						}).then(function (r) { return r.json(); })
						.then(function (j) {
							if (j.error) { toast(j.error, true); saveBtn.disabled = false; return; }
							// Update local data
							var s = scenesData.find(function (x) { return x.id === sceneId; });
							if (s) { s.name = body.name; s.emoji = body.emoji; s.description = body.description; s.prompt = body.prompt; }
							toast("Scene saved");
							saveBtn.disabled = false;
						}).catch(function (err) { toast(err.message, true); saveBtn.disabled = false; });
						return;
					}

					var delBtn = e.target.closest("[data-delete-scene]");
					if (delBtn) {
						var sceneId = delBtn.getAttribute("data-delete-scene");
						if (!confirm("Delete scene '" + sceneId + "'?")) return;
						delBtn.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/scenes/" + encodeURIComponent(sceneId), {
							method: "DELETE", credentials: "same-origin",
						}).then(function (r) { return r.json(); })
						.then(function (j) {
							if (j.error) { toast(j.error, true); delBtn.disabled = false; return; }
							scenesData = scenesData.filter(function (x) { return x.id !== sceneId; });
							delete expanded[sceneId];
							renderScenes();
							toast("Scene deleted");
						}).catch(function (err) { toast(err.message, true); delBtn.disabled = false; });
						return;
					}
				});

				// Active toggle
				container.addEventListener("change", function (e) {
					var toggle = e.target.closest("[data-active-toggle]");
					if (!toggle) return;
					var sceneId = toggle.getAttribute("data-active-toggle");
					var isActive = toggle.checked ? 1 : 0;
					fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/scenes/" + encodeURIComponent(sceneId), {
						method: "PUT", credentials: "same-origin",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ is_active: isActive }),
					}).then(function (r) { return r.json(); })
					.then(function (j) {
						if (j.error) { toast(j.error, true); toggle.checked = !toggle.checked; return; }
						var s = scenesData.find(function (x) { return x.id === sceneId; });
						if (s) s.is_active = isActive;
						toast(isActive ? "Scene activated" : "Scene deactivated");
					}).catch(function (err) { toast(err.message, true); toggle.checked = !toggle.checked; });
				});

				// Add scene
				document.getElementById("add-scene-btn").addEventListener("click", function () {
					var name = prompt("Scene name:");
					if (!name) return;
					var id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
					if (!id) { toast("Invalid name", true); return; }
					var maxSort = scenesData.length > 0 ? Math.max.apply(null, scenesData.map(function (s) { return s.sort_order; })) : -1;
					var body = {
						id: id,
						name: name,
						emoji: "\uD83C\uDFA8",
						description: "",
						prompt: "",
						sort_order: maxSort + 1,
						is_active: 1,
					};
					fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/scenes", {
						method: "POST", credentials: "same-origin",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					}).then(function (r) { return r.json(); })
					.then(function (j) {
						if (j.error) { toast(j.error, true); return; }
						scenesData.push({
							event_id: EVENT_ID, id: body.id, name: body.name, emoji: body.emoji,
							description: body.description, prompt: body.prompt, sort_order: body.sort_order, is_active: body.is_active,
						});
						expanded[body.id] = true;
						renderScenes();
						toast("Scene created");
					}).catch(function (err) { toast(err.message, true); });
				});
			})();
			</script>`,
		),
	);
});

// ---- Admin event APIs -------------------------------------------------------

/** Serve the right watermark image for admin preview. */
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

/** Serve the left watermark image for admin preview. */
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

/** Create a new event. */
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

/** Update an event's fields. Supports partial updates + slug rename. */
app.put('/api/admin/events/:eventId', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) return c.json({ error: 'Event not found' }, 404);

	const body = await c.req.json<Record<string, any>>();

	// Allowed fields (the event table columns minus created_at/created_by)
	const ALLOWED = new Set([
		'id',
		'name',
		'status',
		'accent_color',
		'watermark_w',
		'watermark_left_w',
		'tagline',
		'kiosk_idle_subhead',
		'scene_picker_heading',
		'scene_style_preamble',
		'scene_constraints',
		'timezone',
		'privacy_email',
	]);

	const sets: string[] = [];
	const vals: any[] = [];
	for (const [key, val] of Object.entries(body)) {
		if (!ALLOWED.has(key)) continue;
		if (key === 'id') continue; // handled separately below
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

	// Handle slug rename
	const newSlug = body.id;
	const slugChanging = newSlug && newSlug !== eventId;
	if (slugChanging) {
		if (!SLUG_RE.test(newSlug)) return c.json({ error: 'Invalid slug' }, 400);
		sets.push('id = ?');
		vals.push(newSlug);
	}

	if (sets.length === 0) return c.json({ error: 'No valid fields to update' }, 400);

	vals.push(eventId); // WHERE clause

	try {
		await c.env.DB.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`)
			.bind(...vals)
			.run();
	} catch (err: any) {
		if (err?.message?.includes('UNIQUE constraint')) {
			return c.json({ error: 'An event with this slug already exists' }, 409);
		}
		throw err;
	}

	// If slug changed, update FK references
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

/** Delete a draft event with no sessions. */
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

/** Clone an event with all its scenes. */
app.post('/api/admin/events/:eventId/clone', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) return c.json({ error: 'Event not found' }, 404);

	const scenes = await loadAllScenes(c.env, eventId);

	// Generate a unique slug
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

	// Insert cloned event — null out watermarks (don't copy R2 objects)
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

	// Clone scenes
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

/** Upload watermark PNG to R2. */
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

/** Remove watermark from R2 + DB. */
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

/** Upload left watermark PNG to R2. */
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

/** Remove left watermark from R2 + DB. */
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

/** Create a scene. */
app.post('/api/admin/events/:eventId/scenes', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) return c.json({ error: 'Event not found' }, 404);

	const body = await c.req.json<{
		id: string;
		name: string;
		emoji: string;
		description: string;
		prompt: string;
		sort_order: number;
		is_active: number;
	}>();

	if (!body.id || !body.name) return c.json({ error: 'id and name are required' }, 400);

	try {
		await c.env.DB.prepare(
			`INSERT INTO scenes (event_id, id, name, emoji, description, prompt, sort_order, is_active)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				eventId,
				body.id,
				body.name,
				body.emoji || '',
				body.description || '',
				body.prompt || '',
				body.sort_order ?? 0,
				body.is_active ?? 1,
			)
			.run();
	} catch (err: any) {
		if (err?.message?.includes('UNIQUE constraint')) {
			return c.json({ error: 'A scene with this ID already exists for this event' }, 409);
		}
		throw err;
	}

	await invalidateEventCache(c.env, eventId);
	return c.json({ ok: true, id: body.id });
});

/** Bulk reorder scenes. Expects [{id, sort_order}, ...]. */
app.put('/api/admin/events/:eventId/scenes/reorder', async (c) => {
	const eventId = c.req.param('eventId');
	const body = await c.req.json<{ id: string; sort_order: number }[]>();

	if (!Array.isArray(body) || body.length === 0) return c.json({ error: 'Expected array' }, 400);

	const stmts = body.map((item) =>
		c.env.DB.prepare(`UPDATE scenes SET sort_order = ? WHERE event_id = ? AND id = ?`).bind(item.sort_order, eventId, item.id),
	);
	await c.env.DB.batch(stmts);

	await invalidateEventCache(c.env, eventId);
	return c.json({ ok: true });
});

/** Update a scene. Supports partial updates. */
app.put('/api/admin/events/:eventId/scenes/:sceneId', async (c) => {
	const eventId = c.req.param('eventId');
	const sceneId = c.req.param('sceneId');
	const body = await c.req.json<Record<string, any>>();

	const ALLOWED = new Set(['name', 'emoji', 'description', 'prompt', 'sort_order', 'is_active']);
	const sets: string[] = [];
	const vals: any[] = [];
	for (const [key, val] of Object.entries(body)) {
		if (!ALLOWED.has(key)) continue;
		sets.push(`${key} = ?`);
		vals.push(val);
	}

	if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);

	vals.push(eventId, sceneId);
	await c.env.DB.prepare(`UPDATE scenes SET ${sets.join(', ')} WHERE event_id = ? AND id = ?`)
		.bind(...vals)
		.run();

	await invalidateEventCache(c.env, eventId);
	return c.json({ ok: true });
});

/** Delete a scene. */
app.delete('/api/admin/events/:eventId/scenes/:sceneId', async (c) => {
	const eventId = c.req.param('eventId');
	const sceneId = c.req.param('sceneId');

	await c.env.DB.prepare(`DELETE FROM scenes WHERE event_id = ? AND id = ?`).bind(eventId, sceneId).run();

	await invalidateEventCache(c.env, eventId);
	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Kiosk app (Phase 6) — the iPad experience.
//
// 6.1: static idle screen with a big "Tap to start" CTA that links to the
// (placeholder) /kiosk/capture screen.
// 6.2 (this commit): live camera capture screen. After 'Use this photo' the
// blob is uploaded to R2 under kiosk/<sessionId>/selfie.jpg and the result is
// stashed in sessionStorage; the user is then sent to /kiosk/scene
// (placeholder until 6.3 ships the real picker).
// ---------------------------------------------------------------------------

/**
 * Uploads a kiosk selfie blob to R2 and mints a fresh sessionId.
 * Returns the new sessionId + selfieKey so the kiosk client can stash them
 * and pass them along to the scene picker (6.3) and workflow trigger (6.4).
 * POST /api/kiosk/selfie  (multipart: selfie=file)
 */
eventApp.post('/api/kiosk/selfie', async (c) => {
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
	// Always JPEG: the kiosk client encodes via canvas.toBlob("image/jpeg").
	const selfieKey = `kiosk/${sessionId}/selfie.jpg`;

	const buf = await selfie.arrayBuffer();
	await c.env.BUCKET.put(selfieKey, buf, {
		httpMetadata: { contentType: selfie.type || 'image/jpeg' },
		customMetadata: {
			sessionId,
			source: 'kiosk',
			capturedAt: new Date().toISOString(),
		},
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
 * Kicks off the caricature workflow from the kiosk review screen.
 *
 * The kiosk client already holds { sessionId, selfieKey, sceneId } in
 * sessionStorage (from /api/kiosk/selfie + the scene picker), so this is
 * a JSON POST rather than a form upload. We re-validate everything server-
 * side because sessionStorage is untrusted client state.
 *
 * Returns the workflow `instanceId` + a relative status URL so the client
 * can navigate. We don't 303 because the kiosk flow is JS-driven.
 *
 * POST /api/kiosk/start
 * Body: { sessionId, selfieKey, sceneId }
 * Response: { ok, instanceId, sessionId, statusUrl }
 */
eventApp.post('/api/kiosk/start', async (c) => {
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
	// Lock the selfieKey shape down so a client can't point the workflow
	// at an arbitrary R2 object (e.g. workflow-test/<other>/selfie.jpg).
	const expectedPrefix = `kiosk/${sessionId}/`;
	if (!selfieKey.startsWith(expectedPrefix)) {
		return c.json({ error: `selfieKey must start with ${expectedPrefix}`, got: selfieKey }, 400);
	}
	if (!sceneId) {
		return c.json({ error: 'missing sceneId' }, 400);
	}

	// Load the event context so we can (a) validate sceneId against the
	// event's actual scenes, not the bundled JSON, and (b) tag the new
	// workflow run with eventId for D1 inserts downstream.
	const eventCtx = c.get('eventCtx');
	if (!eventCtx.scenes.some((s) => s.id === sceneId)) {
		return c.json({ error: `unknown sceneId: ${sceneId} for event ${eventCtx.event.id}` }, 400);
	}

	// Validate the selfie actually exists in R2. head() is cheap and
	// catches stale sessionStorage from before an R2 lifecycle sweep.
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
	return c.json({
		ok: true,
		instanceId: instance.id,
		sessionId,
		statusUrl,
	});
});

/**
 * Enqueues a print job for a completed session. Called from /kiosk/done when
 * the attendee taps "Print my postcard". Printing is opt-in — the workflow
 * no longer writes to print_jobs automatically.
 *
 * Idempotent: if a print_jobs row already exists for this session with a
 * non-terminal-failure status (pending/printing/printed), we return
 * `alreadyQueued: true` without inserting. Re-queuing IS allowed after a
 * `failed` job so attendees can retry.
 *
 * POST /api/kiosk/print  body: { sessionId }
 */
eventApp.post('/api/kiosk/print', async (c) => {
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

	// The session must be completed and have a postcard before we can print.
	const session = await c.env.DB.prepare('SELECT id, event_id, status, postcard_key, scene_name FROM sessions WHERE id = ?')
		.bind(sessionId)
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
		return c.json({ error: 'session is not ready to print', status: session.status }, 409);
	}

	// Idempotency: if there's an active or completed print job already, don't
	// create another. Only `failed` jobs are considered re-queuable.
	const existing = await c.env.DB.prepare(
		`SELECT id, status FROM print_jobs
		 WHERE session_id = ? AND status IN ('pending', 'printing', 'printed')
		 ORDER BY created_at DESC
		 LIMIT 1`,
	)
		.bind(sessionId)
		.first<{ id: string; status: string }>();

	if (existing) {
		console.log(`[kiosk-print] session=${sessionId} already queued jobId=${existing.id} status=${existing.status}`);
		return c.json({
			ok: true,
			alreadyQueued: true,
			jobId: existing.id,
			status: existing.status,
		});
	}

	const origin = new URL(c.req.url).origin;
	const postcardUrl = `${origin}/p/${sessionId}`;
	const sceneName = session.scene_name ?? 'Scene';

	const insertResult = await c.env.DB.prepare(
		`INSERT INTO print_jobs (session_id, event_id, postcard_key, postcard_url, scene_name)
		 VALUES (?, ?, ?, ?, ?)
		 RETURNING id`,
	)
		.bind(sessionId, session.event_id, session.postcard_key, postcardUrl, sceneName)
		.first<{ id: string }>();

	if (!insertResult) {
		return c.json({ error: 'failed to enqueue print job' }, 500);
	}

	console.log(`[kiosk-print] session=${sessionId} jobId=${insertResult.id} queued sceneName=${sceneName}`);

	trackEvent(c.env.ANALYTICS, 'print.requested', sessionId, sceneName);

	return c.json({
		ok: true,
		alreadyQueued: false,
		jobId: insertResult.id,
		status: 'pending',
	});
});

/**
 * Returns the current status of a print job. Polled by /kiosk/done after
 * the attendee taps "Print my postcard" so the UI can reflect whether the
 * physical printer has actually finished.
 *
 * GET /api/kiosk/print/:jobId/status
 * → { status: "pending" | "printing" | "printed" | "failed", printedAt?, errorMsg? }
 */
eventApp.get('/api/kiosk/print/:jobId/status', async (c) => {
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
 * Generates a QR code PNG for the given URL and returns it as image/png.
 * Used by /kiosk/done to render a scannable code for the digital pickup
 * link without shipping a QR library to the client.
 *
 * The `url` query param is validated to start with the Worker's own origin
 * so this endpoint can't be used as an open QR-proxy.
 *
 * GET /api/kiosk/qr?url=<encoded>
 */
eventApp.get('/api/kiosk/qr', (c) => {
	const raw = c.req.query('url');
	if (!raw) return c.json({ error: 'missing url param' }, 400);

	let target: string;
	try {
		target = decodeURIComponent(raw);
	} catch {
		return c.json({ error: 'invalid url encoding' }, 400);
	}

	// Only allow URLs that start with our own origin so this isn't an
	// open proxy for arbitrary QR codes.
	const workerOrigin = new URL(c.req.url).origin;
	if (!target.startsWith(workerOrigin + '/') && target !== workerOrigin) {
		return c.json({ error: 'url must be on this origin' }, 403);
	}

	const png = qrPng(target, 400);
	return new Response(png, {
		headers: {
			'content-type': 'image/png',
			// QR contents are deterministic; cache aggressively on CDN.
			'cache-control': 'public, max-age=31536000, immutable',
		},
	});
});

/**
 * Privacy / ToS micro-page (step 11.2).
 *
 * Placeholder copy — needs legal review before the event.
 * TODO(legal): Have James send this copy to legal for review before NY Tech Week.
 * GET /privacy
 */
eventApp.get('/privacy', async (c) => {
	const { event } = c.get('eventCtx');
	const basePath = c.get('basePath');
	return c.html(
		page(
			`Privacy — ${event.name} Caricature Booth`,
			`<header class="px-6 sm:px-8 py-6 flex items-center justify-between">
				<a href="${basePath}/" class="flex items-center gap-2 text-sm uppercase tracking-widest text-white/60 hover:text-white transition">
					<img src="/cloudflare-logo.png" alt="" class="h-5 w-5" />
					<span>Cloudflare &middot; ${escapeAttr(event.name)}</span>
				</a>
			</header>

			<main class="max-w-2xl mx-auto px-6 sm:px-8 py-8 pb-20">
				<h1 class="text-3xl font-bold mb-2">Privacy &amp; Data Handling</h1>
				<p class="text-sm text-white/50 mb-8">Cloudflare ${escapeAttr(event.name)} — AI Caricature Booth</p>

				<!-- TODO(legal): Replace the placeholder sections below with
				     legal-reviewed copy before the event. These are reasonable
				     defaults for a conference activation but have NOT been
				     vetted by Cloudflare Legal. -->

				<section class="space-y-6 text-white/80 text-sm leading-relaxed">
					<div>
						<h2 class="text-lg font-semibold text-white mb-2">What we collect</h2>
						<ul class="list-disc pl-5 space-y-1 text-white/70">
							<li>A selfie photo you take at the booth</li>
							<li>Your scene selection</li>
							<li>Your email address (only if you opt in on the digital pickup page)</li>
						</ul>
					</div>

					<div>
						<h2 class="text-lg font-semibold text-white mb-2">How we use it</h2>
						<ul class="list-disc pl-5 space-y-1 text-white/70">
							<li>Your selfie is processed by AI (Cloudflare Workers AI) to generate a caricature postcard</li>
							<li>The generated postcard is stored temporarily so you can download or share it</li>
							<li>If you provide an email, we send you one email with your digital postcard — nothing else</li>
						</ul>
					</div>

					<div>
						<h2 class="text-lg font-semibold text-white mb-2">Data retention</h2>
						<p class="text-white/70">
							All photos and generated images are automatically deleted within 30 days after the event.
							We do not keep your selfie or postcard indefinitely. Email addresses are stored only for
							the purpose of sending your digital copy and are not shared with third parties.
						</p>
					</div>

					<div>
						<h2 class="text-lg font-semibold text-white mb-2">Where your data is processed</h2>
						<p class="text-white/70">
							Everything runs on Cloudflare's global network. Your selfie is processed in-region
							and is not sent to external third-party services. AI inference (content moderation
							and image generation) runs on Cloudflare Workers AI.
						</p>
					</div>

					<div>
						<h2 class="text-lg font-semibold text-white mb-2">Your rights</h2>
						<p class="text-white/70">
							You can choose not to participate. You can skip the email opt-in.
							If you'd like your data removed before the automatic cleanup,
							ask a staff member at the booth or email
							<a href="mailto:${escapeAttr(event.privacy_email)}" class="text-cf-orange underline underline-offset-2 hover:text-white">${escapeAttr(event.privacy_email)}</a>.
						</p>
					</div>

					<div>
						<h2 class="text-lg font-semibold text-white mb-2">Questions?</h2>
						<p class="text-white/70">
							Find a staff member at the booth, or reach out at
							<a href="mailto:${escapeAttr(event.privacy_email)}" class="text-cf-orange underline underline-offset-2 hover:text-white">${escapeAttr(event.privacy_email)}</a>.
						</p>
					</div>
				</section>

				<div class="mt-12 pt-6 border-t border-white/10 text-xs text-white/40">
					<p>Cloudflare, Inc. &middot; This notice is specific to the ${escapeAttr(event.name)} AI Caricature Booth activation.</p>
					<p class="mt-1">For Cloudflare's general privacy policy, visit
						<a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener" class="text-cf-orange underline underline-offset-2">cloudflare.com/privacypolicy</a>.
					</p>
				</div>
			</main>`,
		),
	);
});

/**
 * Idle / landing screen. This is what passersby see when no one is using
 * the booth. Big visual, one obvious action.
 * GET /kiosk
 */
eventApp.get('/kiosk', async (c) => {
	const { event } = c.get('eventCtx');
	const basePath = c.get('basePath');
	const origin = new URL(c.req.url).origin;
	const eventUrl = `${origin}${basePath}/`;
	const qrSrc = `${basePath}/api/kiosk/qr?url=${encodeURIComponent(eventUrl)}`;
	return c.html(
		kioskPage(
			`${event.name} — Tap to start`,
			`			<div class="fixed top-4 left-4 z-50">
				<img src="${qrSrc}" alt="QR code — scan to open this page"
					class="w-20 sm:w-24 rounded-xl border border-white/10 bg-white p-1.5" />
			</div>
			<main class="h-full w-full flex flex-col pt-10">
				<section class="flex-1 flex flex-col items-center justify-center px-8 text-center">
					<h1 class="text-[clamp(2rem,6vw,3.5rem)] font-bold leading-tight text-balance">
						AI Caricature Booth
					</h1>
					<p class="mt-4 max-w-md text-lg text-white/70 text-balance">
						${escapeAttr(event.tagline)}
					</p>

					<a href="${basePath}/kiosk/capture"
						class="mt-16 inline-flex items-center justify-center rounded-full bg-cf-orange px-16 py-7 text-2xl font-bold text-black shadow-[0_0_60px_rgba(246,130,31,0.45)] hover:bg-cf-orange-dark active:scale-[0.98] transition">
						Tap to start
					</a>
				</section>

				<footer class="px-8 pt-12 pb-10 text-center text-[11px] uppercase tracking-[0.25em] text-white/30">
					We don't store your photo after the event · <a href="${basePath}/privacy" class="underline underline-offset-2 hover:text-white/50">Privacy</a>
				</footer>
			</main>`,
		),
	);
});

/**
 * Capture screen (step 6.2).
 *
 * Live <video> preview from the front camera via getUserMedia. Big shutter
 * button freezes a frame onto a hidden <canvas>. After freeze, user picks
 * "Use this photo" (uploads to R2 and advances) or "Retake" (reattaches
 * the live stream).
 *
 * On approval: POSTs the JPEG to /api/kiosk/selfie, stashes
 * { sessionId, selfieKey } in sessionStorage, navigates to /kiosk/scene.
 * GET /kiosk/capture
 */
eventApp.get('/kiosk/capture', (c) => {
	const basePath = c.get('basePath');
	const origin = new URL(c.req.url).origin;
	const eventUrl = `${origin}${basePath}/`;
	const qrSrc = `${basePath}/api/kiosk/qr?url=${encodeURIComponent(eventUrl)}`;
	return c.html(
		kioskPage(
			'Capture your selfie',
			`			<div class="fixed top-4 left-4 z-50">
				<img src="${qrSrc}" alt="QR code — scan to open this page"
					class="w-20 sm:w-24 rounded-xl border border-white/10 bg-white p-1.5" />
			</div>
			<main id="capture-root" class="min-h-[100dvh] h-[100dvh] w-full flex flex-col">
				<header class="shrink-0 px-6 pt-4 sm:pt-8 pb-2 flex items-center justify-between">
					<a href="${basePath}/kiosk" class="text-sm text-white/50 hover:text-white pl-28 sm:pl-32">← Cancel</a>
					<span class="text-xs uppercase tracking-[0.25em] text-white/40 hidden sm:inline">Step 1 of 3 · Selfie</span>
					<span class="w-12"></span>
				</header>

				<!--
					Center column. min-h-0 lets the flex child actually shrink below
					its content size; without it the video frame's intrinsic height
					can push the footer off the bottom of a short viewport.
				-->
				<section class="flex-1 min-h-0 flex flex-col items-center justify-center px-4 sm:px-6 py-2 gap-3">
					<!--
						Video frame. The outer wrapper limits the height to the
						available column space so the footer always stays visible;
						the inner div maintains the 3:4 aspect ratio inside that box.
					-->
					<div class="relative h-full w-full max-w-[640px] max-h-full flex items-center justify-center">
						<div class="relative h-full max-h-full aspect-[3/4] rounded-[2.5rem] overflow-hidden bg-black/60 ring-1 ring-white/10 shadow-[0_0_60px_rgba(246,130,31,0.15)]">
							<!-- Live video preview (mirrored so the user sees themselves naturally) -->
							<video id="cap-video" class="absolute inset-0 h-full w-full object-cover -scale-x-100" playsinline muted autoplay></video>

							<!-- Frozen preview after shutter. Hidden until capture. -->
							<img id="cap-preview" class="absolute inset-0 h-full w-full object-cover hidden -scale-x-100" alt="captured frame" />

							<!-- Soft circular framing guide -->
							<div class="absolute inset-0 pointer-events-none flex items-center justify-center">
								<div class="size-[78%] rounded-full border-2 border-white/30 mix-blend-screen"></div>
							</div>

							<!-- Loading / error overlay -->
							<div id="cap-overlay" class="absolute inset-0 flex flex-col items-center justify-center text-center px-6 bg-black/70 backdrop-blur">
								<div class="text-xl font-semibold">Starting camera…</div>
								<p class="mt-2 text-sm text-white/60">If you see a permissions prompt, tap Allow.</p>
							</div>
						</div>
					</div>

					<p id="cap-hint" class="shrink-0 text-xs sm:text-sm text-white/60 text-center max-w-md">
						Frame your face inside the circle. Tap the shutter when you're ready.
					</p>
				</section>

				<!-- Control bar. shrink-0 + safe-area-aware padding so it stays visible. -->
				<footer class="shrink-0 px-6 pt-2 pb-4 sm:pb-8" style="padding-bottom: max(1rem, env(safe-area-inset-bottom));">
					<div id="cap-shutter-row" class="flex items-center justify-center">
						<button id="cap-shutter" disabled
							class="size-16 sm:size-24 rounded-full bg-white border-[5px] sm:border-[6px] border-white/30 shadow-[0_0_40px_rgba(255,255,255,0.35)] disabled:opacity-40 disabled:shadow-none active:scale-95 transition">
							<span class="sr-only">Take photo</span>
						</button>
					</div>
					<div id="cap-confirm-row" class="hidden flex-col gap-2 sm:gap-3 items-stretch max-w-md mx-auto">
						<button id="cap-use"
							class="rounded-full bg-cf-orange px-8 py-3 sm:py-5 text-base sm:text-xl font-bold text-black shadow-[0_0_40px_rgba(246,130,31,0.45)] hover:bg-cf-orange-dark active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition">
							Use this photo
						</button>
						<button id="cap-retake"
							class="rounded-full border border-white/30 px-8 py-2.5 sm:py-4 text-sm sm:text-base text-white/80 hover:border-white/60 hover:text-white active:scale-[0.98] transition">
							Retake
						</button>
					</div>
					<p id="cap-status" class="mt-2 sm:mt-4 text-center text-[11px] sm:text-xs text-white/40 min-h-[1rem]"></p>
					<p class="mt-2 text-center text-[10px] uppercase tracking-[0.2em] text-white/25">
						We don't store your photo after the event · <a href="${basePath}/privacy" class="underline underline-offset-2 hover:text-white/40">Privacy</a>
					</p>
				</footer>
			</main>

			<script>
			(function () {
				const basePath = ${JSON.stringify(basePath)};
				const video = document.getElementById("cap-video");
				const preview = document.getElementById("cap-preview");
				const overlay = document.getElementById("cap-overlay");
				const hint = document.getElementById("cap-hint");
				const shutter = document.getElementById("cap-shutter");
				const shutterRow = document.getElementById("cap-shutter-row");
				const confirmRow = document.getElementById("cap-confirm-row");
				const useBtn = document.getElementById("cap-use");
				const retakeBtn = document.getElementById("cap-retake");
				const statusEl = document.getElementById("cap-status");

				let stream = null;
				let capturedBlob = null;
				let capturedUrl = null;

				function setOverlay(html) {
					if (html === null) {
						overlay.classList.add("hidden");
					} else {
						overlay.innerHTML = html;
						overlay.classList.remove("hidden");
					}
				}

				async function startCamera() {
					setOverlay(
						'<div class="size-12 rounded-full border-2 border-cf-orange/40 border-t-cf-orange animate-spin mb-4"></div>' +
						'<div class="text-xl font-semibold">Starting camera\u2026</div>' +
						'<p class="mt-2 text-sm text-white/60">If you see a permissions prompt, tap Allow.</p>'
					);
					if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
						setOverlay(
							'<div class="size-16 rounded-full border-2 border-red-400/30 bg-red-500/10 flex items-center justify-center text-2xl mb-4" aria-hidden="true">\u26a0\ufe0f</div>' +
							'<div class="text-xl font-semibold">Camera not supported</div>' +
							'<p class="mt-2 text-sm text-white/60 max-w-xs">This browser can\\'t access the camera. Try Safari on iPad or Chrome on desktop.</p>' +
							'<a href="' + basePath + '/kiosk" class="mt-6 inline-flex items-center justify-center rounded-full bg-cf-orange px-8 py-3 text-base font-bold text-black hover:bg-cf-orange-dark active:scale-[0.98] transition">\u2190 Back to start</a>'
						);
						return;
					}
					try {
						stream = await navigator.mediaDevices.getUserMedia({
							video: {
								facingMode: "user",
								width: { ideal: 1280 },
								height: { ideal: 1280 },
							},
							audio: false,
						});
						video.srcObject = stream;
						await video.play().catch(function () { /* autoplay may need user gesture; play() retried below */ });
						setOverlay(null);
						shutter.disabled = false;
					} catch (err) {
						console.error("getUserMedia failed:", err);
						const denied = String(err && err.name) === "NotAllowedError";
						setOverlay(
							'<div class="size-16 rounded-full border-2 border-red-400/30 bg-red-500/10 flex items-center justify-center text-2xl mb-4" aria-hidden="true">' +
							(denied ? '\ud83d\udeab' : '\u26a0\ufe0f') + '</div>' +
							'<div class="text-xl font-semibold">' +
							(denied ? "Camera access blocked" : "Camera unavailable") +
							'</div><p class="mt-2 text-sm text-white/60 max-w-xs">' +
							(denied
								? "We need camera access to take your selfie. Check your browser or device settings, then tap Retry."
								: "Make sure no other app is using the camera, then tap Retry.") +
							'</p>' +
							'<button id="cap-retry-perms" class="mt-6 inline-flex items-center justify-center rounded-full bg-cf-orange px-8 py-3 text-base font-bold text-black hover:bg-cf-orange-dark active:scale-[0.98] transition">Retry permissions</button>' +
							'<a href="' + basePath + '/kiosk" class="mt-3 text-sm text-white/50 hover:text-white underline underline-offset-4">\u2190 Back to start</a>'
						);
						// Wire the retry button to re-call startCamera.
						var retryPerms = document.getElementById("cap-retry-perms");
						if (retryPerms) retryPerms.addEventListener("click", function () { startCamera(); });
					}
				}

				function stopCamera() {
					if (stream) {
						for (const t of stream.getTracks()) t.stop();
						stream = null;
					}
				}

				function takePhoto() {
					if (!video.videoWidth) return;
					const canvas = document.createElement("canvas");
					canvas.width = video.videoWidth;
					canvas.height = video.videoHeight;
					// Note: we don't mirror the canvas. Server-side moderation /
					// generation operates on the un-mirrored frame; only the UI
					// previews show the mirrored version. This keeps text on shirts
					// readable to FLUX.
					const ctx = canvas.getContext("2d");
					ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
					canvas.toBlob(function (blob) {
						if (!blob) {
							statusEl.textContent = "✗ Failed to capture frame.";
							return;
						}
						capturedBlob = blob;
						if (capturedUrl) URL.revokeObjectURL(capturedUrl);
						capturedUrl = URL.createObjectURL(blob);
						preview.src = capturedUrl;
						preview.classList.remove("hidden");
						video.classList.add("hidden");
						stopCamera();
						shutterRow.classList.add("hidden");
						confirmRow.classList.remove("hidden");
						confirmRow.classList.add("flex");
						hint.textContent = "";
					}, "image/jpeg", 0.92);
				}

				async function retake() {
					capturedBlob = null;
					if (capturedUrl) {
						URL.revokeObjectURL(capturedUrl);
						capturedUrl = null;
					}
					preview.classList.add("hidden");
					video.classList.remove("hidden");
					confirmRow.classList.add("hidden");
					confirmRow.classList.remove("flex");
					shutterRow.classList.remove("hidden");
					hint.textContent = "Frame your face inside the circle. Tap the shutter when you're ready.";
					statusEl.textContent = "";
					await startCamera();
				}

				async function approve() {
					if (!capturedBlob) return;
					useBtn.disabled = true;
					retakeBtn.disabled = true;
					statusEl.textContent = "Uploading…";
					try {
						const fd = new FormData();
						fd.append("selfie", capturedBlob, "selfie.jpg");
						const r = await fetch(basePath + "/api/kiosk/selfie", { method: "POST", body: fd });
						const j = await r.json();
						if (!r.ok || !j.ok) throw new Error(j.error || "upload failed");
						sessionStorage.setItem("kiosk:selfie", JSON.stringify({
							sessionId: j.sessionId,
							selfieKey: j.selfieKey,
							size: j.size,
							capturedAt: Date.now(),
						}));
						statusEl.textContent = "✓ Uploaded. Pick a scene next…";
						window.location.href = basePath + "/kiosk/scene";
					} catch (err) {
						console.error(err);
						statusEl.textContent = "✗ " + (err && err.message ? err.message : String(err));
						useBtn.disabled = false;
						retakeBtn.disabled = false;
					}
				}

				shutter.addEventListener("click", takePhoto);
				useBtn.addEventListener("click", approve);
				retakeBtn.addEventListener("click", retake);

				// Stop the camera if the user navigates away — saves battery on the iPad.
				window.addEventListener("pagehide", stopCamera);
				window.addEventListener("beforeunload", stopCamera);

				startCamera();
			})();
			</script>`,
		),
	);
});

/**
 * Scene picker (step 6.3).
 *
 * Renders the 6 NYC scenes from KV (via loadScenes) as a 2×3 tappable grid.
 * Reads { sessionId, selfieKey, ... } out of sessionStorage; if absent we
 * bounce back to /kiosk/capture (someone landed here directly). On tap we
 * merge { sceneId, sceneName } into the same kiosk:selfie payload and
 * navigate to /kiosk/review.
 *
 * Scenes are rendered server-side so the grid is interactive on first paint
 * — no client fetch round trip on the iPad.
 * GET /kiosk/scene
 */
eventApp.get('/kiosk/scene', async (c) => {
	const eventCtx = c.get('eventCtx');
	const basePath = c.get('basePath');
	let scenes: Scene[];
	try {
		scenes = eventCtx.scenes;
	} catch (err) {
		console.error('loadScenes failed:', err);
		return c.html(
			kioskPage(
				'Pick a scene',
				`<main class="min-h-[100dvh] w-full flex flex-col items-center justify-center px-8 text-center">
					<div class="text-2xl font-semibold text-red-300">Scenes unavailable</div>
					<p class="mt-3 text-sm text-white/60 max-w-md">${String(err)}</p>
					<a href="${basePath}/kiosk" class="mt-8 text-sm text-white/60 hover:text-white underline">← Back to start</a>
				</main>`,
			),
			500,
		);
	}

	const cards = scenes
		.map(
			(s, idx) => `<button type="button"
				data-scene-id="${s.id}"
				data-scene-name="${s.name.replace(/"/g, '&quot;')}"
				data-scene-emoji="${s.emoji.replace(/"/g, '&quot;')}"
				class="scene-card group relative flex flex-col items-start text-left rounded-3xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/30 active:scale-[0.98] transition p-4 sm:p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cf-orange disabled:opacity-50 disabled:cursor-not-allowed"
				style="animation-delay: ${idx * 40}ms;">
				<div class="text-4xl sm:text-5xl leading-none mb-2 sm:mb-3" aria-hidden="true">${s.emoji}</div>
				<div class="text-base sm:text-lg font-semibold leading-tight">${s.name}</div>
				<div class="mt-1 text-xs sm:text-sm text-white/60 leading-snug line-clamp-2">${s.description}</div>
			</button>`,
		)
		.join('\n');

	return c.html(
		kioskPage(
			'Pick a scene',
			`<main id="scene-root" class="min-h-[100dvh] w-full flex flex-col">
				<header class="shrink-0 px-6 pt-4 sm:pt-8 pb-2 flex items-center justify-between">
					<a href="${basePath}/kiosk/capture" class="text-sm text-white/50 hover:text-white">← Retake selfie</a>
					<span class="text-xs uppercase tracking-[0.25em] text-white/40 hidden sm:inline">Step 2 of 3 · Scene</span>
					<span class="w-24"></span>
				</header>

				<section class="flex-1 min-h-0 flex flex-col items-center px-4 sm:px-6 pt-2 pb-4 gap-4 sm:gap-6">
					<div class="text-center max-w-md">
						<h1 class="text-[clamp(1.75rem,5vw,2.5rem)] font-bold leading-tight">${escapeAttr(eventCtx.event.scene_picker_heading)}</h1>
						<p class="mt-2 text-sm sm:text-base text-white/60">
							Tap a scene to drop yourself into it.
						</p>
					</div>

					<!--
						2x3 grid in portrait. max-w-2xl keeps the cards from getting
						too wide on landscape desktop while still filling the iPad
						portrait viewport.
					-->
					<div id="scene-grid" class="w-full max-w-2xl grid grid-cols-2 gap-3 sm:gap-4">
						${cards}
					</div>

					<p id="scene-status" class="text-center text-[11px] sm:text-xs text-white/40 min-h-[1rem]"></p>
				</section>
			</main>
			<script>
			(function () {
				const basePath = ${JSON.stringify(basePath)};
				const grid = document.getElementById("scene-grid");
				const statusEl = document.getElementById("scene-status");

				// Guard: this screen requires a selfie handoff. If sessionStorage
				// is empty the user landed here directly (page refresh, deep link,
				// etc.) — bounce them back to capture.
				const raw = sessionStorage.getItem("kiosk:selfie");
				if (!raw) {
					window.location.replace(basePath + "/kiosk/capture");
					return;
				}
				let selfie;
				try {
					selfie = JSON.parse(raw);
					if (!selfie || !selfie.sessionId || !selfie.selfieKey) throw new Error("incomplete payload");
				} catch (err) {
					console.error("bad kiosk:selfie payload:", err);
					sessionStorage.removeItem("kiosk:selfie");
					window.location.replace(basePath + "/kiosk/capture");
					return;
				}

				function lockGrid() {
					for (const btn of grid.querySelectorAll(".scene-card")) {
						btn.disabled = true;
					}
				}

				grid.addEventListener("click", function (e) {
					const card = e.target.closest(".scene-card");
					if (!card || card.disabled) return;
					const sceneId = card.getAttribute("data-scene-id");
					const sceneName = card.getAttribute("data-scene-name");
					const sceneEmoji = card.getAttribute("data-scene-emoji") || "";
					if (!sceneId) return;
					lockGrid();
					card.classList.add("ring-2", "ring-cf-orange");
					statusEl.textContent = "Loading " + sceneName + "…";
					// Stash the emoji too so /kiosk/review can render the scene
					// card synchronously without a /api/scenes round-trip.
					sessionStorage.setItem("kiosk:selfie", JSON.stringify(Object.assign({}, selfie, {
						sceneId: sceneId,
						sceneName: sceneName,
						sceneEmoji: sceneEmoji,
						sceneChosenAt: Date.now(),
					})));
					window.location.href = basePath + "/kiosk/review";
				});
			})();
			</script>`,
		),
	);
});

/**
 * Review screen (step 6.4).
 *
 * Final confirmation before kicking off the workflow. Reads the full
 * handoff out of sessionStorage:
 *   { sessionId, selfieKey, ..., sceneId, sceneName }
 * Bounces to /kiosk/capture if there's no selfie, or /kiosk/scene if
 * there's no chosen scene.
 *
 * On "Make my postcard" we POST /api/kiosk/start with the handoff,
 * navigate to the returned statusUrl, and clear sessionStorage so a
 * page back-button doesn't accidentally re-trigger the workflow.
 * GET /kiosk/review
 */
eventApp.get('/kiosk/review', async (c) => {
	const { event } = c.get('eventCtx');
	const basePath = c.get('basePath');
	return c.html(
		kioskPage(
			'Review your postcard',
			`<main class="min-h-[100dvh] w-full flex flex-col">
				<header class="shrink-0 px-6 pt-4 sm:pt-8 pb-2 flex items-center justify-between">
					<a href="${basePath}/kiosk/scene" class="text-sm text-white/50 hover:text-white">← Pick different scene</a>
					<span class="text-xs uppercase tracking-[0.25em] text-white/40 hidden sm:inline">Step 3 of 3 · Review</span>
					<span class="w-32"></span>
				</header>

				<section class="flex-1 min-h-0 flex flex-col items-center px-6 sm:px-8 pt-2 pb-4 gap-4 sm:gap-6">
					<div class="text-center max-w-md">
						<h1 class="text-[clamp(1.75rem,5vw,2.5rem)] font-bold leading-tight">Ready to go?</h1>
						<p class="mt-2 text-sm sm:text-base text-white/60">
							We'll generate your caricature in about 30 seconds.
						</p>
					</div>

					<!--
						Selfie + scene side-by-side on landscape, stacked in portrait.
						The selfie image and scene card mirror the visual hierarchy from
						the picker so the user sees their choices reflected back.
					-->
					<div class="w-full max-w-2xl grid grid-cols-2 gap-3 sm:gap-4">
						<div class="flex flex-col items-center gap-2">
							<div class="text-xs uppercase tracking-[0.2em] text-white/40">Your selfie</div>
							<div class="relative aspect-[3/4] w-full max-w-[260px] rounded-2xl overflow-hidden border border-white/10 bg-black/40">
								<img id="rev-selfie" alt="" class="absolute inset-0 h-full w-full object-cover -scale-x-100" />
							</div>
						</div>
						<div class="flex flex-col items-center gap-2">
							<div class="text-xs uppercase tracking-[0.2em] text-white/40">Your scene</div>
							<div class="aspect-[3/4] w-full max-w-[260px] rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5 flex flex-col items-center justify-center text-center">
								<div id="rev-scene-emoji" class="text-6xl sm:text-7xl leading-none" aria-hidden="true">🎨</div>
								<div id="rev-scene-name" class="mt-3 text-base sm:text-lg font-semibold leading-tight">Loading…</div>
							</div>
						</div>
					</div>

					<button id="rev-go" disabled
						class="mt-2 inline-flex items-center justify-center rounded-full bg-cf-orange px-12 py-4 sm:py-5 text-lg sm:text-xl font-bold text-black shadow-[0_0_40px_rgba(246,130,31,0.45)] hover:bg-cf-orange-dark active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition">
						Make my postcard
					</button>
					<p id="rev-status" class="text-center text-[11px] sm:text-xs text-white/40 min-h-[1rem]"></p>
				</section>
			</main>
			<script>
			(function () {
				const basePath = ${JSON.stringify(basePath)};
				const selfieEl = document.getElementById("rev-selfie");
				const emojiEl = document.getElementById("rev-scene-emoji");
				const nameEl = document.getElementById("rev-scene-name");
				const goBtn = document.getElementById("rev-go");
				const statusEl = document.getElementById("rev-status");

				const raw = sessionStorage.getItem("kiosk:selfie");
				if (!raw) {
					window.location.replace(basePath + "/kiosk/capture");
					return;
				}
				let data;
				try {
					data = JSON.parse(raw);
					if (!data || !data.sessionId || !data.selfieKey) throw new Error("incomplete payload");
				} catch (err) {
					sessionStorage.removeItem("kiosk:selfie");
					window.location.replace(basePath + "/kiosk/capture");
					return;
				}
				if (!data.sceneId) {
					window.location.replace(basePath + "/kiosk/scene");
					return;
				}

				selfieEl.src = "/api/run-img?key=" + encodeURIComponent(data.selfieKey);
				nameEl.textContent = data.sceneName || data.sceneId;
				// sceneEmoji is stashed by the picker; render it synchronously so
				// there's no flash of empty card. Falls back to a subtle marker
				// for older sessionStorage entries (pre-emoji-stash).
				if (data.sceneEmoji) emojiEl.textContent = data.sceneEmoji;

				goBtn.disabled = false;

				goBtn.addEventListener("click", async function () {
					goBtn.disabled = true;
					statusEl.textContent = "Starting your postcard…";
					try {
						const r = await fetch(basePath + "/api/kiosk/start", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								sessionId: data.sessionId,
								selfieKey: data.selfieKey,
								sceneId: data.sceneId,
							}),
						});
						const j = await r.json();
						if (!r.ok || !j.ok) throw new Error(j.error || "start failed");
						// Clear handoff state — the back button shouldn't be able
						// to re-fire the workflow with the same selfie/scene.
						sessionStorage.removeItem("kiosk:selfie");
						window.location.href = j.statusUrl;
					} catch (err) {
						console.error(err);
						statusEl.textContent = "✗ " + (err && err.message ? err.message : String(err));
						goBtn.disabled = false;
					}
				});
			})();
			</script>`,
		),
	);
});

/**
 * Live kiosk status screen (step 6.5).
 *
 * Subscribes to /api/session/:sid/ws and walks a 4-row stepper in lockstep
 * with the SessionDO state machine:
 *
 *   queued / moderating  → "Checking your photo"
 *   generating           → "Painting your caricature"  (the slow one)
 *   compositing          → "Adding the postcard frame"
 *   done                 → tick + auto-redirect to /kiosk/done after 500ms
 *
 * On `errored` we replace the stepper with a friendly error card and a
 * 'Try again' CTA back to /kiosk. WebSocket disconnects auto-reconnect
 * with exponential backoff; we only surface a disconnected state to the
 * user after a grace window so brief blips don't cause UI flicker.
 *
 * Final state (postcardKey + postcardUrl + sceneName etc.) is stashed in
 * sessionStorage under 'kiosk:done' before redirecting so /kiosk/done can
 * render the postcard even after the DO self-deletes on its 5-min alarm.
 *
 * GET /kiosk/status/:instanceId?session=<sid>
 */
eventApp.get('/kiosk/status/:instanceId', async (c) => {
	const { event } = c.get('eventCtx');
	const basePath = c.get('basePath');
	const instanceId = c.req.param('instanceId');
	if (!UUID_RE.test(instanceId)) return c.notFound();
	const sessionFromQs = c.req.query('session');
	const sessionId = sessionFromQs && UUID_RE.test(sessionFromQs) ? sessionFromQs : null;

	// Without a sessionId we have nothing to subscribe to. Show a polite
	// error instead of a broken stepper.
	if (!sessionId) {
		return c.html(
			kioskPage(
				'Missing session',
				`<main class="min-h-[100dvh] w-full flex flex-col items-center justify-center px-8 text-center gap-6">
					<div class="text-2xl font-semibold text-red-300">Missing session id</div>
					<p class="text-sm text-white/60 max-w-md">This page can't track a postcard without ?session=&lt;id&gt;.</p>
					<a href="${basePath}/kiosk" class="inline-flex items-center justify-center rounded-full bg-cf-orange px-10 py-4 text-base font-bold text-black hover:bg-cf-orange-dark transition">Start over</a>
				</main>`,
			),
			400,
		);
	}

	return c.html(
		kioskPage(
			'Making your postcard',
			`<main id="status-root" class="min-h-[100dvh] w-full flex flex-col">
				<header class="shrink-0 px-6 pt-4 sm:pt-8 pb-2 flex items-center justify-end">
					<div id="status-conn" class="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-white/30">
						<span id="status-conn-dot" class="size-2 rounded-full bg-yellow-400 animate-pulse"></span>
						<span id="status-conn-label">connecting…</span>
					</div>
				</header>

				<!-- Working state: stepper + headline. Replaced wholesale on errored. -->
				<section id="status-working" class="flex-1 min-h-0 flex flex-col items-center justify-center px-6 sm:px-8 gap-8">
					<div class="text-center max-w-md">
						<h1 id="status-headline" class="text-[clamp(1.75rem,5vw,2.5rem)] font-bold leading-tight">Making your postcard</h1>
						<p id="status-subhead" class="mt-3 text-sm sm:text-base text-white/60"></p>
					</div>

					<!--
						Stepper. Each row has:
						  - a leading marker (spinner / check / dim dot)
						  - the friendly label
						  - an optional hint that only shows on the active row
					-->
					<ol id="status-steps" class="w-full max-w-md flex flex-col gap-3 sm:gap-4">
						${[
							{ key: 'check', label: 'Checking your photo' },
							{ key: 'paint', label: 'Painting your caricature' },
							{ key: 'frame', label: 'Adding the postcard frame' },
							{ key: 'ready', label: 'Your postcard is ready' },
						]
							.map(
								(
									s,
								) => `<li data-step="${s.key}" class="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5 sm:py-4 transition">
									<span class="step-marker shrink-0 mt-0.5 size-7 rounded-full border border-white/15 flex items-center justify-center text-xs text-white/40">·</span>
									<div class="min-w-0 flex-1">
										<div class="step-label text-base sm:text-lg font-semibold leading-tight text-white/50">${s.label}</div>
										${s.hint ? `<div class="step-hint mt-1 text-xs text-white/40 hidden">${s.hint}</div>` : ''}
									</div>
								</li>`,
							)
							.join('\n')}
					</ol>
				</section>

				<!-- Errored state: hidden until we receive status === 'errored'. -->
				<section id="status-errored" class="flex-1 min-h-0 hidden flex-col items-center justify-center px-6 sm:px-8 gap-6 text-center">
					<div class="size-20 rounded-full border-4 border-red-400/30 bg-red-500/10 flex items-center justify-center text-3xl" aria-hidden="true">⚠️</div>
					<div class="max-w-md">
						<h1 class="text-[clamp(1.75rem,5vw,2.5rem)] font-bold leading-tight">Something went wrong</h1>
						<p id="status-err-msg" class="mt-3 text-base text-white/70">We couldn't finish your postcard.</p>
					</div>
					<button id="status-retry" class="inline-flex items-center justify-center rounded-full bg-cf-orange px-12 py-4 text-lg font-bold text-black shadow-[0_0_40px_rgba(246,130,31,0.45)] hover:bg-cf-orange-dark active:scale-[0.98] transition">
						Try again
					</button>
					<p class="text-xs text-white/40 max-w-xs">Ask a staff member if it keeps happening.</p>
				</section>

				<footer class="shrink-0 px-6 pb-6 sm:pb-8 text-center text-[11px] uppercase tracking-[0.25em] text-white/25">
					Generating on Cloudflare · Workers AI + Workflows
				</footer>
			</main>
			<script>
			(function () {
				const basePath = ${JSON.stringify(basePath)};
				const sessionId = ${JSON.stringify(sessionId)};
				const stepsRoot = document.getElementById("status-steps");
				const headlineEl = document.getElementById("status-headline");
				const subheadEl = document.getElementById("status-subhead");
				const workingSection = document.getElementById("status-working");
				const erroredSection = document.getElementById("status-errored");
				const errMsgEl = document.getElementById("status-err-msg");
				const retryBtn = document.getElementById("status-retry");
				const connDot = document.getElementById("status-conn-dot");
				const connLabel = document.getElementById("status-conn-label");

				// Map each SessionDO status to a stepper index. queued and
				// moderating both highlight the first step (queued is brief,
				// users won't tell the difference and we'd rather not flash).
				const STATUS_TO_STEP_INDEX = {
					queued: 0,
					moderating: 0,
					generating: 1,
					compositing: 2,
					done: 3,
				};
				const STATUS_TO_HEADLINE = {
					queued: "Getting started",
					moderating: "Checking your photo",
					generating: "Painting your caricature",
					compositing: "Adding the postcard frame",
					done: "Your postcard is ready",
				};
				const STATUS_TO_SUBHEAD = {
					queued: "",
					moderating: "Making sure your photo is good to go.",
					generating: "",
					compositing: "Watermark + QR code coming together.",
					done: "Hold on while we hand it off…",
				};

				// Visual classes for the marker per state.
				const MARKER_PAST = "bg-emerald-500 border-emerald-500 text-black";
				const MARKER_ACTIVE = "bg-cf-orange/20 border-cf-orange text-cf-orange animate-pulse";
				const MARKER_FUTURE = "border-white/15 text-white/40";

				function applyStepper(activeIdx) {
					const items = stepsRoot.querySelectorAll("li[data-step]");
					items.forEach(function (li, idx) {
						const marker = li.querySelector(".step-marker");
						const label = li.querySelector(".step-label");
						const hint = li.querySelector(".step-hint");
						marker.classList.remove(
							"bg-emerald-500", "border-emerald-500", "text-black",
							"bg-cf-orange/20", "border-cf-orange", "text-cf-orange",
							"animate-pulse",
							"border-white/15", "text-white/40",
						);
						if (idx < activeIdx) {
							marker.classList.add("bg-emerald-500", "border-emerald-500", "text-black");
							marker.textContent = "✓";
							label.classList.remove("text-white/50", "text-white");
							label.classList.add("text-white/80");
						} else if (idx === activeIdx) {
							marker.classList.add("bg-cf-orange/20", "border-cf-orange", "text-cf-orange", "animate-pulse");
							marker.textContent = "●";
							label.classList.remove("text-white/50", "text-white/80");
							label.classList.add("text-white");
							if (hint) hint.classList.remove("hidden");
						} else {
							marker.classList.add("border-white/15", "text-white/40");
							marker.textContent = "·";
							label.classList.remove("text-white", "text-white/80");
							label.classList.add("text-white/50");
							if (hint) hint.classList.add("hidden");
						}
						// Hide the hint on non-active steps.
						if (idx !== activeIdx && hint) hint.classList.add("hidden");
					});
				}

				let didRedirect = false;
				let lastState = null;

				function handleDone(state) {
					if (didRedirect) return;
					didRedirect = true;
					// Always use the server-injected sessionId (confirmed UUID from
					// ?session=) rather than state.sessionId from the WS frame,
					// which can be "(unset)" if the DO seeded before markStep fired.
					const sid = sessionId || state.sessionId;
					try {
						sessionStorage.setItem("kiosk:done", JSON.stringify({
							sessionId: sid,
							sceneId: state.sceneId,
							sceneName: state.sceneName,
							selfieKey: state.selfieKey,
							caricatureKey: state.caricatureKey,
							postcardKey: state.postcardKey,
							postcardUrl: state.postcardUrl,
							finishedAt: Date.now(),
						}));
					} catch (err) {
						console.warn("could not stash done payload:", err);
					}
					applyStepper(STATUS_TO_STEP_INDEX.done);
					headlineEl.textContent = STATUS_TO_HEADLINE.done;
					subheadEl.textContent = STATUS_TO_SUBHEAD.done;
					setTimeout(function () {
						window.location.href = basePath + "/kiosk/done?session=" + encodeURIComponent(sid);
					}, 500);
				}

				function handleErrored(state) {
					workingSection.classList.add("hidden");
					erroredSection.classList.remove("hidden");
					erroredSection.classList.add("flex");
					// Surface a human-friendly message — never raw stack traces.
					// Specific errorMsg values set by the workflow (e.g. moderation
					// rejection) get a tailored copy; everything else gets the
					// generic fallback.
					const raw = (state && state.error) ? String(state.error) : "";
					if (raw.indexOf("moderation rejected") !== -1) {
						errMsgEl.textContent = "Your photo didn't pass our content check. Please try again with a different selfie.";
					} else {
						errMsgEl.textContent = "We couldn't finish your postcard. Please try again.";
					}
					// Log the raw error for staff — visible in browser console.
					if (raw) console.warn("[kiosk-status] error detail:", raw);
				}

				function applyState(state) {
					if (!state) return;
					lastState = state;
					if (state.status === "done") {
						handleDone(state);
						return;
					}
					if (state.status === "errored") {
						handleErrored(state);
						return;
					}
					const idx = STATUS_TO_STEP_INDEX[state.status];
					if (typeof idx !== "number") return;
					applyStepper(idx);
					if (STATUS_TO_HEADLINE[state.status]) headlineEl.textContent = STATUS_TO_HEADLINE[state.status];
					if (STATUS_TO_SUBHEAD[state.status]) subheadEl.textContent = STATUS_TO_SUBHEAD[state.status];
				}

				retryBtn.addEventListener("click", function () {
					try { sessionStorage.removeItem("kiosk:selfie"); } catch (e) { /* ignore */ }
					try { sessionStorage.removeItem("kiosk:done"); } catch (e) { /* ignore */ }
					window.location.href = basePath + "/kiosk";
				});

				// ----- WebSocket -----
				let ws;
				let backoff = 500;
				let everConnected = false;
				let connectedAt = 0;
				const DISCONNECT_GRACE_MS = 5000;

				function setConn(label, color, pulse) {
					connLabel.textContent = label;
					connDot.className = "size-2 rounded-full " + color + (pulse ? " animate-pulse" : "");
				}

				function connect() {
					const proto = location.protocol === "https:" ? "wss:" : "ws:";
					const url = proto + "//" + location.host + basePath + "/api/session/" + sessionId + "/ws";
					setConn("connecting…", "bg-yellow-400", true);
					ws = new WebSocket(url);
					ws.addEventListener("open", function () {
						everConnected = true;
						connectedAt = Date.now();
						backoff = 500;
						setConn("live", "bg-emerald-500", false);
					});
					ws.addEventListener("message", function (e) {
						if (e.data === "pong") return;
						let msg;
						try { msg = JSON.parse(e.data); } catch (err) {
							console.error("bad ws frame:", e.data, err);
							return;
						}
						if (msg && msg.type === "state") applyState(msg.state);
						else if (msg && msg.type === "deleted") {
							// DO storage cleared. If we already saw done we're
							// fine — we'll have already redirected. Otherwise
							// treat it as an error.
							if (!didRedirect && (!lastState || lastState.status !== "done")) {
								handleErrored({ error: "session expired before postcard finished" });
							}
						}
					});
					ws.addEventListener("close", function () {
						// Don't flash 'disconnected' for brief reconnects. Only
						// surface it after a grace window of being down.
						const sinceOpen = Date.now() - connectedAt;
						if (!everConnected || sinceOpen > DISCONNECT_GRACE_MS) {
							setConn("reconnecting…", "bg-yellow-400", true);
						}
						if (didRedirect) return;
						setTimeout(connect, backoff);
						backoff = Math.min(backoff * 2, 10000);
					});
					ws.addEventListener("error", function (err) {
						console.error("ws error:", err);
					});
				}

				connect();
			})();
			</script>`,
		),
	);
});

/**
 * Done screen (step 6.6).
 *
 * Shown after the workflow completes. Reads the final session artifacts from
 * sessionStorage (kiosk:done, stashed by the status screen on the last WS
 * frame) and renders:
 *   - The finished postcard image (full-width, landscape)
 *   - A QR code pointing to /p/:sessionId for the digital-copy pickup page
 *   - A "Pick up your print at the counter" banner
 *   - A 60-second visible countdown before auto-returning to /kiosk.
 *     Any tap/touch on the page resets the countdown so a user who's still
 *     looking at their postcard or scanning the QR isn't yanked away.
 *   - An orange "Start over" button that also resets (and on confirm returns
 *     immediately to /kiosk).
 *
 * Falls back gracefully if sessionStorage is missing (page reload, direct
 * link) by using the conventional R2 path runs/<sid>/postcard.jpg.
 *
 * GET /kiosk/done?session=<sid>
 */
eventApp.get('/kiosk/done', (c) => {
	const basePath = c.get('basePath');
	const sessionFromQs = c.req.query('session');
	const sessionId = sessionFromQs && UUID_RE.test(sessionFromQs) ? sessionFromQs : null;

	// Build the QR src at render time so the <img> tag is ready on first
	// paint. We construct the pickup URL using the same origin as this
	// request — same logic the workflow uses for postcardUrl.
	const pickupUrl = sessionId ? `${new URL(c.req.url).origin}${basePath}/p/${sessionId}` : null;
	const qrSrc = pickupUrl ? `${basePath}/api/kiosk/qr?url=${encodeURIComponent(pickupUrl)}` : null;

	return c.html(
		kioskPage(
			'Your postcard is ready',
			`<main id="done-root" class="min-h-[100dvh] w-full flex flex-col" style="touch-action:manipulation;">
				<header class="shrink-0 px-6 pt-4 sm:pt-6 pb-2 flex items-center justify-end">
					<!-- QR code top-right — always visible for scanning -->
					<div class="flex flex-col items-center gap-1">
						${
							qrSrc
								? `<img src="${qrSrc}" alt="QR code for digital copy"
									class="w-20 sm:w-24 rounded-xl border border-white/10 bg-white p-1.5" />`
								: `<div class="w-20 sm:w-24 aspect-square rounded-xl border border-white/10 bg-white/5"></div>`
						}
						<p class="text-[10px] uppercase tracking-[0.18em] text-white/40">Scan for digital copy</p>
					</div>
				</header>

				<section class="flex-1 min-h-0 flex flex-col items-center px-4 sm:px-8 pt-2 pb-4 sm:pb-6 gap-3 sm:gap-4">

					<h1 class="text-[clamp(1.5rem,4vw,2.25rem)] font-bold leading-tight text-center">
						Your postcard is ready! 🎉
					</h1>

					<!-- Postcard image -->
					<figure class="w-full max-w-2xl flex-1 min-h-0 flex flex-col justify-center">
						<img id="done-postcard" alt="your postcard"
							class="w-full max-h-full object-contain rounded-2xl border border-white/10 bg-black/40 shadow-[0_0_60px_rgba(246,130,31,0.25)]" />
						<figcaption id="done-meta" class="mt-1.5 text-center text-xs text-white/40"></figcaption>
					</figure>

					<!--
						Action row: Print is the primary CTA (opt-in), Start over
						is the secondary outline button. After Print is tapped the
						primary swaps to a locked confirmation banner.
					-->
					<div class="flex flex-col sm:flex-row items-center gap-3 max-w-lg w-full">
						<button id="done-print"
							class="flex-1 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-cf-orange px-8 py-4 text-base font-bold text-black shadow-[0_0_30px_rgba(246,130,31,0.4)] hover:bg-cf-orange-dark active:scale-[0.98] transition whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-100">
							<span data-label="idle" class="inline-flex items-center gap-2">
								<span aria-hidden="true">🖨️</span>
								<span>Print my postcard</span>
							</span>
							<span data-label="loading" class="hidden items-center gap-2">
								<svg class="size-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.3" stroke-width="3" />
									<path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
								</svg>
								<span>Sending to printer…</span>
							</span>
							<span data-label="queued" class="hidden items-center gap-2">
								<svg class="size-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.3" stroke-width="3" />
									<path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
								</svg>
								<span>Queued — waiting for printer…</span>
							</span>
							<span data-label="printed" class="hidden items-center gap-2">
								<span aria-hidden="true">✓</span>
								<span>Printed — pick up at the counter!</span>
							</span>
							<span data-label="failed" class="hidden items-center gap-2">
								<span aria-hidden="true">⚠️</span>
								<span>Print failed — please ask staff</span>
							</span>
						</button>

						<button id="done-restart"
							class="w-full sm:w-auto inline-flex items-center justify-center rounded-full border border-white/25 bg-white/5 px-6 py-4 text-base font-semibold text-white/90 hover:bg-white/10 active:scale-[0.98] transition whitespace-nowrap">
							Start over
						</button>
					</div>

					<!-- Error toast for print failures -->
					<p id="done-print-error" class="hidden text-sm text-red-400 text-center max-w-lg"></p>

					<!--
						Countdown block — sits below the actions, smaller now that
						actions are the visual anchor. Big number + explanatory copy.
					-->
					<div class="flex items-baseline gap-2 text-white/50">
						<span id="done-countdown-secs" class="text-2xl font-bold tabular-nums text-white/80 leading-none">60</span>
						<span class="text-sm">s until idle &middot; tap anywhere to reset</span>
					</div>
				</section>
			</main>
			<script>
			(function () {
				const basePath = ${JSON.stringify(basePath)};
				const postcardEl = document.getElementById("done-postcard");
				const metaEl     = document.getElementById("done-meta");
				const secsEl     = document.getElementById("done-countdown-secs");
				const restartBtn = document.getElementById("done-restart");
				const printBtn   = document.getElementById("done-print");
				const printError = document.getElementById("done-print-error");
				const root       = document.getElementById("done-root");
				// sessionId is injected server-side from ?session= — always a
				// confirmed UUID (or null). Prefer this over state.sessionId from
				// the WS frame, which can be "(unset)" if the DO seeded before
				// the workflow's first markStep call arrived.
				const sessionId  = ${JSON.stringify(sessionId)};
				const IDLE_SECS  = 60;

				// ---- Resolve artifacts from sessionStorage or fallback ----
				let payload = null;
				try {
					const raw = sessionStorage.getItem("kiosk:done");
					if (raw) payload = JSON.parse(raw);
				} catch (err) {
					console.warn("bad kiosk:done payload:", err);
				}

				// Normalise sessionId: prefer URL param over stashed state.sessionId
				// since stashed value can be "(unset)" from an early DO seed.
				const resolvedSid = sessionId
					|| (payload && /^[a-f0-9-]{36}$/.test(payload.sessionId) ? payload.sessionId : null);

				// Handle broken postcard image — R2 may be slow or the key
				// may have expired. Show a friendly fallback instead of a
				// broken <img>.
				var postcardRetries = 0;
				postcardEl.addEventListener("error", function () {
					postcardRetries++;
					if (postcardRetries <= 2) {
						// Retry once after a brief delay — could be a transient R2 blip.
						setTimeout(function () {
							postcardEl.src = postcardEl.src.split("&_r=")[0] + "&_r=" + postcardRetries;
						}, 1500);
						return;
					}
					// After retries exhausted, show a placeholder.
					postcardEl.classList.add("hidden");
					var figure = postcardEl.closest("figure");
					if (figure) {
						figure.innerHTML =
							'<div class="w-full aspect-[3/2] rounded-2xl border border-white/10 bg-white/[0.03] flex flex-col items-center justify-center text-center px-6">' +
							'<div class="text-4xl mb-3" aria-hidden="true">\ud83d\uddbc\ufe0f</div>' +
							'<p class="text-lg font-semibold text-white/80">Your postcard is being prepared</p>' +
							'<p class="mt-2 text-sm text-white/50">The image isn\\'t loading right now.</p>' +
							(resolvedSid
								? '<a href="' + basePath + '/p/' + resolvedSid + '" class="mt-4 text-sm text-cf-orange underline underline-offset-4 hover:text-white">View your digital copy \u2192</a>'
								: '') +
							'</div>';
					}
				});

				if (payload && payload.postcardKey) {
					postcardEl.src = "/api/run-img?key=" + encodeURIComponent(payload.postcardKey);
					const scenePart = payload.sceneName || payload.sceneId || "";
					metaEl.textContent = scenePart ? scenePart + " · " + (resolvedSid || "").slice(0, 8) + "…" : "";
				} else if (resolvedSid) {
					postcardEl.src = "/api/run-img?key=" + encodeURIComponent("runs/" + resolvedSid + "/postcard.jpg");
					metaEl.textContent = "session " + resolvedSid.slice(0, 8) + "…";
				} else {
					postcardEl.classList.add("hidden");
					metaEl.textContent = "No postcard found — please start over.";
				}

				// ---- Print button ----
				// Five visual states driven by [data-label] children: idle,
				// loading, queued, printed, failed. After enqueue we poll the
				// job status every 2s so the button reflects the physical
				// printer's actual state.
				var printPollTimer = null;

				function setPrintState(state) {
					var labels = printBtn.querySelectorAll("[data-label]");
					labels.forEach(function (el) {
						var match = el.getAttribute("data-label") === state;
						el.classList.toggle("hidden", !match);
						el.classList.toggle("inline-flex", match);
					});
				}

				function showPrintError(msg) {
					printError.textContent = msg;
					printError.classList.remove("hidden");
				}

				function clearPrintError() {
					printError.classList.add("hidden");
					printError.textContent = "";
				}

				function stopPrintPoll() {
					if (printPollTimer) { clearInterval(printPollTimer); printPollTimer = null; }
				}

				function startPrintPoll(jobId) {
					// Poll every 2s. Stop on terminal state or when the
					// countdown navigates away (clearInterval in returnToIdle).
					stopPrintPoll();
					printPollTimer = setInterval(async function () {
						try {
							var res = await fetch(basePath + "/api/kiosk/print/" + encodeURIComponent(jobId) + "/status");
							if (!res.ok) return; // silently retry on next interval
							var data = await res.json().catch(function () { return {}; });
							if (data.status === "printed") {
								stopPrintPoll();
								setPrintState("printed");
								printBtn.classList.remove("hover:bg-cf-orange-dark");
								printBtn.classList.add("cursor-default");
							} else if (data.status === "failed") {
								stopPrintPoll();
								setPrintState("failed");
								// Don't re-enable the button for user retry — staff should
								// handle print failures via the admin dashboard's Retry print.
								printBtn.disabled = true;
								showPrintError(
									"The printer couldn't complete your postcard. " +
									"A staff member can reprint it from the admin dashboard."
								);
							}
							// pending / printing → stay in "queued" state, keep polling
						} catch (e) { /* network hiccup, retry silently */ }
					}, 2000);
				}

				if (!resolvedSid) {
					// Without a session id we can't print — disable the button
					// up front instead of letting the user tap and fail.
					printBtn.disabled = true;
					printBtn.classList.add("opacity-50");
				}

				printBtn.addEventListener("click", async function () {
					if (printBtn.disabled || !resolvedSid) return;
					clearPrintError();
					printBtn.disabled = true;
					setPrintState("loading");

					try {
						// Minimum 800ms loading state so the user sees feedback
						// even when the POST returns near-instantly.
						var minDelay = new Promise(function (r) { setTimeout(r, 800); });
						var request = fetch(basePath + "/api/kiosk/print", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ sessionId: resolvedSid }),
						});

						var results = await Promise.all([request, minDelay]);
						var res = results[0];
						var data = await res.json().catch(function () { return {}; });
						if (!res.ok || !data.ok) {
							throw new Error(data.error || "request failed (" + res.status + ")");
						}

						// If already printed (e.g. from a previous session), skip
						// straight to the terminal state.
						if (data.status === "printed") {
							setPrintState("printed");
							printBtn.classList.remove("hover:bg-cf-orange-dark");
							printBtn.classList.add("cursor-default");
							return;
						}

						// Enqueued — show "queued" state and start polling.
						setPrintState("queued");
						if (data.jobId) startPrintPoll(data.jobId);
					} catch (err) {
						console.warn("print enqueue failed:", err);
						setPrintState("idle");
						printBtn.disabled = false;
						showPrintError("Couldn't queue the print. Tap again, or ask a staff member.");
					}
				});

				// ---- Countdown ----
				let remaining = IDLE_SECS;

				function resetCountdown() {
					remaining = IDLE_SECS;
					secsEl.textContent = String(remaining);
				}

				function returnToIdle() {
					stopPrintPoll();
					try { sessionStorage.removeItem("kiosk:selfie"); } catch (e) {}
					try { sessionStorage.removeItem("kiosk:done"); } catch (e) {}
					window.location.href = basePath + "/kiosk";
				}

				root.addEventListener("pointerdown", resetCountdown, { passive: true });

				const tick = setInterval(function () {
					remaining -= 1;
					secsEl.textContent = String(remaining);
					if (remaining <= 0) {
						clearInterval(tick);
						returnToIdle();
					}
				}, 1000);

				restartBtn.addEventListener("click", function () {
					clearInterval(tick);
					returnToIdle();
				});
			})();
			</script>`,
		),
	);
});

/**
 * Big Screen App — gallery with periodic refresh (steps 7.1 + 7.2).
 *
 * Renders the last 8 completed postcards from D1 as a grid for display on a
 * TV/monitor next to the booth. Uses the standard `page()` shell (not
 * `kioskPage` — this isn't a touch-locked iPad).
 *
 * Client-side JS polls `/api/gallery/feed` every 30s and diffs by sessionId
 * to avoid full re-renders.
 */
eventApp.get('/gallery', async (c) => {
	const { event } = c.get('eventCtx');
	const basePath = c.get('basePath');
	const { results } = await c.env.DB.prepare(
		`SELECT id, scene_name, postcard_key, completed_at
		 FROM sessions
		 WHERE event_id = ? AND status = 'completed' AND postcard_key IS NOT NULL
		 ORDER BY completed_at DESC
		 LIMIT 8`,
	)
		.bind(event.id)
		.all<{
			id: string;
			scene_name: string | null;
			postcard_key: string;
			completed_at: number | null;
		}>();

	const now = Math.floor(Date.now() / 1000);
	const formatAge = (completedAt: number | null): string => {
		if (!completedAt) return 'just now';
		const diff = Math.max(0, now - completedAt);
		if (diff < 60) return 'just now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		return `${Math.floor(diff / 86400)}d ago`;
	};

	const cards = results
		.map((row) => {
			const sceneName = row.scene_name ?? 'Untitled scene';
			const age = formatAge(row.completed_at);
			const imgUrl = `/api/run-img?key=${encodeURIComponent(row.postcard_key)}`;
			return `<article class="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_24px_rgba(0,0,0,0.4)]">
				<div class="aspect-[3/2] w-full overflow-hidden bg-black">
					<img src="${imgUrl}" alt="${sceneName} postcard" class="h-full w-full object-cover" loading="lazy" />
				</div>
				<div class="flex items-center justify-between px-4 py-3">
					<div class="text-base font-semibold">${sceneName}</div>
					<div class="text-xs uppercase tracking-widest text-white/50">${age}</div>
				</div>
			</article>`;
		})
		.join('');

	const empty = `<div class="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] py-24 text-center">
		<div class="text-5xl">🎨</div>
		<p class="mt-4 text-lg text-white/70">No postcards yet — be the first!</p>
		<p class="mt-1 text-sm text-white/40">Walk over to the iPad to get started.</p>
	</div>`;

	const origin = new URL(c.req.url).origin;
	const qrTarget = `${origin}${basePath}/kiosk`;

	return c.html(
		page(
			`${event.name} — Gallery`,
			`<div class="display-shimmer fixed inset-0 pointer-events-none" aria-hidden="true"></div>
			<header class="relative px-12 pt-10 pb-8 flex items-center justify-between">
				<div class="text-lg font-bold uppercase tracking-widest text-white/80">
					${escapeAttr(event.name)}
				</div>
				<img src="${basePath}/api/kiosk/qr?url=${encodeURIComponent(qrTarget)}" alt="QR code — scan to start" class="h-24 w-24 rounded" />
			</header>
			<main class="relative px-12 pb-12">
				<div class="mb-8 flex items-end justify-between">
					<div>
						<h1 class="text-5xl md:text-6xl font-black tracking-tight">Fresh from the booth</h1>
						<p class="mt-3 text-lg text-white/60">AI caricature postcards, generated live on Cloudflare.</p>
					</div>
					<a href="${basePath}/kiosk" class="hidden md:inline-flex items-center gap-2 rounded-full bg-cf-orange px-6 py-3 text-base font-semibold text-black hover:bg-cf-orange-dark transition">
						Create yours now
					</a>
				</div>
				<section id="gallery" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
					${results.length === 0 ? empty : cards}
				</section>
			</main>
			<footer class="relative px-12 py-8 flex items-center justify-center border-t border-white/5">
				<div class="inline-flex items-center gap-3 rounded-full border border-cf-orange/30 bg-cf-orange/10 px-5 py-2.5 text-sm font-medium text-cf-orange">
					<img src="/cloudflare-logo.png" alt="" class="h-5 w-auto" />
					<span>Built end-to-end on Cloudflare</span>
				</div>
			</footer>
			<script>
			(function () {
				var basePath = ${JSON.stringify(basePath)};
				var POLL_INTERVAL = 30000;
				var gallery = document.getElementById("gallery");
				// Track which session IDs are currently rendered so we can diff.
				var currentIds = ${JSON.stringify(results.map((r) => r.id))};

				function formatAge(completedAt) {
					if (!completedAt) return "just now";
					var diff = Math.max(0, Math.floor(Date.now() / 1000) - completedAt);
					if (diff < 60) return "just now";
					if (diff < 3600) return Math.floor(diff / 60) + "m ago";
					if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
					return Math.floor(diff / 86400) + "d ago";
				}

				function buildCard(s) {
					var name = s.sceneName || "Untitled scene";
					var imgUrl = "/api/run-img?key=" + encodeURIComponent(s.postcardKey);
					return '<article class="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_24px_rgba(0,0,0,0.4)]">'
						+ '<div class="aspect-[3/2] w-full overflow-hidden bg-black">'
						+ '<img src="' + imgUrl + '" alt="' + name + ' postcard" class="h-full w-full object-cover" loading="lazy" />'
						+ '</div>'
						+ '<div class="flex items-center justify-between px-4 py-3">'
						+ '<div class="text-base font-semibold">' + name + '</div>'
						+ '<div class="text-xs uppercase tracking-widest text-white/50">' + formatAge(s.completedAt) + '</div>'
						+ '</div></article>';
				}

				function buildEmpty() {
					return '<div class="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] py-24 text-center">'
						+ '<div class="text-5xl">🎨</div>'
						+ '<p class="mt-4 text-lg text-white/70">No postcards yet — be the first!</p>'
						+ '<p class="mt-1 text-sm text-white/40">Walk over to the iPad to get started.</p>'
						+ '</div>';
				}

				async function poll() {
					try {
						var res = await fetch(basePath + "/api/gallery/feed");
						if (!res.ok) return;
						var data = await res.json();
						var sessions = data.sessions || [];
						var newIds = sessions.map(function (s) { return s.sessionId; });

						// Quick diff — only re-render if the id list changed.
						if (JSON.stringify(newIds) === JSON.stringify(currentIds)) return;
						currentIds = newIds;

						if (sessions.length === 0) {
							gallery.innerHTML = buildEmpty();
						} else {
							gallery.innerHTML = sessions.map(buildCard).join("");
						}
					} catch (e) {
						// Silently retry next interval.
					}
				}

				setInterval(poll, POLL_INTERVAL);
			})();
			</script>`,
		),
	);
});

/**
 * Big Screen feed endpoint (step 7.2).
 *
 * Returns the last 8 completed sessions as JSON for the /display page's
 * polling loop. Shape: { sessions: [{ sessionId, sceneId, sceneName,
 * postcardKey, completedAt }] }.
 */
eventApp.get('/api/gallery/feed', async (c) => {
	const { event } = c.get('eventCtx');
	const { results } = await c.env.DB.prepare(
		`SELECT id, scene_id, scene_name, postcard_key, completed_at
		 FROM sessions
		 WHERE event_id = ? AND status = 'completed' AND postcard_key IS NOT NULL
		 ORDER BY completed_at DESC
		 LIMIT 8`,
	)
		.bind(event.id)
		.all<{
			id: string;
			scene_id: string | null;
			scene_name: string | null;
			postcard_key: string;
			completed_at: number | null;
		}>();

	return c.json({
		sessions: results.map((r) => ({
			sessionId: r.id,
			sceneId: r.scene_id,
			sceneName: r.scene_name,
			postcardKey: r.postcard_key,
			completedAt: r.completed_at,
		})),
	});
});

// ---------------------------------------------------------------------------
// Print agent endpoints — polled by the Mac mini print agent
// ---------------------------------------------------------------------------

/**
 * Returns pending print jobs for the agent to process.
 * GET /api/print-agent/jobs?limit=5&eventId=<event-slug>
 *
 * eventId is required — each print agent is scoped to one event.
 */
app.get('/api/print-agent/jobs', async (c) => {
	const eventId = c.req.query('eventId');
	if (!eventId) {
		return c.json({ error: 'eventId query param is required' }, 400);
	}

	const limit = Math.min(Number(c.req.query('limit')) || 5, 20);
	const { results } = await c.env.DB.prepare(
		`SELECT id, session_id, event_id, postcard_key, postcard_url, scene_name, created_at
		 FROM print_jobs
		 WHERE status = 'pending' AND event_id = ?
		 ORDER BY created_at ASC
		 LIMIT ?`,
	)
		.bind(eventId, limit)
		.all<{
			id: string;
			session_id: string;
			event_id: string;
			postcard_key: string;
			postcard_url: string;
			scene_name: string;
			created_at: number;
		}>();

	return c.json({ jobs: results });
});

/**
 * Acknowledge a print job (mark it printed or failed).
 * POST /api/print-agent/jobs/:id/ack
 * Body: { "status": "printed" } or { "status": "failed", "error": "reason" }
 */
app.post('/api/print-agent/jobs/:id/ack', async (c) => {
	const jobId = c.req.param('id');
	const body = await c.req.json<{ status: 'printed' | 'failed'; error?: string }>();

	if (body.status !== 'printed' && body.status !== 'failed') {
		return c.json({ error: "status must be 'printed' or 'failed'" }, 400);
	}

	const result = await c.env.DB.prepare(
		`UPDATE print_jobs
		 SET status = ?, printed_at = CASE WHEN ? = 'printed' THEN unixepoch() ELSE NULL END, error_msg = ?
		 WHERE id = ? AND status IN ('pending', 'printing')`,
	)
		.bind(body.status, body.status, body.error ?? null, jobId)
		.run();

	if ((result.meta.changes ?? 0) === 0) {
		return c.json({ error: 'job not found or already acked' }, 404);
	}

	// Track print completion/failure. Fetch the session_id for the event.
	const job = await c.env.DB.prepare('SELECT session_id FROM print_jobs WHERE id = ?').bind(jobId).first<{ session_id: string }>();
	const sid = job?.session_id ?? '';
	trackEvent(c.env.ANALYTICS, body.status === 'printed' ? 'print.completed' : 'print.failed', sid, body.error ?? '');

	return c.json({ ok: true, jobId, status: body.status });
});

/**
 * Triggers a new instance of the (bare) caricature workflow.
 * GET /api/test-workflow?note=...
 */
app.get('/api/test-workflow', async (c) => {
	const note = c.req.query('note') ?? undefined;
	const sessionId = crypto.randomUUID();

	const instance = await c.env.CARICATURE_WORKFLOW.create({
		params: { sessionId, note },
	});
	const status = await instance.status();

	return c.json({
		ok: true,
		sessionId,
		instanceId: instance.id,
		status,
		next: `/api/test-workflow/${instance.id}`,
	});
});

/**
 * Returns the live status of a workflow instance.
 * GET /api/test-workflow/:id
 */
app.get('/api/test-workflow/:id', async (c) => {
	const id = c.req.param('id');
	try {
		const instance = await c.env.CARICATURE_WORKFLOW.get(id);
		const status = await instance.status();
		return c.json({ ok: true, instanceId: id, status });
	} catch (err) {
		return c.json({ error: 'instance not found', details: String(err) }, 404);
	}
});

// ---------------------------------------------------------------------------
// SessionDO test endpoints (step 5.1)
//
// One DO per session, addressed by `idFromName(sessionId)`. These routes are
// thin proxies to the DO's RPC methods so we can verify the binding works
// before wiring the workflow to it in 5.4.
// ---------------------------------------------------------------------------

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const VALID_SESSION_STATUSES = ['queued', 'moderating', 'generating', 'compositing', 'done', 'errored'] as const;
type SessionStatusName = (typeof VALID_SESSION_STATUSES)[number];

function getSessionStub(env: Env, sessionId: string) {
	const id = env.SESSION.idFromName(sessionId);
	return env.SESSION.get(id);
}

/**
 * Creates a new session DO (random UUID) and seeds it to status=queued.
 * POST /api/test-session
 */
app.post('/api/test-session', async (c) => {
	const sessionId = crypto.randomUUID();
	const stub = getSessionStub(c.env, sessionId);
	const state = await stub.getState(sessionId);
	return c.json({ ok: true, sessionId, state });
});

/**
 * Returns the current state of a session DO.
 * GET /api/test-session/:id
 */
app.get('/api/test-session/:id', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) return c.json({ error: 'invalid session id' }, 400);
	const stub = getSessionStub(c.env, id);
	const state = await stub.getState(id);
	return c.json({ ok: true, sessionId: id, state });
});

/**
 * Advances the session's state machine to the requested status. Optional
 * payload fields (sceneId, error, elapsedMs, etc.) are merged into state.
 * POST /api/test-session/:id/status   body: { status, ...payload }
 *
 * Step 5.2: invalid transitions now return 409 with the allowed next states.
 */
app.post('/api/test-session/:id/status', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) return c.json({ error: 'invalid session id' }, 400);

	// Accept JSON, form-urlencoded, multipart form-data, or ?status= query
	// param so curl, the HTML form, and fetch(FormData) all work.
	const ct = c.req.header('content-type') ?? '';
	let parsed: Record<string, unknown> = {};
	const qs = c.req.query('status');
	if (qs) parsed.status = qs;

	if (!parsed.status) {
		try {
			if (ct.includes('application/json')) {
				parsed = (await c.req.json()) as Record<string, unknown>;
			} else if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
				const fd = await c.req.formData();
				for (const [k, v] of fd.entries()) parsed[k] = v;
			} else {
				const text = await c.req.text();
				const m = text.match(/(?:^|&)status=([^&]+)/);
				if (m) parsed.status = decodeURIComponent(m[1]);
			}
		} catch (err) {
			return c.json(
				{
					error: 'failed to parse body',
					details: String(err),
					contentType: ct,
				},
				400,
			);
		}
	}

	const status = parsed.status;
	if (typeof status !== 'string' || !VALID_SESSION_STATUSES.includes(status as SessionStatusName)) {
		return c.json({ error: 'invalid status', validStatuses: VALID_SESSION_STATUSES }, 400);
	}

	const payload = {
		sceneId: typeof parsed.sceneId === 'string' ? parsed.sceneId : undefined,
		sceneName: typeof parsed.sceneName === 'string' ? parsed.sceneName : undefined,
		selfieKey: typeof parsed.selfieKey === 'string' ? parsed.selfieKey : undefined,
		caricatureKey: typeof parsed.caricatureKey === 'string' ? parsed.caricatureKey : undefined,
		postcardKey: typeof parsed.postcardKey === 'string' ? parsed.postcardKey : undefined,
		postcardUrl: typeof parsed.postcardUrl === 'string' ? parsed.postcardUrl : undefined,
		error: typeof parsed.error === 'string' ? parsed.error : undefined,
		elapsedMs:
			typeof parsed.elapsedMs === 'string' ? Number(parsed.elapsedMs) : typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : undefined,
	};

	const stub = getSessionStub(c.env, id);
	try {
		const state = await stub.markStep(status as SessionStatusName, payload, id);
		return c.json({ ok: true, sessionId: id, state });
	} catch (err) {
		const msg = String(err);
		// InvalidTransitionError is thrown across RPC as a plain error; match
		// on the message we know the DO produces.
		if (msg.includes('invalid session transition')) {
			return c.json(
				{
					error: msg.replace(/^Error: /, ''),
					hint: 'see TRANSITIONS table in src/session/session.ts',
				},
				409,
			);
		}
		return c.json({ error: msg }, 500);
	}
});

/**
 * Force-deletes a session DO's storage. The DO would normally self-delete
 * 5 minutes after reaching a terminal state; this is the explicit override
 * for testing.
 * DELETE /api/test-session/:id
 */
app.delete('/api/test-session/:id', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) return c.json({ error: 'invalid session id' }, 400);
	const stub = getSessionStub(c.env, id);
	await stub.delete();
	return c.json({ ok: true, sessionId: id, deleted: true });
});

/**
 * WebSocket endpoint: upgrade request is proxied to the SessionDO which
 * accepts it via the Hibernation API. The DO sends a `state` frame on
 * connect and broadcasts a new `state` (or `deleted`) frame on every change.
 *
 * GET /api/session/:id/ws  (with Upgrade: websocket)
 */
eventApp.get('/api/session/:id/ws', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) return c.json({ error: 'invalid session id' }, 400);
	if (c.req.header('Upgrade') !== 'websocket') {
		return c.json({ error: 'expected websocket upgrade' }, 426);
	}
	const stub = getSessionStub(c.env, id);
	// Pass the raw request through so the DO sees the Upgrade headers.
	return stub.fetch(c.req.raw);
});

/**
 * Manual driver page for the SessionDO (step 5.2).
 * Click to create a session, then use the status form to drive its state.
 * GET /test-session       — landing / create
 * GET /test-session/:id   — drive an existing session
 */
app.get('/test-session', (c) => {
	return c.html(
		page(
			'Session DO — Step 5.3',
			`<main class="min-h-screen flex flex-col items-center px-6 py-12">
				<h1 class="text-3xl font-bold mb-2">Session Durable Object</h1>
				<p class="text-white/60 mb-8 max-w-xl text-center">
					One DO per caricature session with live WebSocket fan-out. Step 5.3
					adds the <code>/ws</code> endpoint (hibernation API) — open the same
					session in two tabs to watch one push updates to the other in real time.
				</p>
				<form id="new-session" action="/api/test-session" method="post" class="w-full max-w-md bg-white/5 rounded-2xl p-8 border border-white/10">
					<button type="submit" class="w-full rounded-full bg-cf-orange px-6 py-3 text-base font-semibold text-black hover:bg-cf-orange-dark transition">
						Create a new session
					</button>
				</form>
				<a href="/" class="mt-8 text-sm text-white/60 hover:text-white">← back home</a>
				<script>
					document.getElementById("new-session").addEventListener("submit", async function (e) {
						e.preventDefault();
						const r = await fetch("/api/test-session", { method: "POST" });
						const j = await r.json();
						if (j.ok) window.location.href = "/test-session/" + j.sessionId;
					});
				</script>
			</main>`,
		),
	);
});

app.get('/test-session/:id', (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) return c.notFound();
	const statusOptions = VALID_SESSION_STATUSES.map((s) => `<option value="${s}">${s}</option>`).join('');
	return c.html(
		page(
			`Session ${id.slice(0, 8)}…`,
			`<main class="min-h-screen flex flex-col items-center px-6 py-12 max-w-3xl mx-auto">
				<h1 class="text-3xl font-bold mb-2">Session DO</h1>
				<p class="text-white/60 text-sm">Session: <code class="text-white/80">${id}</code></p>

				<section class="w-full mt-8 rounded-2xl bg-white/5 border border-white/10 p-6">
					<div class="flex items-center justify-between mb-2">
						<h2 class="text-sm font-semibold text-white/60">Current state (live)</h2>
						<div class="flex items-center gap-2 text-xs">
							<span id="ws-dot" class="size-2 rounded-full bg-zinc-500"></span>
							<span id="ws-label" class="text-white/50">connecting…</span>
						</div>
					</div>
					<pre id="state" class="text-xs whitespace-pre-wrap break-words text-white/80">loading…</pre>
					<button id="refresh" class="mt-4 text-sm text-cf-orange hover:underline">↻ refresh (HTTP)</button>
				</section>

				<section class="w-full mt-6 rounded-2xl bg-white/5 border border-white/10 p-6">
					<h2 class="text-sm font-semibold text-white/60 mb-4">Mark step (validated)</h2>
					<form id="status-form" class="space-y-3">
						<div class="flex gap-3">
							<select name="status" class="flex-1 rounded-lg bg-black/40 border border-white/20 px-4 py-2 text-white">
								${statusOptions}
							</select>
							<button type="submit" class="rounded-full bg-cf-orange px-5 py-2 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">
								Apply
							</button>
						</div>
						<details class="text-xs text-white/60">
							<summary class="cursor-pointer hover:text-white">+ optional payload</summary>
							<div class="mt-3 grid grid-cols-2 gap-2">
								<input name="sceneId" placeholder="sceneId" class="rounded-lg bg-black/40 border border-white/20 px-3 py-1.5 text-white text-xs" />
								<input name="sceneName" placeholder="sceneName" class="rounded-lg bg-black/40 border border-white/20 px-3 py-1.5 text-white text-xs" />
								<input name="caricatureKey" placeholder="caricatureKey" class="rounded-lg bg-black/40 border border-white/20 px-3 py-1.5 text-white text-xs" />
								<input name="postcardKey" placeholder="postcardKey" class="rounded-lg bg-black/40 border border-white/20 px-3 py-1.5 text-white text-xs" />
								<input name="error" placeholder="error" class="rounded-lg bg-black/40 border border-white/20 px-3 py-1.5 text-white text-xs col-span-2" />
								<input name="elapsedMs" type="number" placeholder="elapsedMs" class="rounded-lg bg-black/40 border border-white/20 px-3 py-1.5 text-white text-xs" />
							</div>
						</details>
					</form>
					<p id="status-msg" class="text-xs text-white/50 mt-3"></p>
					<div class="mt-4 text-[11px] text-white/40 leading-relaxed">
						Allowed transitions: queued → moderating → generating → compositing → done.
						Any non-terminal state may also go directly to errored.
					</div>
				</section>

				<section class="w-full mt-6 rounded-2xl bg-white/5 border border-white/10 p-6">
					<h2 class="text-sm font-semibold text-white/60 mb-2">Danger zone</h2>
					<button id="delete-btn" class="rounded-full bg-red-600/80 hover:bg-red-500 px-5 py-2 text-sm font-semibold text-white transition">
						Force-delete DO storage
					</button>
					<p class="text-[11px] text-white/40 mt-2">
						Sessions self-delete 5 minutes after reaching done/errored. This is the explicit override.
					</p>
				</section>

				<a href="/test-session" class="mt-8 text-sm text-white/60 hover:text-white">← new session</a>

				<script>
					(function () {
						const id = ${JSON.stringify(id)};
						const stateEl = document.getElementById("state");
						const refreshEl = document.getElementById("refresh");
						const formEl = document.getElementById("status-form");
						const msgEl = document.getElementById("status-msg");
						const deleteBtn = document.getElementById("delete-btn");
						const wsDot = document.getElementById("ws-dot");
						const wsLabel = document.getElementById("ws-label");
						const statusSelect = formEl.querySelector('select[name="status"]');

						function applyState(state) {
							stateEl.textContent = JSON.stringify(state, null, 2);
							if (state && state.status) statusSelect.value = state.status;
						}

						async function httpRefresh() {
							const r = await fetch("/api/test-session/" + id);
							const j = await r.json();
							applyState(j.state);
						}
						refreshEl.addEventListener("click", httpRefresh);

						formEl.addEventListener("submit", async function (e) {
							e.preventDefault();
							msgEl.textContent = "updating…";
							const fd = new FormData(formEl);
							for (const [k, v] of Array.from(fd.entries())) {
								if (typeof v === "string" && v.trim() === "") fd.delete(k);
							}
							const r = await fetch("/api/test-session/" + id + "/status", {
								method: "POST",
								body: fd,
							});
							const j = await r.json();
							if (j.ok) {
								msgEl.textContent = "✓ marked " + j.state.status + " (WS will also update below)";
								applyState(j.state);
							} else if (r.status === 409) {
								msgEl.textContent = "⛔ " + j.error;
							} else {
								msgEl.textContent = "✗ " + (j.error || "error");
							}
						});

						deleteBtn.addEventListener("click", async function () {
							if (!confirm("Force-delete this DO's storage?")) return;
							const r = await fetch("/api/test-session/" + id, { method: "DELETE" });
							const j = await r.json();
							msgEl.textContent = j.ok ? "✓ deleted" : "✗ " + (j.error || "error");
						});

						// ----- WebSocket -----
						let ws;
						let backoff = 500;
						function setWsStatus(label, color) {
							wsLabel.textContent = label;
							wsDot.className = "size-2 rounded-full " + color;
						}
						function connect() {
							const proto = location.protocol === "https:" ? "wss:" : "ws:";
							const url = proto + "//" + location.host + "/api/session/" + id + "/ws";
							setWsStatus("connecting…", "bg-yellow-400 animate-pulse");
							ws = new WebSocket(url);
							ws.addEventListener("open", function () {
								setWsStatus("live", "bg-emerald-500");
								backoff = 500;
							});
							ws.addEventListener("message", function (e) {
								if (e.data === "pong") return;
								try {
									const msg = JSON.parse(e.data);
									if (msg.type === "state") applyState(msg.state);
									else if (msg.type === "deleted") {
										msgEl.textContent = "✓ session deleted (broadcast received)";
										setWsStatus("deleted", "bg-red-500");
									}
								} catch (err) {
									console.error("bad ws frame:", e.data, err);
								}
							});
							ws.addEventListener("close", function () {
								setWsStatus("disconnected — retrying", "bg-red-500");
								setTimeout(connect, backoff);
								backoff = Math.min(backoff * 2, 10000);
							});
							ws.addEventListener("error", function () {
								// close will fire too; let it handle reconnect.
							});
						}
						connect();
					})();
				</script>
			</main>`,
		),
	);
});

/**
 * HTML test form for the moderate-step workflow (step 4.2).
 * Uploads a selfie, triggers the workflow, redirects to a status page.
 * GET /test-workflow-moderate
 */
app.get('/test-workflow-moderate', async (c) => {
	const scenes = await loadScenes(c.env);
	return c.html(
		page(
			'Workflow — Step 4.4',
			`<main class="min-h-screen flex flex-col items-center px-6 py-12">
				<h1 class="text-3xl font-bold mb-2">Workflow: full pipeline</h1>
				<p class="text-white/60 mb-8 max-w-xl text-center">
					Upload a selfie + pick a scene. We'll stash the selfie in R2, kick off
					a CaricatureWorkflow that runs <code>moderate</code> → <code>generate</code>
					→ <code>composite</code> → <code>store</code>, then show the finished
					4×6 postcard inline.
				</p>
				<form id="wf-form" action="/api/test-workflow-moderate" method="post" enctype="multipart/form-data" class="w-full max-w-xl space-y-6 bg-white/5 rounded-2xl p-8 border border-white/10">
					<div>
						<label class="block text-sm font-medium mb-2">Selfie</label>
						<input id="wf-selfie" type="file" name="selfie" accept="image/*" required class="block w-full text-sm text-white/80 file:mr-4 file:rounded-full file:border-0 file:bg-cf-orange file:px-4 file:py-2 file:text-sm file:font-semibold file:text-black hover:file:bg-cf-orange-dark" />
					</div>
					<div>
						<label class="block text-sm font-medium mb-2">Scene</label>
						<select id="wf-scene" name="scene_id" class="w-full rounded-lg bg-black/40 border border-white/20 px-4 py-2 text-white">
							${renderSceneOptions(scenes)}
						</select>
					</div>
					<button id="wf-submit" type="submit" class="w-full rounded-full bg-cf-orange px-6 py-3 text-base font-semibold text-black hover:bg-cf-orange-dark transition disabled:cursor-not-allowed disabled:opacity-60 inline-flex items-center justify-center gap-2">
						<span data-label="idle">Run workflow</span>
						<span data-label="loading" class="hidden items-center gap-2">
							<svg class="size-5 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
								<path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
							</svg>
							<span>Uploading…</span>
						</span>
					</button>
				</form>
				<a href="/" class="mt-8 text-sm text-white/60 hover:text-white">← back home</a>
				<script>
					(function () {
						const form = document.getElementById("wf-form");
						const button = document.getElementById("wf-submit");
						const scene = document.getElementById("wf-scene");
						const idle = button.querySelector('[data-label="idle"]');
						const loading = button.querySelector('[data-label="loading"]');
						function setLoading(on) {
							button.disabled = on;
							scene.disabled = on;
							form.style.pointerEvents = on ? "none" : "";
							form.style.opacity = on ? "0.85" : "";
							idle.classList.toggle("hidden", on);
							loading.classList.toggle("hidden", !on);
							loading.classList.toggle("inline-flex", on);
						}
						form.addEventListener("submit", function () { setLoading(true); });
						window.addEventListener("pageshow", function (e) { if (e.persisted) setLoading(false); });
					})();
				</script>
			</main>`,
		),
	);
});

/**
 * Uploads a selfie to R2 and kicks off the workflow with the R2 key + chosen
 * scene id. Redirects (303) to a status page that polls the workflow instance.
 * POST /api/test-workflow-moderate  (multipart: selfie=file, scene_id=string)
 */
app.post('/api/test-workflow-moderate', async (c) => {
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
	const sceneId = String(inForm.get('scene_id') ?? 'hot-dog-stand');

	// Validate scene id against KV up front so we fail fast (before paying
	// the cost of an R2 upload + workflow create).
	let scenes: Scene[];
	try {
		scenes = await loadScenes(c.env);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
	if (!scenes.some((s) => s.id === sceneId)) {
		return c.json({ error: `unknown scene_id: ${sceneId}` }, 400);
	}

	const sessionId = crypto.randomUUID();
	const ext = (selfie.name.match(/\.(jpe?g|png|webp|heic)$/i)?.[1] ?? 'jpg').toLowerCase();
	const selfieKey = `workflow-test/${sessionId}/selfie.${ext}`;

	await c.env.BUCKET.put(selfieKey, await selfie.arrayBuffer(), {
		httpMetadata: { contentType: selfie.type || 'image/jpeg' },
		customMetadata: {
			sessionId,
			originalName: selfie.name || '(unnamed)',
		},
	});

	const publicOrigin = new URL(c.req.url).origin;
	const instance = await c.env.CARICATURE_WORKFLOW.create({
		params: {
			sessionId,
			selfieKey,
			sceneId,
			publicOrigin,
			note: 'step-4.4-full-pipeline-test',
		},
	});

	const url = new URL(c.req.url);
	url.pathname = `/test-workflow-moderate/${instance.id}`;
	url.search = `?session=${sessionId}`;
	return c.redirect(url.toString(), 303);
});

/**
 * Live status page for a workflow-moderate run.
 * Auto-polls /api/test-workflow/:id every 1s until terminal state.
 * GET /test-workflow-moderate/:id
 */
app.get('/test-workflow-moderate/:id', (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) {
		return c.notFound();
	}
	const sessionFromQs = c.req.query('session');
	const sessionId = sessionFromQs && UUID_RE.test(sessionFromQs) ? sessionFromQs : null;

	return c.html(
		page(
			`Workflow ${id.slice(0, 8)}…`,
			`<main class="min-h-screen flex flex-col items-center px-6 py-12 max-w-3xl mx-auto">
				<h1 class="text-3xl font-bold mb-2">Workflow run</h1>
				<p class="text-white/60 text-sm">Instance: <code class="text-white/80">${id}</code></p>
				${sessionId ? `<p class="text-white/60 text-sm mt-1">Session: <code class="text-white/80">${sessionId}</code></p>` : ''}
				<section class="w-full mt-8 rounded-2xl bg-white/5 border border-white/10 p-6">
					<div class="flex items-center gap-3">
						<span id="wf-pulse" class="size-3 rounded-full bg-yellow-400 animate-pulse"></span>
						<span id="wf-status-label" class="text-lg font-semibold">queued</span>
					</div>
					<dl class="mt-6 grid grid-cols-2 gap-3 text-sm">
						<dt class="text-white/50">Started</dt><dd id="wf-started" class="text-white/80">—</dd>
						<dt class="text-white/50">Elapsed</dt><dd id="wf-elapsed" class="text-white/80">0.0s</dd>
					</dl>
				</section>
				${
					sessionId
						? `<section class="w-full mt-6 rounded-2xl bg-white/5 border border-white/10 p-6">
								<div class="flex items-center justify-between mb-2">
									<h2 class="text-sm font-semibold text-white/60">Session DO (live)</h2>
									<div class="flex items-center gap-2 text-xs">
										<span id="sd-dot" class="size-2 rounded-full bg-zinc-500"></span>
										<span id="sd-label" class="text-white/50">connecting…</span>
									</div>
								</div>
								<div class="flex items-center gap-3 mb-3">
									<span id="sd-status-dot" class="size-3 rounded-full bg-yellow-400"></span>
									<span id="sd-status" class="text-base font-semibold">queued</span>
								</div>
								<pre id="sd-raw" class="text-[11px] whitespace-pre-wrap break-words text-white/60">awaiting first frame…</pre>
							</section>`
						: ''
				}
				<section id="wf-preview" class="w-full mt-6 rounded-2xl bg-white/5 border border-white/10 p-6 hidden">
					<h2 class="text-sm font-semibold text-white/60 mb-4">Artifacts</h2>
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<figure>
							<figcaption class="text-xs text-white/50 mb-1">Caricature</figcaption>
							<img id="wf-caricature" alt="caricature" class="w-full rounded-xl bg-black/40 border border-white/10" />
						</figure>
						<figure>
							<figcaption class="text-xs text-white/50 mb-1">Postcard (4×6 @ 300 DPI)</figcaption>
							<img id="wf-postcard" alt="postcard" class="w-full rounded-xl bg-black/40 border border-white/10" />
							<p id="wf-postcard-link" class="text-xs text-white/50 mt-2"></p>
						</figure>
					</div>
				</section>
				<section class="w-full mt-6 rounded-2xl bg-black/40 border border-white/10 p-4">
					<h2 class="text-sm font-semibold text-white/60 mb-2">Raw status</h2>
					<pre id="wf-raw" class="text-xs whitespace-pre-wrap break-words text-white/70">loading…</pre>
				</section>
				<a href="/test-workflow-moderate" class="mt-8 text-sm text-white/60 hover:text-white">← new run</a>
				<script>
					(function () {
						const id = ${JSON.stringify(id)};
						const sessionId = ${JSON.stringify(sessionId)};
						const labelEl = document.getElementById("wf-status-label");
						const pulseEl = document.getElementById("wf-pulse");
						const elapsedEl = document.getElementById("wf-elapsed");
						const startedEl = document.getElementById("wf-started");
						const rawEl = document.getElementById("wf-raw");
						const previewEl = document.getElementById("wf-preview");
						const caricatureEl = document.getElementById("wf-caricature");
						const postcardEl = document.getElementById("wf-postcard");
						const postcardLinkEl = document.getElementById("wf-postcard-link");
						const sdDot = document.getElementById("sd-dot");
						const sdLabel = document.getElementById("sd-label");
						const sdStatusDot = document.getElementById("sd-status-dot");
						const sdStatusEl = document.getElementById("sd-status");
						const sdRawEl = document.getElementById("sd-raw");

						const sessionColorMap = {
							queued:       "bg-yellow-400",
							moderating:   "bg-blue-400",
							generating:   "bg-blue-400",
							compositing:  "bg-blue-400",
							done:         "bg-emerald-500",
							errored:      "bg-red-500",
						};
						const sessionTerminal = new Set(["done", "errored"]);

						function applySessionState(state) {
							if (!state) return;
							sdStatusEl.textContent = state.status;
							sdStatusDot.className = "size-3 rounded-full " + (sessionColorMap[state.status] || "bg-zinc-400") + (sessionTerminal.has(state.status) ? "" : " animate-pulse");
							sdRawEl.textContent = JSON.stringify(state, null, 2);
						}

						if (sessionId) {
							let sdWs;
							let sdBackoff = 500;
							function setSdStatus(label, color) {
								sdLabel.textContent = label;
								sdDot.className = "size-2 rounded-full " + color;
							}
							function sdConnect() {
								const proto = location.protocol === "https:" ? "wss:" : "ws:";
								const url = proto + "//" + location.host + "/api/session/" + sessionId + "/ws";
								setSdStatus("connecting…", "bg-yellow-400 animate-pulse");
								sdWs = new WebSocket(url);
								sdWs.addEventListener("open", function () {
									setSdStatus("live", "bg-emerald-500");
									sdBackoff = 500;
								});
								sdWs.addEventListener("message", function (e) {
									if (e.data === "pong") return;
									try {
										const msg = JSON.parse(e.data);
										if (msg.type === "state") applySessionState(msg.state);
										else if (msg.type === "deleted") {
											setSdStatus("deleted", "bg-red-500");
											sdRawEl.textContent = "session DO storage cleared";
										}
									} catch (err) {
										console.error("bad ws frame:", e.data, err);
									}
								});
								sdWs.addEventListener("close", function () {
									setSdStatus("disconnected — retrying", "bg-red-500");
									setTimeout(sdConnect, sdBackoff);
									sdBackoff = Math.min(sdBackoff * 2, 10000);
								});
							}
							sdConnect();
						}

						const t0 = Date.now();
						startedEl.textContent = new Date().toLocaleTimeString();
						const tickHandle = setInterval(function () {
							const s = ((Date.now() - t0) / 1000).toFixed(1);
							elapsedEl.textContent = s + "s";
						}, 100);

						const terminal = new Set(["complete", "errored", "terminated", "failed"]);
						const colorMap = {
							queued:      "bg-yellow-400",
							running:     "bg-blue-400",
							paused:      "bg-zinc-400",
							complete:    "bg-emerald-500",
							errored:     "bg-red-500",
							failed:      "bg-red-500",
							terminated:  "bg-red-500",
						};

						function showArtifacts(output) {
							if (!output) return;
							const caricatureKey = output.generate && output.generate.caricatureKey;
							const postcardKey = output.composite && output.composite.postcardKey;
							const postcardUrl = output.composite && output.composite.postcardUrl;
							if (caricatureKey || postcardKey) previewEl.classList.remove("hidden");
							if (caricatureKey) caricatureEl.src = "/api/run-img?key=" + encodeURIComponent(caricatureKey);
							if (postcardKey) postcardEl.src = "/api/run-img?key=" + encodeURIComponent(postcardKey);
							if (postcardUrl) {
								postcardLinkEl.innerHTML = "QR target: <a class=\\"text-cf-orange hover:underline\\" href=\\"" + postcardUrl + "\\" target=\\"_blank\\" rel=\\"noopener\\">" + postcardUrl + "</a>";
							}
						}

						async function poll() {
							try {
								const r = await fetch("/api/test-workflow/" + id);
								const j = await r.json();
								const s = (j.status && j.status.status) || "unknown";
								labelEl.textContent = s;
								pulseEl.className = "size-3 rounded-full " + (colorMap[s] || "bg-zinc-400") + (terminal.has(s) ? "" : " animate-pulse");
								rawEl.textContent = JSON.stringify(j.status, null, 2);
								if (j.status && j.status.output) showArtifacts(j.status.output);
								if (terminal.has(s)) {
									clearInterval(tickHandle);
									const finalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
									elapsedEl.textContent = finalElapsed + "s (final)";
								} else {
									setTimeout(poll, 1000);
								}
							} catch (e) {
								rawEl.textContent = "poll error: " + e.message;
								setTimeout(poll, 2000);
							}
						}
						poll();
					})();
				</script>
			</main>`,
		),
	);
});

/**
 * Simple HTML test form for image-to-image generation.
 * GET /test-i2i
 */
app.get('/test-i2i', async (c) => {
	const scenes = await loadScenes(c.env);
	return c.html(
		page(
			'Test image-to-image — Step 2.2',
			`<main class="min-h-screen flex flex-col items-center justify-center px-6 py-12">
				<h1 class="text-3xl font-bold mb-2">Image-to-image test</h1>
				<p class="text-white/60 mb-8">Upload a selfie + pick a scene. FLUX.2 will generate a caricature.</p>
				<form id="i2i-form" action="/api/test-i2i" method="post" enctype="multipart/form-data" class="w-full max-w-xl space-y-6 bg-white/5 rounded-2xl p-8 border border-white/10">
					<div>
						<label class="block text-sm font-medium mb-2">Selfie</label>
						<input id="i2i-selfie" type="file" name="selfie" accept="image/*" required class="block w-full text-sm text-white/80 file:mr-4 file:rounded-full file:border-0 file:bg-cf-orange file:px-4 file:py-2 file:text-sm file:font-semibold file:text-black hover:file:bg-cf-orange-dark" />
					</div>
					<div>
						<label class="block text-sm font-medium mb-2">Scene</label>
						<select id="i2i-scene" name="scene_id" class="w-full rounded-lg bg-black/40 border border-white/20 px-4 py-2 text-white">
							${renderSceneOptions(scenes)}
						</select>
					</div>
					<button id="i2i-submit" type="submit" class="w-full rounded-full bg-cf-orange px-6 py-3 text-base font-semibold text-black hover:bg-cf-orange-dark transition disabled:cursor-not-allowed disabled:opacity-60 inline-flex items-center justify-center gap-2">
						<span data-label="idle">Generate caricature</span>
						<span data-label="loading" class="hidden items-center gap-2">
							<svg class="size-5 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
								<path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
							</svg>
							<span>Generating…</span>
						</span>
					</button>
				</form>
				<script>
					(function () {
						const form = document.getElementById("i2i-form");
						const button = document.getElementById("i2i-submit");
						const scene = document.getElementById("i2i-scene");
						const idleLabel = button.querySelector('[data-label="idle"]');
						const loadingLabel = button.querySelector('[data-label="loading"]');

						function setLoading(on) {
							// IMPORTANT: do not disable the file input. A disabled file input
							// is excluded from form submission, which causes the server to see
							// no selfie file. Visually lock the form with pointer-events instead.
							button.disabled = on;
							scene.disabled = on;
							form.style.pointerEvents = on ? "none" : "";
							form.style.opacity = on ? "0.85" : "";
							idleLabel.classList.toggle("hidden", on);
							loadingLabel.classList.toggle("hidden", !on);
							loadingLabel.classList.toggle("inline-flex", on);
						}

						form.addEventListener("submit", function () {
							setLoading(true);
						});

						// If the user comes back via the bfcache (browser back button) reset state.
						window.addEventListener("pageshow", function (e) {
							if (e.persisted) setLoading(false);
						});
					})();
				</script>
				<a href="/" class="mt-8 text-sm text-white/60 hover:text-white">← back home</a>
			</main>`,
		),
	);
});

/**
 * Image-to-image generation: selfie -> caricature in chosen NYC scene.
 * POST /api/test-i2i  (multipart: selfie=file, scene_id=string)
 */
app.post('/api/test-i2i', async (c) => {
	let inForm: FormData;
	try {
		inForm = await c.req.formData();
	} catch (err) {
		return c.json({ error: "expected multipart/form-data with 'selfie'", details: String(err) }, 400);
	}
	const selfie = inForm.get('selfie');
	const sceneId = String(inForm.get('scene_id') ?? 'hot-dog-stand');

	if (!(selfie instanceof File) || selfie.size === 0) {
		return c.json({ error: 'missing selfie file' }, 400);
	}

	let scenes: Scene[];
	try {
		scenes = await loadScenes(c.env);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
	const scene = scenes.find((s) => s.id === sceneId);
	if (!scene) return c.json({ error: `unknown scene_id: ${sceneId}` }, 400);

	const selfieBytes = await selfie.arrayBuffer();
	try {
		// Use nano-banana via Replicate so this test endpoint matches
		// what the production workflow (CaricatureWorkflow) uses. Iterating
		// on prompts against FLUX would give misleading results.
		const { bytes, contentType, elapsedMs } = await runReplicate(c.env.REPLICATE_API_TOKEN, {
			prompt: scene.prompt,
			selfieBytes,
			selfieType: selfie.type,
		});

		return new Response(bytes, {
			headers: {
				'content-type': contentType,
				'content-length': String(bytes.byteLength),
				'x-elapsed-ms': String(elapsedMs),
				'x-scene-id': scene.id,
				'x-scene-name': scene.name,
			},
		});
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

/**
 * Renders the scene-grid prompt-spike form.
 * GET /test-scene-grid
 */
app.get('/test-scene-grid', (c) => {
	return c.html(
		page(
			'Scene prompt spike — Step 2.3',
			`<main class="min-h-screen flex flex-col items-center px-6 py-12">
				<h1 class="text-3xl font-bold mb-2">Scene prompt spike</h1>
				<p class="text-white/60 mb-8 max-w-xl text-center">
					Upload one selfie. We'll generate one caricature for every scene in parallel,
					save them to R2, and show them side by side so we can refine prompts.
				</p>
				<form id="grid-form" action="/api/test-scene-grid" method="post" enctype="multipart/form-data" class="w-full max-w-xl space-y-6 bg-white/5 rounded-2xl p-8 border border-white/10">
					<div>
						<label class="block text-sm font-medium mb-2">Selfie</label>
						<input id="grid-selfie" type="file" name="selfie" accept="image/*" required class="block w-full text-sm text-white/80 file:mr-4 file:rounded-full file:border-0 file:bg-cf-orange file:px-4 file:py-2 file:text-sm file:font-semibold file:text-black hover:file:bg-cf-orange-dark" />
					</div>
					<button id="grid-submit" type="submit" class="w-full rounded-full bg-cf-orange px-6 py-3 text-base font-semibold text-black hover:bg-cf-orange-dark transition disabled:cursor-not-allowed disabled:opacity-60 inline-flex items-center justify-center gap-2">
						<span data-label="idle">Generate all 6 scenes</span>
						<span data-label="loading" class="hidden items-center gap-2">
							<svg class="size-5 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
								<path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
							</svg>
							<span>Generating…</span>
						</span>
					</button>
				</form>
				<a href="/" class="mt-8 text-sm text-white/60 hover:text-white">← back home</a>
				<script>
					(function () {
						const form = document.getElementById("grid-form");
						const button = document.getElementById("grid-submit");
						const idle = button.querySelector('[data-label="idle"]');
						const loading = button.querySelector('[data-label="loading"]');
						function setLoading(on) {
							button.disabled = on;
							form.style.pointerEvents = on ? "none" : "";
							form.style.opacity = on ? "0.85" : "";
							idle.classList.toggle("hidden", on);
							loading.classList.toggle("hidden", !on);
							loading.classList.toggle("inline-flex", on);
						}
						form.addEventListener("submit", function () { setLoading(true); });
						window.addEventListener("pageshow", function (e) { if (e.persisted) setLoading(false); });
					})();
				</script>
			</main>`,
		),
	);
});

/**
 * Generates a caricature for every scene from a single selfie, in parallel.
 * Stores each result in R2 under prompt-spike/<runId>/<sceneId>.jpg and
 * redirects to the review page.
 * POST /api/test-scene-grid  (multipart: selfie=file)
 */
app.post('/api/test-scene-grid', async (c) => {
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

	let scenes: Scene[];
	try {
		scenes = await loadScenes(c.env);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}

	const runId = String(Date.now());
	const selfieBytes = await selfie.arrayBuffer();
	const selfieType = selfie.type || 'image/jpeg';

	// Also stash the original selfie so the review page can show the input.
	await c.env.BUCKET.put(`prompt-spike/${runId}/selfie.jpg`, selfieBytes, {
		httpMetadata: { contentType: selfieType },
	});

	const overallStart = Date.now();
	const results = await Promise.allSettled(
		scenes.map(async (scene) => {
			// Use nano-banana via Replicate so the scene grid matches the
			// production workflow's model. Otherwise we'd be tuning prompts
			// against the wrong model.
			const { bytes, contentType, elapsedMs } = await runReplicate(c.env.REPLICATE_API_TOKEN, {
				prompt: scene.prompt,
				selfieBytes,
				selfieType,
			});
			const ext = contentType === 'image/png' ? 'png' : 'jpg';
			const key = `prompt-spike/${runId}/${scene.id}.${ext}`;
			await c.env.BUCKET.put(key, bytes, {
				httpMetadata: { contentType },
				customMetadata: {
					sceneId: scene.id,
					sceneName: scene.name,
					promptLength: String(scene.prompt.length),
					elapsedMs: String(elapsedMs),
				},
			});
			return { sceneId: scene.id, key, elapsedMs };
		}),
	);
	const totalMs = Date.now() - overallStart;

	const successes = results.map((r, i) => ({ scene: scenes[i], result: r })).filter((x) => x.result.status === 'fulfilled');
	const failures = results.map((r, i) => ({ scene: scenes[i], result: r })).filter((x) => x.result.status === 'rejected');

	// Redirect (303 = POST-redirect-GET) to the review page for this run.
	const url = new URL(c.req.url);
	url.pathname = `/test-scene-grid/${runId}`;
	url.search = '';
	c.header('x-total-ms', String(totalMs));
	c.header('x-successes', String(successes.length));
	c.header('x-failures', String(failures.length));
	return c.redirect(url.toString(), 303);
});

/**
 * Side-by-side review page for a scene-grid run.
 * GET /test-scene-grid/:runId
 */
app.get('/test-scene-grid/:runId', async (c) => {
	const runId = c.req.param('runId');
	if (!/^\d+$/.test(runId)) return c.notFound();

	const scenes = await loadScenes(c.env);
	const prefix = `prompt-spike/${runId}/`;
	const listing = await c.env.BUCKET.list({ prefix, limit: 100 });
	const keysByScene = new Map<string, string>();
	for (const obj of listing.objects) {
		const filename = obj.key.slice(prefix.length); // "<sceneId>.jpg" or "selfie.jpg"
		const sceneId = filename.replace(/\.(jpg|png)$/i, '');
		keysByScene.set(sceneId, obj.key);
	}

	const selfieKey = keysByScene.get('selfie');
	const generatedAt = new Date(Number(runId)).toLocaleString();

	const cards = scenes
		.map((scene) => {
			const key = keysByScene.get(scene.id);
			const imageHtml = key
				? `<img src="/api/scene-grid-img?key=${encodeURIComponent(key)}" alt="${scene.name}" class="w-full aspect-square object-cover rounded-xl bg-black/40" loading="lazy" />`
				: `<div class="w-full aspect-square rounded-xl bg-red-900/30 border border-red-500/40 flex items-center justify-center text-red-300 text-sm">missing</div>`;
			return `
				<article class="bg-white/5 rounded-2xl p-4 border border-white/10">
					<header class="flex items-center justify-between mb-3">
						<div class="flex items-center gap-2">
							<span class="text-2xl">${scene.emoji}</span>
							<h3 class="font-semibold">${scene.name}</h3>
						</div>
						<code class="text-[10px] text-white/40">${scene.id}</code>
					</header>
					${imageHtml}
					<details class="mt-3">
						<summary class="cursor-pointer text-xs text-white/50 hover:text-white">Prompt</summary>
						<p class="text-xs text-white/70 mt-2 whitespace-pre-wrap leading-relaxed">${scene.prompt}</p>
					</details>
				</article>`;
		})
		.join('\n');

	const selfieHtml = selfieKey
		? `<img src="/api/scene-grid-img?key=${encodeURIComponent(selfieKey)}" alt="Input selfie" class="size-32 rounded-2xl object-cover border border-white/20" />`
		: `<div class="size-32 rounded-2xl bg-white/10 flex items-center justify-center text-white/40 text-xs">no selfie</div>`;

	return c.html(
		page(
			`Scene grid run ${runId}`,
			`<main class="min-h-screen px-6 py-12 max-w-6xl mx-auto">
				<a href="/test-scene-grid" class="text-sm text-white/60 hover:text-white">← new run</a>
				<header class="mt-4 mb-8 flex flex-col md:flex-row items-start md:items-center gap-6">
					${selfieHtml}
					<div>
						<h1 class="text-2xl font-bold">Scene grid run</h1>
						<p class="text-white/60 text-sm">Run ID: <code class="text-white/80">${runId}</code></p>
						<p class="text-white/60 text-sm">${generatedAt}</p>
					</div>
				</header>
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
					${cards}
				</div>
			</main>`,
		),
	);
});

/**
 * Serves an R2 object back as an image. Used by the review page.
 * GET /api/scene-grid-img?key=prompt-spike/<runId>/<sceneId>.jpg
 */
app.get('/api/scene-grid-img', async (c) => {
	const key = c.req.query('key');
	if (!key || !key.startsWith('prompt-spike/')) {
		return c.json({ error: 'invalid key' }, 400);
	}
	const obj = await c.env.BUCKET.get(key);
	if (!obj) return c.json({ error: 'not found', key }, 404);
	return new Response(obj.body, {
		headers: {
			'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
			'content-length': String(obj.size),
			'cache-control': 'public, max-age=3600',
		},
	});
});

/**
 * R2 image proxy constrained to safe prefixes: `runs/` (workflow artifacts)
 * and `kiosk/` (selfie uploads from the kiosk capture screen). Used by the
 * workflow status page, the digital pickup landing, and the kiosk scene
 * picker preview.
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

	// Optional ?download=1 — force the browser to download instead of preview.
	// Used by the /p/:id digital pickup landing's "Download" button. We pick
	// a friendly filename based on the last path segment of the R2 key so the
	// user gets `postcard.jpg` instead of a UUID-laden URL.
	if (c.req.query('download')) {
		const tail = key.split('/').pop() ?? 'image';
		headers['content-disposition'] = `attachment; filename="caricature-${tail}"`;
	}

	return new Response(obj.body, { headers });
});

/**
 * Renders the moderation test form.
 * GET /test-moderate
 */
app.get('/test-moderate', (c) => {
	return c.html(
		page(
			'Moderation test — Step 2.4',
			`<main class="min-h-screen flex flex-col items-center px-6 py-12">
				<h1 class="text-3xl font-bold mb-2">Moderation test</h1>
				<p class="text-white/60 mb-8 max-w-xl text-center">
					Upload any image. We'll run it through Llama 3.2 Vision and return a JSON safety verdict.
				</p>
				<form id="mod-form" action="/api/test-moderate" method="post" enctype="multipart/form-data" class="w-full max-w-xl space-y-6 bg-white/5 rounded-2xl p-8 border border-white/10">
					<div>
						<label class="block text-sm font-medium mb-2">Image</label>
						<input id="mod-img" type="file" name="image" accept="image/*" required class="block w-full text-sm text-white/80 file:mr-4 file:rounded-full file:border-0 file:bg-cf-orange file:px-4 file:py-2 file:text-sm file:font-semibold file:text-black hover:file:bg-cf-orange-dark" />
					</div>
					<button id="mod-submit" type="submit" class="w-full rounded-full bg-cf-orange px-6 py-3 text-base font-semibold text-black hover:bg-cf-orange-dark transition disabled:cursor-not-allowed disabled:opacity-60 inline-flex items-center justify-center gap-2">
						<span data-label="idle">Run moderation</span>
						<span data-label="loading" class="hidden items-center gap-2">
							<svg class="size-5 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
								<path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
							</svg>
							<span>Checking…</span>
						</span>
					</button>
				</form>
				<a href="/" class="mt-8 text-sm text-white/60 hover:text-white">← back home</a>
				<script>
					(function () {
						const form = document.getElementById("mod-form");
						const button = document.getElementById("mod-submit");
						const idle = button.querySelector('[data-label="idle"]');
						const loading = button.querySelector('[data-label="loading"]');
						function setLoading(on) {
							button.disabled = on;
							form.style.pointerEvents = on ? "none" : "";
							form.style.opacity = on ? "0.85" : "";
							idle.classList.toggle("hidden", on);
							loading.classList.toggle("hidden", !on);
							loading.classList.toggle("inline-flex", on);
						}
						form.addEventListener("submit", function () { setLoading(true); });
						window.addEventListener("pageshow", function (e) { if (e.persisted) setLoading(false); });
					})();
				</script>
			</main>`,
		),
	);
});

/**
 * Runs llama-3.2-11b-vision-instruct on an uploaded image and returns a safety verdict.
 * POST /api/test-moderate  (multipart: image=file)
 */
app.post('/api/test-moderate', async (c) => {
	let inForm: FormData;
	try {
		inForm = await c.req.formData();
	} catch (err) {
		return c.json({ error: "expected multipart/form-data with 'image'", details: String(err) }, 400);
	}
	const image = inForm.get('image');
	if (!(image instanceof File) || image.size === 0) {
		return c.json({ error: 'missing image file' }, 400);
	}

	const buf = await image.arrayBuffer();
	const bytes = new Uint8Array(buf);

	try {
		const verdict = await moderateImage(c.env.AI, bytes);
		return c.json(
			{
				ok: true,
				image: { name: image.name, type: image.type, size: bytes.byteLength },
				verdict,
			},
			verdict.safe ? 200 : 200, // always 200; the verdict carries the signal
		);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

/**
 * Renders the watermark test form.
 * GET /test-watermark
 */
app.get('/test-watermark', (c) => {
	return c.html(
		page(
			'Watermark test — Step 3.1',
			`<main class="min-h-screen flex flex-col items-center px-6 py-12">
				<h1 class="text-3xl font-bold mb-2">Watermark composition</h1>
				<p class="text-white/60 mb-8 max-w-xl text-center">
					Upload any image. We'll overlay the "I 🧡 NY" watermark in the bottom-right corner
					using the Cloudflare Images binding and return the composited JPEG.
				</p>
				<form id="wm-form" action="/api/test-watermark" method="post" enctype="multipart/form-data" class="w-full max-w-xl space-y-6 bg-white/5 rounded-2xl p-8 border border-white/10">
					<div>
						<label class="block text-sm font-medium mb-2">Base image</label>
						<input id="wm-img" type="file" name="image" accept="image/*" required class="block w-full text-sm text-white/80 file:mr-4 file:rounded-full file:border-0 file:bg-cf-orange file:px-4 file:py-2 file:text-sm file:font-semibold file:text-black hover:file:bg-cf-orange-dark" />
					</div>
					<button id="wm-submit" type="submit" class="w-full rounded-full bg-cf-orange px-6 py-3 text-base font-semibold text-black hover:bg-cf-orange-dark transition disabled:cursor-not-allowed disabled:opacity-60 inline-flex items-center justify-center gap-2">
						<span data-label="idle">Apply watermark</span>
						<span data-label="loading" class="hidden items-center gap-2">
							<svg class="size-5 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
								<path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
							</svg>
							<span>Compositing…</span>
						</span>
					</button>
				</form>
				<div class="mt-8">
					<p class="text-xs text-white/40 mb-2">Current watermark asset:</p>
					<img src="/watermark.png" alt="watermark" class="max-w-md rounded bg-white/5 p-4" />
				</div>
				<a href="/" class="mt-8 text-sm text-white/60 hover:text-white">← back home</a>
				<script>
					(function () {
						const form = document.getElementById("wm-form");
						const button = document.getElementById("wm-submit");
						const idle = button.querySelector('[data-label="idle"]');
						const loading = button.querySelector('[data-label="loading"]');
						function setLoading(on) {
							button.disabled = on;
							form.style.pointerEvents = on ? "none" : "";
							form.style.opacity = on ? "0.85" : "";
							idle.classList.toggle("hidden", on);
							loading.classList.toggle("hidden", !on);
							loading.classList.toggle("inline-flex", on);
						}
						form.addEventListener("submit", function () { setLoading(true); });
						window.addEventListener("pageshow", function (e) { if (e.persisted) setLoading(false); });
					})();
				</script>
			</main>`,
		),
	);
});

/**
 * Composites the watermark onto an uploaded image using Cloudflare Images binding.
 * Output is a JPEG with the watermark in the bottom-right corner.
 * POST /api/test-watermark  (multipart: image=file)
 */
app.post('/api/test-watermark', async (c) => {
	let inForm: FormData;
	try {
		inForm = await c.req.formData();
	} catch (err) {
		return c.json({ error: "expected multipart/form-data with 'image'", details: String(err) }, 400);
	}
	const image = inForm.get('image');
	if (!(image instanceof File) || image.size === 0) {
		return c.json({ error: 'missing image file' }, 400);
	}

	// Fetch watermark from our static assets binding
	const wmReq = new Request('http://internal/watermark.png');
	const wmResp = await c.env.ASSETS.fetch(wmReq);
	if (!wmResp.ok || !wmResp.body) {
		return c.json({ error: 'watermark asset not available' }, 500);
	}

	const started = Date.now();
	try {
		const baseStream = image.stream();
		const wmStream = wmResp.body;

		// Watermark width ≈ 40% of postcard width (the brand mark is wide because the
		// Cloudflare logo is a long horizontal cloud — see public/watermark.png).
		const result = await c.env.IMAGES.input(baseStream)
			.draw(c.env.IMAGES.input(wmStream).transform({ width: 400 }), { bottom: 32, right: 32, opacity: 0.95 })
			.output({ format: 'image/jpeg' });

		const response = result.response();
		const elapsedMs = Date.now() - started;
		response.headers.set('x-elapsed-ms', String(elapsedMs));
		return response;
	} catch (err) {
		return c.json({ error: 'watermark composition failed', details: String(err) }, 500);
	}
});

/**
 * Renders the postcard test form.
 * GET /test-postcard
 */
app.get('/test-postcard', (c) => {
	return c.html(
		page(
			'Postcard format — Step 3.3',
			`<main class="min-h-screen flex flex-col items-center px-6 py-12">
				<h1 class="text-3xl font-bold mb-2">Postcard format</h1>
				<p class="text-white/60 mb-8 max-w-xl text-center">
					Upload any image. We'll fit it to a 4×6 landscape postcard at 300 DPI
					(1800×1200), composite the "I 🧡 NY" watermark in the bottom-right,
					and (optionally) add a QR code in the bottom-left.
				</p>
				<form id="pc-form" action="/api/test-postcard" method="post" enctype="multipart/form-data" class="w-full max-w-xl space-y-6 bg-white/5 rounded-2xl p-8 border border-white/10">
					<div>
						<label class="block text-sm font-medium mb-2">Base image (typically a caricature)</label>
						<input id="pc-img" type="file" name="image" accept="image/*" required class="block w-full text-sm text-white/80 file:mr-4 file:rounded-full file:border-0 file:bg-cf-orange file:px-4 file:py-2 file:text-sm file:font-semibold file:text-black hover:file:bg-cf-orange-dark" />
					</div>
					<label class="flex items-center gap-3 cursor-pointer">
						<input type="checkbox" name="include_qr" checked class="size-5 rounded border-white/30 bg-black/40 accent-cf-orange" />
						<span class="text-sm">Include QR code (links to <code>/p/&lt;id&gt;</code>)</span>
					</label>
					<button id="pc-submit" type="submit" class="w-full rounded-full bg-cf-orange px-6 py-3 text-base font-semibold text-black hover:bg-cf-orange-dark transition disabled:cursor-not-allowed disabled:opacity-60 inline-flex items-center justify-center gap-2">
						<span data-label="idle">Build postcard</span>
						<span data-label="loading" class="hidden items-center gap-2">
							<svg class="size-5 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
								<path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
							</svg>
							<span>Compositing…</span>
						</span>
					</button>
					<p class="text-xs text-white/40">Output: 1800×1200 JPEG. Square inputs get cropped top/bottom to fit landscape. Check the response headers for the postcard ID + URL.</p>
				</form>
				<a href="/" class="mt-8 text-sm text-white/60 hover:text-white">← back home</a>
				<script>
					(function () {
						const form = document.getElementById("pc-form");
						const button = document.getElementById("pc-submit");
						const idle = button.querySelector('[data-label="idle"]');
						const loading = button.querySelector('[data-label="loading"]');
						function setLoading(on) {
							button.disabled = on;
							form.style.pointerEvents = on ? "none" : "";
							form.style.opacity = on ? "0.85" : "";
							idle.classList.toggle("hidden", on);
							loading.classList.toggle("hidden", !on);
							loading.classList.toggle("inline-flex", on);
						}
						form.addEventListener("submit", function () { setLoading(true); });
						window.addEventListener("pageshow", function (e) { if (e.persisted) setLoading(false); });
					})();
				</script>
			</main>`,
		),
	);
});

/**
 * Builds a print-ready 1800x1200 (4x6 @ 300 DPI) JPEG postcard from an uploaded image.
 * Includes watermark composition.
 * POST /api/test-postcard  (multipart: image=file)
 */
app.post('/api/test-postcard', async (c) => {
	let inForm: FormData;
	try {
		inForm = await c.req.formData();
	} catch (err) {
		return c.json({ error: "expected multipart/form-data with 'image'", details: String(err) }, 400);
	}
	const image = inForm.get('image');
	if (!(image instanceof File) || image.size === 0) {
		return c.json({ error: 'missing image file' }, 400);
	}

	const includeQr = inForm.get('include_qr') === 'on';
	const postcardId = includeQr ? newPostcardId() : undefined;
	const qrUrl = postcardId ? `${new URL(c.req.url).origin}/p/${postcardId}` : undefined;

	const started = Date.now();
	try {
		const response = await buildPostcard(c.env, image.stream(), { qrUrl });
		const elapsedMs = Date.now() - started;
		response.headers.set('x-elapsed-ms', String(elapsedMs));
		response.headers.set('x-postcard-dimensions', `${POSTCARD_W}x${POSTCARD_H}`);
		if (postcardId) {
			response.headers.set('x-postcard-id', postcardId);
			response.headers.set('x-postcard-url', qrUrl!);
		}
		return response;
	} catch (err) {
		return c.json({ error: 'postcard build failed', details: String(err) }, 500);
	}
});

/**
 * Renders the branded "postcard not found" page with a 404 status. Shared
 * by every /p/* path that can't resolve a real postcard — unknown UUIDs,
 * malformed IDs, missing path segments, etc.
 *
 * The `id` is rendered as a short hex preview but not echoed verbatim into
 * the HTML beyond `.slice(0, 8)` so we don't reflect arbitrary input.
 */
function brandedPostcardNotFound(c: Context<any>, id?: string, emptyEmoji = '🎨') {
	const idPreview = id ? id.slice(0, 8) : '';
	const previewHtml = idPreview
		? `<p class="text-white/60 mb-2">No session matches <code class="text-cf-orange">${idPreview}…</code></p>`
		: `<p class="text-white/60 mb-2">No postcard at this address.</p>`;

	c.status(404);
	return c.html(
		page(
			'Postcard not found',
			`<main class="min-h-screen flex flex-col items-center justify-center px-6 py-12">
				<div class="text-center max-w-xl">
					<div class="text-6xl mb-6">${emptyEmoji}</div>
					<h1 class="text-3xl font-bold mb-3">We couldn't find that postcard</h1>
					${previewHtml}
					<p class="text-white/50 text-sm">
						If you just scanned a QR from a printed postcard, double-check the link.
						Sessions older than the event window may have been cleaned up.
					</p>
					<a href="/" class="mt-10 inline-block rounded-full bg-cf-orange px-6 py-3 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">
						See what we built
					</a>
				</div>
			</main>`,
		),
	);
}

/**
 * Digital-pickup landing page for a postcard.
 * GET /p/:id
 *
 * Three flavours of `id`:
 *   1. UUID — a real workflow session. We query D1 for scene_name +
 *      postcard_key + completed_at + status and render a full landing
 *      with the postcard, metadata, "Download" and "Share" actions, and
 *      a placeholder slot for the Phase 9.2 email opt-in form.
 *   2. Short slug — a legacy `/test-postcard` dev postcard. Doesn't have
 *      a D1 row; we render a minimal "you scanned a test postcard" page.
 *   3. Anything else — render the branded 404 instead of falling through
 *      to Hono's default. Truncated UUIDs, typos and copy-paste mistakes
 *      all land here. A separate `/p/*` fallback (registered below) catches
 *      paths that don't match this single-segment route at all (`/p`,
 *      `/p/a/b`, etc.).
 *
 * Public — UUIDs are unguessable enough for an event activation, and
 * /api/run-img is already public for `runs/` keys. No auth gate.
 */
eventApp.get('/p/:id', async (c) => {
	const { event } = c.get('eventCtx');
	const basePath = c.get('basePath');
	const id = c.req.param('id');
	const isShortSlug = /^[a-z2-9]{6,16}$/.test(id);
	const isUuid = UUID_RE.test(id);

	const origin = new URL(c.req.url).origin;
	const pickupUrl = `${origin}${basePath}/p/${id}`;

	// ---- Malformed id — branded 404 ----
	if (!isShortSlug && !isUuid) {
		return brandedPostcardNotFound(c, id);
	}

	// ---- Legacy short slug (older sample postcards). Not a real session. ----
	if (isShortSlug) {
		return c.html(
			page(
				`Postcard — ${id}`,
				`<main class="min-h-screen flex flex-col items-center justify-center px-6 py-12">
					<div class="text-center max-w-2xl">
						<img src="/cloudflare-logo.png" alt="" class="mx-auto h-16 w-auto mb-6 drop-shadow-[0_0_24px_rgba(246,130,31,0.5)]" />
						<h1 class="text-3xl font-bold mb-2">This postcard isn't available</h1>
						<p class="text-white/60 mb-8">Postcard ID: <code class="text-cf-orange">${id}</code></p>
						<p class="text-white/60">
							This QR doesn't point to an active postcard. If you just took a photo
							at the booth, double-check the QR on your printed postcard or ask a
							staff member for help.
						</p>
						<a href="${basePath}/" class="mt-10 inline-block rounded-full bg-cf-orange px-6 py-3 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">
							See what we built
						</a>
					</div>
				</main>`,
			),
		);
	}

	// ---- UUID: look up the session in D1 ----
	const row = await c.env.DB.prepare(
		`SELECT id, status, scene_name, postcard_key, completed_at, email, error_msg
		 FROM sessions
		 WHERE id = ?`,
	)
		.bind(id)
		.first<{
			id: string;
			status: string | null;
			scene_name: string | null;
			postcard_key: string | null;
			completed_at: number | null;
			email: string | null;
			error_msg: string | null;
		}>();

	// ---- Not found in D1 ----
	if (!row) {
		return brandedPostcardNotFound(c, id);
	}

	// ---- Still in progress (workflow hasn't reached `store` yet) ----
	if (row.status !== 'completed' || !row.postcard_key) {
		const isErrored = row.status === 'errored';
		const isModerationReject = isErrored && row.error_msg?.includes('moderation rejected');
		const stateLabel = isModerationReject
			? 'Your photo didn\u2019t pass our content check'
			: isErrored
				? 'Something went wrong with this postcard'
				: 'Your postcard is still being generated\u2026';
		const helpCopy = isModerationReject
			? 'Head back to the booth and try again with a different selfie.'
			: isErrored
				? 'Head back to the booth and the staff will help you start a new one.'
				: 'Hang tight \u2014 this page will refresh automatically. The whole pipeline usually finishes in under a minute.';

		// Track retries via a query param so we can cap auto-refresh at
		// ~60s (12 tries * 5s each) instead of polling forever. After the
		// cap we switch to a manual "Refresh" button.
		const retryParam = c.req.query('_retry');
		const retryCount = retryParam ? parseInt(retryParam, 10) || 0 : 0;
		const MAX_RETRIES = 12;
		const shouldAutoRefresh = !isErrored && retryCount < MAX_RETRIES;
		const nextRetryUrl = `${basePath}/p/${id}?_retry=${retryCount + 1}`;

		const timedOutCopy =
			retryCount >= MAX_RETRIES && !isErrored
				? `<p class="text-white/50 text-sm mt-4">It's taking longer than usual. Your postcard may still be processing.</p>
			   <a href="${basePath}/p/${id}" class="mt-4 inline-flex items-center justify-center rounded-full bg-cf-orange px-6 py-3 text-sm font-bold text-black hover:bg-cf-orange-dark transition">Refresh</a>`
				: '';

		return c.html(
			page(
				'Your postcard \u2014 preparing\u2026',
				`<main class="min-h-screen flex flex-col items-center justify-center px-6 py-12">
					<div class="text-center max-w-xl">
						${
							isErrored
								? `<div class="mx-auto mb-6 size-16 rounded-full border-2 border-red-400/30 bg-red-500/10 flex items-center justify-center text-2xl" aria-hidden="true">\u26a0\ufe0f</div>`
								: `<div class="mx-auto mb-6 size-16 rounded-full border-2 border-cf-orange/40 border-t-cf-orange animate-spin"></div>`
						}
						<h1 class="text-3xl font-bold mb-3">${stateLabel}</h1>
						<p class="text-white/60">${helpCopy}</p>
						${timedOutCopy}
						<p class="text-white/40 text-xs mt-6">session ${id.slice(0, 8)}\u2026</p>
					</div>
				</main>
				${shouldAutoRefresh ? `<script>setTimeout(function(){ window.location.href = ${JSON.stringify(nextRetryUrl)}; }, 5000);</script>` : ''}`,
			),
		);
	}

	// ---- Happy path: completed session with a postcard ----
	const sceneName = row.scene_name ?? 'Scene';
	const postcardKey = row.postcard_key;
	const postcardSrc = `/api/run-img?key=${encodeURIComponent(postcardKey)}`;
	const downloadSrc = `/api/run-img?key=${encodeURIComponent(postcardKey)}&download=1`;

	// Format completed_at as a human-readable date (UTC ok — this is a souvenir,
	// timezone precision isn't critical and avoids a libraries-free pitfall).
	const completedLabel = row.completed_at
		? new Date(row.completed_at * 1000).toLocaleString('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
				hour: 'numeric',
				minute: '2-digit',
				timeZone: event.timezone,
				timeZoneName: 'short',
			})
		: 'Just now';

	return c.html(
		page(
			`Your postcard — ${sceneName}`,
			`<header class="absolute top-0 left-0 right-0 px-6 sm:px-8 py-6 flex items-center justify-between z-10">
				<a href="${basePath}/" class="flex items-center gap-2 text-sm uppercase tracking-widest text-white/60 hover:text-white transition">
					<img src="/cloudflare-logo.png" alt="" class="h-5 w-5" />
					<span>Cloudflare &middot; ${escapeAttr(event.name)}</span>
				</a>
			</header>

			<main class="min-h-screen flex flex-col items-center px-4 sm:px-6 pt-24 pb-16">
				<div class="w-full max-w-3xl">
					<!-- Heading -->
					<div class="text-center mb-8">
						<p class="text-xs uppercase tracking-[0.25em] text-cf-orange mb-3">Your digital copy</p>
						<h1 class="text-4xl sm:text-5xl font-black tracking-tight mb-3">${sceneName}</h1>
						<p class="text-white/50 text-sm">
							Generated ${completedLabel} &middot; session ${id.slice(0, 8)}…
						</p>
					</div>

					<!-- Postcard -->
					<figure class="mb-8">
						<img src="${postcardSrc}" alt="Your ${sceneName} postcard"
							class="w-full rounded-2xl border border-white/10 bg-black/40 shadow-[0_0_60px_rgba(246,130,31,0.25)]" />
					</figure>

					<!-- Action row -->
					<div class="flex flex-col sm:flex-row gap-3 justify-center mb-12">
						<a href="${downloadSrc}" download
							class="inline-flex items-center justify-center gap-2 rounded-full bg-cf-orange px-8 py-4 text-base font-bold text-black shadow-[0_0_30px_rgba(246,130,31,0.4)] hover:bg-cf-orange-dark active:scale-[0.98] transition">
							<svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
							</svg>
							Download
						</a>
						<button id="share-btn" type="button"
							class="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-8 py-4 text-base font-semibold text-white hover:bg-white/10 active:scale-[0.98] transition">
							<svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
							</svg>
							<span id="share-label">Share link</span>
						</button>
					</div>

					<!-- Email opt-in form -->
					<section id="email-slot"
						class="rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
						${
							row.email
								? `<!-- Already submitted -->
								<div class="flex flex-col items-center gap-2 text-center">
									<div class="flex items-center gap-2 text-cf-orange text-sm font-medium">
										<svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
											<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
										</svg>
										<span>Email saved</span>
									</div>
									<p class="text-white/50 text-sm">
										We'll send your postcard to <span class="text-white/80 font-medium">${row.email}</span> once email delivery is wired up.
									</p>
								</div>`
								: `<!-- Email form -->
								<div class="text-center mb-4">
									<h2 class="text-lg font-semibold text-white/90 mb-1">Get a digital copy emailed to you</h2>
									<p class="text-sm text-white/50">We'll send your high-res postcard — no spam, just the one email.</p>
								</div>
								<form id="email-form" class="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto">
									<input id="email-input" type="email" name="email" required
										placeholder="you@example.com"
										autocomplete="email" autocapitalize="none" inputmode="email"
										class="flex-1 rounded-full bg-white/10 border border-white/15 px-5 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-cf-orange focus:ring-1 focus:ring-cf-orange/50" />
									<button id="email-submit" type="submit"
										class="inline-flex items-center justify-center gap-2 rounded-full bg-cf-orange px-6 py-3 text-sm font-bold text-black hover:bg-cf-orange-dark active:scale-[0.98] transition whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed">
										<span data-label="idle">Send me a copy</span>
										<span data-label="loading" class="hidden items-center gap-2">
											<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
												<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.3" stroke-width="3" />
												<path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
											</svg>
											<span>Saving…</span>
										</span>
										<span data-label="done" class="hidden items-center gap-2">
											<span>✓ Saved</span>
										</span>
									</button>
								</form>
								<p id="email-error" class="hidden text-sm text-red-400 text-center mt-2"></p>
								<p id="email-success" class="hidden text-sm text-cf-orange text-center mt-3"></p>`
						}
					</section>

					<!-- Footer -->
					<footer class="mt-12 flex flex-col items-center gap-2">
						<div class="flex items-center gap-2 text-xs text-white/40">
							<span>Built end-to-end on</span>
							<img src="/cloudflare-logo.png" alt="Cloudflare" class="h-3.5 w-auto opacity-80" />
							<span>Cloudflare</span>
						</div>
						<a href="${basePath}/privacy" class="text-[11px] uppercase tracking-[0.2em] text-white/30 underline underline-offset-2 hover:text-white/50">Privacy</a>
					</footer>
				</div>
			</main>

			<script>
			(function () {
				var basePath = ${JSON.stringify(basePath)};
				// ---- Share button ----
				var btn = document.getElementById("share-btn");
				var label = document.getElementById("share-label");
				if (btn && label) {
					var url = ${JSON.stringify(pickupUrl)};
					var title = ${JSON.stringify(`My ${sceneName} caricature postcard`)};

					btn.addEventListener("click", function () {
						if (navigator.share) {
							navigator.share({ title: title, url: url }).catch(function () {});
							return;
						}
						if (navigator.clipboard && navigator.clipboard.writeText) {
							navigator.clipboard.writeText(url).then(function () {
								var prev = label.textContent;
								label.textContent = "Copied!";
								setTimeout(function () { label.textContent = prev; }, 1800);
							}).catch(function () {
								label.textContent = "Press \u2318+C to copy";
							});
						}
					});
				}

				// ---- Email opt-in form ----
				var emailForm = document.getElementById("email-form");
				if (emailForm) {
					var emailInput = document.getElementById("email-input");
					var emailBtn   = document.getElementById("email-submit");
					var emailError = document.getElementById("email-error");
					var emailOk    = document.getElementById("email-success");
					var sessionId  = ${JSON.stringify(id)};

					function setEmailState(state) {
						var labels = emailBtn.querySelectorAll("[data-label]");
						labels.forEach(function (el) {
							var match = el.getAttribute("data-label") === state;
							el.classList.toggle("hidden", !match);
							el.classList.toggle("inline-flex", match);
						});
					}

					emailForm.addEventListener("submit", async function (e) {
						e.preventDefault();
						var email = (emailInput.value || "").trim().toLowerCase();
						if (!email) return;

						emailError.classList.add("hidden");
						emailOk.classList.add("hidden");
						emailBtn.disabled = true;
						emailInput.disabled = true;
						setEmailState("loading");

						try {
							var res = await fetch(basePath + "/api/p/" + encodeURIComponent(sessionId) + "/email", {
								method: "POST",
								headers: { "content-type": "application/json" },
								body: JSON.stringify({ email: email }),
							});
							var data = await res.json().catch(function () { return {}; });
							if (!res.ok || !data.ok) {
								throw new Error(data.error || "request failed (" + res.status + ")");
							}
							setEmailState("done");
							emailOk.textContent = "We'll send your postcard to " + email;
							emailOk.classList.remove("hidden");
							// Keep input disabled — they submitted successfully.
						} catch (err) {
							console.warn("email submit failed:", err);
							setEmailState("idle");
							emailBtn.disabled = false;
							emailInput.disabled = false;
							emailError.textContent = err.message || "Something went wrong. Try again.";
							emailError.classList.remove("hidden");
						}
					});
				}
			})();
			</script>`,
		),
	);
});

/**
 * Saves the attendee's email for a completed session so a digital copy
 * can be emailed later (step 9.3). Validates the session exists + is
 * completed and the email looks reasonable (no full RFC 5322 — just
 * "something@something.something").
 *
 * Idempotent: re-submitting overwrites the email (attendees may typo
 * their address and resubmit).
 *
 * POST /api/p/:id/email  body: { email }
 */
eventApp.post('/api/p/:id/email', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) {
		return c.json({ error: 'invalid session id' }, 400);
	}

	let body: { email?: unknown };
	try {
		body = await c.req.json();
	} catch (err) {
		return c.json({ error: 'expected JSON body { email }', details: String(err) }, 400);
	}

	const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	// Minimal email validation — we're not going to RFC-5322 this, but
	// we do want to catch obvious garbage before it hits D1.
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return c.json({ error: 'invalid email address' }, 400);
	}
	if (email.length > 320) {
		return c.json({ error: 'email address too long' }, 400);
	}

	// Verify the session is completed. No point in storing email for a
	// session that never produced a postcard.
	const session = await c.env.DB.prepare('SELECT id, status, postcard_key, scene_name FROM sessions WHERE id = ?')
		.bind(id)
		.first<{ id: string; status: string | null; postcard_key: string | null; scene_name: string | null }>();

	if (!session) {
		return c.json({ error: 'session not found' }, 404);
	}
	if (session.status !== 'completed' || !session.postcard_key) {
		return c.json({ error: 'session is not completed' }, 409);
	}

	await c.env.DB.prepare('UPDATE sessions SET email = ?, email_submitted_at = unixepoch() WHERE id = ?').bind(email, id).run();

	console.log(`[email-optin] session=${id} email=${email.slice(0, 3)}***`);
	trackEvent(c.env.ANALYTICS, 'email.captured', id);

	// Fire-and-forget: send the postcard email. Don't fail the opt-in if
	// the email fails — the address is already persisted in D1 and can be
	// retried from the admin dashboard (Phase 10).
	const origin = new URL(c.req.url).origin;
	const postcardKey = session.postcard_key;
	const sceneName = session.scene_name ?? 'Scene';
	c.executionCtx.waitUntil(
		sendPostcardEmail(c.env, {
			to: email,
			sessionId: id,
			sceneName,
			pickupUrl: `${origin}/p/${id}`,
			postcardImageUrl: `${origin}/api/run-img?key=${encodeURIComponent(postcardKey)}`,
			downloadUrl: `${origin}/api/run-img?key=${encodeURIComponent(postcardKey)}&download=1`,
		}).catch((err) => {
			console.error(`[email-optin] send failed session=${id} err=${err}`);
		}),
	);

	return c.json({ ok: true, email });
});

/**
 * Branded 404 fallbacks for paths that don't match `/p/:id` exactly:
 *   - `/p`           — no postcard id at all
 *   - `/p/`          — same, with trailing slash
 *   - `/p/foo/bar`   — extra path segments after the id
 * Without these, Hono falls back to its default text/plain 404, which
 * defeats the whole point of friendly error pages here. The branded 404
 * is harmless on any path under /p/ — it doesn't echo arbitrary input.
 */
eventApp.get('/p', (c) => brandedPostcardNotFound(c));
eventApp.get('/p/:id/*', (c) => brandedPostcardNotFound(c, c.req.param('id')));

/**
 * Test endpoint: generate an image with Workers AI (FLUX.2 klein 4B).
 * GET /api/test-ai?prompt=...
 * Returns image/png directly so you can preview in browser.
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
 * Returns the list of available NYC scenes from KV.
 * GET /api/scenes
 */
app.get('/api/scenes', async (c) => {
	const raw = await c.env.CONFIG.get('scenes');
	if (!raw) return c.json({ error: 'scenes not configured' }, 500);

	try {
		const scenes = JSON.parse(raw);
		return c.json({ count: scenes.length, scenes });
	} catch (err) {
		return c.json({ error: 'invalid scenes JSON', details: String(err) }, 500);
	}
});

/**
 * Test endpoint: insert a row into D1 and read recent rows back.
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

	return c.json({
		ok: true,
		inserted,
		recent: recent.results,
	});
});

/**
 * Test endpoint: uploads a hardcoded tiny PNG to R2.
 * GET /api/test-upload
 */
app.get('/api/test-upload', async (c) => {
	// 1x1 transparent PNG, base64 encoded
	const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
	const bytes = Uint8Array.from(atob(tinyPngBase64), (ch) => ch.charCodeAt(0));

	const key = `test/${Date.now()}-tiny.png`;
	await c.env.BUCKET.put(key, bytes, {
		httpMetadata: { contentType: 'image/png' },
	});

	return c.json({ ok: true, key, size: bytes.byteLength });
});

/**
 * Test endpoint: lists the most recent R2 objects (for verification).
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
 * Test endpoint: fetches a specific object back from R2 by key.
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

// ---------------------------------------------------------------------------
// Root: event index listing active events
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
	const events = await listEvents(c.env);
	const activeEvents = events.filter((e) => e.status === 'active');

	if (activeEvents.length === 1) {
		// Single active event — redirect straight to it
		return c.redirect(`/e/${activeEvents[0].id}`, 302);
	}

	const cards =
		activeEvents.length === 0
			? `<p class="text-white/60 text-center py-12">No active events right now.</p>`
			: activeEvents
					.map(
						(
							e,
						) => `<a href="/e/${escapeAttr(e.id)}" class="block rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/30 transition p-6">
			<div class="text-xl font-bold">${escapeAttr(e.name)}</div>
			<p class="mt-2 text-sm text-white/60">${escapeAttr(e.tagline)}</p>
		</a>`,
					)
					.join('\n');

	return c.html(
		page(
			'AI Caricature Booth',
			`<main class="max-w-2xl mx-auto px-6 py-16">
				<h1 class="text-4xl font-bold text-center mb-2">AI Caricature Booth</h1>
				<p class="text-center text-white/60 mb-12">Pick an event to get started.</p>
				<div class="flex flex-col gap-4">${cards}</div>
				<footer class="mt-16 text-center text-[11px] uppercase tracking-[0.25em] text-white/30">
					Built end-to-end on Cloudflare
				</footer>
			</main>`,
		),
	);
});

// ---------------------------------------------------------------------------
// Mount event sub-app and legacy redirects
// ---------------------------------------------------------------------------

app.route('/e/:eventId', eventApp);

export default app;
