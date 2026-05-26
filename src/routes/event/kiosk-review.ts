import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';
import { kioskPage } from '../../lib/html';

const app = new Hono<EventEnv>();

/**
 * Review / confirmation screen (step 3 of 3) before triggering the workflow.
 * GET /kiosk/review
 */
app.get('/kiosk/review', async (c) => {
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
				if (!raw) { window.location.replace(basePath + "/kiosk/capture"); return; }
				let data;
				try {
					data = JSON.parse(raw);
					if (!data || !data.sessionId || !data.selfieKey) throw new Error("incomplete payload");
				} catch (err) {
					sessionStorage.removeItem("kiosk:selfie");
					window.location.replace(basePath + "/kiosk/capture");
					return;
				}
				if (!data.sceneId) { window.location.replace(basePath + "/kiosk/scene"); return; }

				selfieEl.src = "/api/run-img?key=" + encodeURIComponent(data.selfieKey);
				nameEl.textContent = data.sceneName || data.sceneId;
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

export { app as kioskReviewRoutes };
