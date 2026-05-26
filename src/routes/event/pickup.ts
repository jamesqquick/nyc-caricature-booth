import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';
import { page, escapeAttr } from '../../lib/html';
import { brandedPostcardNotFound, UUID_RE } from '../../lib/helpers';


const app = new Hono<EventEnv>();

/**
 * Digital pickup landing page for a postcard.
 * GET /p/:id
 */
app.get('/p/:id', async (c) => {
	const { event } = c.get('eventCtx');
	const basePath = c.get('basePath');
	const id = c.req.param('id');
	const isShortSlug = /^[a-z2-9]{6,16}$/.test(id);
	const isUuid = UUID_RE.test(id);

	const origin = new URL(c.req.url).origin;
	const pickupUrl = `${origin}${basePath}/p/${id}`;

	if (!isShortSlug && !isUuid) {
		return brandedPostcardNotFound(c, id);
	}

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

	const row = await c.env.DB.prepare(
		`SELECT id, status, scene_name, postcard_key, completed_at, email, error_msg FROM sessions WHERE id = ?`,
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

	if (!row) {
		return brandedPostcardNotFound(c, id);
	}

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

	const sceneName = row.scene_name ?? 'Scene';
	const postcardKey = row.postcard_key;
	const postcardSrc = `${basePath}/api/run-img?key=${encodeURIComponent(postcardKey)}`;
	const downloadSrc = `${basePath}/api/run-img?key=${encodeURIComponent(postcardKey)}&download=1`;

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
					<div class="text-center mb-8">
						<p class="text-xs uppercase tracking-[0.25em] text-cf-orange mb-3">Your digital copy</p>
						<h1 class="text-4xl sm:text-5xl font-black tracking-tight mb-3">${sceneName}</h1>
						<p class="text-white/50 text-sm">
							Generated ${completedLabel} &middot; session ${id.slice(0, 8)}…
						</p>
					</div>

					<figure class="mb-8">
						<img src="${postcardSrc}" alt="Your ${sceneName} postcard"
							class="w-full rounded-2xl border border-white/10 bg-black/40 shadow-[0_0_60px_rgba(246,130,31,0.25)]" />
					</figure>

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
				var btn = document.getElementById("share-btn");
				var label = document.getElementById("share-label");
				if (btn && label) {
					var url = ${JSON.stringify(pickupUrl)};
					var title = ${JSON.stringify(`My ${sceneName} caricature postcard`)};
					btn.addEventListener("click", function () {
						if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () {}); return; }
						if (navigator.clipboard && navigator.clipboard.writeText) {
							navigator.clipboard.writeText(url).then(function () {
								var prev = label.textContent;
								label.textContent = "Copied!";
								setTimeout(function () { label.textContent = prev; }, 1800);
							}).catch(function () { label.textContent = "Press \u2318+C to copy"; });
						}
					});
				}

			})();
			</script>`,
		),
	);
});

/** Branded 404 fallbacks for bare /p and extra path segments. */
app.get('/p', (c) => brandedPostcardNotFound(c));
app.get('/p/:id/*', (c) => brandedPostcardNotFound(c, c.req.param('id')));

export { app as pickupRoutes };
