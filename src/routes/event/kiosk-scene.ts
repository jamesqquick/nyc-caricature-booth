import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';
import { kioskPage, escapeAttr } from '../../lib/html';

const app = new Hono<EventEnv>();

/**
 * Scene picker grid (step 2 of 3). Server-renders scenes from the event context.
 * GET /kiosk/scene
 */
app.get('/kiosk/scene', async (c) => {
	const eventCtx = c.get('eventCtx');
	const basePath = c.get('basePath');
	const scenes = eventCtx.scenes;

	if (!scenes || scenes.length === 0) {
		return c.html(
			kioskPage(
				'Pick a scene',
				`<main class="min-h-[100dvh] w-full flex flex-col items-center justify-center px-8 text-center">
					<div class="text-2xl font-semibold text-red-300">Scenes unavailable</div>
					<p class="mt-3 text-sm text-white/60 max-w-md">No active scenes found for this event.</p>
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

export { app as kioskSceneRoutes };
