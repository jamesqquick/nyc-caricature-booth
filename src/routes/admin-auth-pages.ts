import { Hono } from 'hono';
import { adminAuthMiddleware, clearAdminCookie, setAdminCookie, signAdminToken } from '../lib/admin-auth';
import { page, escapeAttr } from '../lib/html';

const app = new Hono<{ Bindings: Env }>();

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

	const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/admin';

	if (submitted !== password) {
		return c.redirect(`/admin/login?err=1&next=${encodeURIComponent(safeNext)}`, 302);
	}

	const token = await signAdminToken(password);
	setAdminCookie(c, token);
	return c.redirect(safeNext, 303);
});

/** Logout — clear the cookie and bounce to the login screen. */
app.get('/admin/logout', (c) => {
	clearAdminCookie(c);
	return c.redirect('/admin/login', 302);
});

export { app as adminAuthPages };
