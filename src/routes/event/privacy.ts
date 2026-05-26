import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';
import { page, escapeAttr } from '../../lib/html';

const app = new Hono<EventEnv>();

/** Privacy / ToS micro-page. GET /privacy */
app.get('/privacy', async (c) => {
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

export { app as privacyRoutes };
