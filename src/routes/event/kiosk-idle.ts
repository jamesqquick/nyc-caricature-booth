import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';
import { kioskPage, escapeAttr } from '../../lib/html';

const app = new Hono<EventEnv>();

/**
 * Idle / landing screen. Shown to passersby when no one is using the booth.
 * GET /kiosk
 */
app.get('/kiosk', async (c) => {
	const { event } = c.get('eventCtx');
	const basePath = c.get('basePath');
	const origin = new URL(c.req.url).origin;
	const eventUrl = `${origin}${basePath}/`;
	const qrSrc = `${basePath}/api/kiosk/qr?url=${encodeURIComponent(eventUrl)}`;
	return c.html(
		kioskPage(
			`${event.name} — Tap to start`,
			`			<div class="flex justify-center pt-4 sm:fixed sm:top-4 sm:left-4 sm:z-50 sm:pt-0 sm:block">
				<img src="${qrSrc}" alt="QR code — scan to open this page"
					class="w-20 sm:w-24 rounded-xl border border-white/10 bg-white p-1.5" />
			</div>
			<main class="h-full w-full flex flex-col pt-4 sm:pt-10">
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

export { app as kioskIdleRoutes };
