import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';
import { page, escapeAttr } from '../../lib/html';

const app = new Hono<EventEnv>();

/**
 * Event landing / marketing page.
 * GET / (mounted on eventApp, so resolves to /e/:eventId/)
 */
app.get('/', async (c) => {
	const { event } = c.get('eventCtx');
	const basePath = c.get('basePath');
	const origin = new URL(c.req.url).origin;
	const eventUrl = `${origin}${basePath}/`;
	const qrSrc = `${basePath}/api/kiosk/qr?url=${encodeURIComponent(eventUrl)}`;
	return c.html(
		page(
			`${event.name} — AI Caricature Booth`,
			`			<div class="flex justify-center pt-4 sm:fixed sm:top-4 sm:left-4 sm:z-50 sm:pt-0 sm:block">
				<img src="${qrSrc}" alt="QR code — scan to open this page"
					class="w-20 sm:w-24 rounded-xl border border-white/10 bg-white p-1.5" />
			</div>
			<main class="px-6 sm:px-8 pb-20">
				<!-- Hero -->
				<section class="max-w-4xl mx-auto pt-6 sm:pt-20 flex flex-col items-center text-center">
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

export { app as eventLandingRoutes };
