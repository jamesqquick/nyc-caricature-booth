import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';
import { kioskPage } from '../../lib/html';
import { UUID_RE } from '../../lib/helpers';

const app = new Hono<EventEnv>();

/**
 * Done screen — shows postcard image, QR code, print CTA, 60s countdown.
 * GET /kiosk/done?session=<sid>
 */
app.get('/kiosk/done', (c) => {
	const basePath = c.get('basePath');
	const sessionFromQs = c.req.query('session');
	const sessionId = sessionFromQs && UUID_RE.test(sessionFromQs) ? sessionFromQs : null;

	const pickupUrl = sessionId ? `${new URL(c.req.url).origin}${basePath}/p/${sessionId}` : null;
	const qrSrc = pickupUrl ? `${basePath}/api/kiosk/qr?url=${encodeURIComponent(pickupUrl)}` : null;

	return c.html(
		kioskPage(
			'Your postcard is ready',
			`<main id="done-root" class="min-h-[100dvh] w-full flex flex-col" style="touch-action:manipulation;">
				<header class="shrink-0 px-6 pt-4 sm:pt-6 pb-2 flex items-center justify-end">
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

					<figure class="w-full max-w-2xl flex-1 min-h-0 flex flex-col justify-center">
						<img id="done-postcard" alt="your postcard"
							class="w-full max-h-full object-contain rounded-2xl border border-white/10 bg-black/40 shadow-[0_0_60px_rgba(246,130,31,0.25)]" />
						<figcaption id="done-meta" class="mt-1.5 text-center text-xs text-white/40"></figcaption>
					</figure>

					<div class="flex flex-col sm:flex-row items-center gap-3 max-w-lg w-full">
						<button id="done-print"
							class="flex-1 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-cf-orange px-8 py-4 text-base font-bold text-black shadow-[0_0_30px_rgba(246,130,31,0.4)] hover:bg-cf-orange-dark active:scale-[0.98] transition whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-100">
							<span data-label="idle" class="inline-flex items-center gap-2"><span aria-hidden="true">🖨️</span><span>Print my postcard</span></span>
							<span data-label="loading" class="hidden items-center gap-2"><svg class="size-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.3" stroke-width="3" /><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg><span>Sending to printer…</span></span>
							<span data-label="queued" class="hidden items-center gap-2"><svg class="size-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.3" stroke-width="3" /><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg><span>Queued — waiting for printer…</span></span>
							<span data-label="printed" class="hidden items-center gap-2"><span aria-hidden="true">✓</span><span>Printed — pick up at the counter!</span></span>
							<span data-label="failed" class="hidden items-center gap-2"><span aria-hidden="true">⚠️</span><span>Print failed — please ask staff</span></span>
						</button>

						<button id="done-restart"
							class="w-full sm:w-auto inline-flex items-center justify-center rounded-full border border-white/25 bg-white/5 px-6 py-4 text-base font-semibold text-white/90 hover:bg-white/10 active:scale-[0.98] transition whitespace-nowrap">
							Start over
						</button>
					</div>

					<p id="done-print-error" class="hidden text-sm text-red-400 text-center max-w-lg"></p>

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
				const sessionId  = ${JSON.stringify(sessionId)};
				const IDLE_SECS  = 60;

				let payload = null;
				try {
					const raw = sessionStorage.getItem("kiosk:done");
					if (raw) payload = JSON.parse(raw);
				} catch (err) { console.warn("bad kiosk:done payload:", err); }

				const resolvedSid = sessionId
					|| (payload && /^[a-f0-9-]{36}$/.test(payload.sessionId) ? payload.sessionId : null);

				var postcardRetries = 0;
				postcardEl.addEventListener("error", function () {
					postcardRetries++;
					if (postcardRetries <= 2) {
						setTimeout(function () { postcardEl.src = postcardEl.src.split("&_r=")[0] + "&_r=" + postcardRetries; }, 1500);
						return;
					}
					postcardEl.classList.add("hidden");
					var figure = postcardEl.closest("figure");
					if (figure) {
						figure.innerHTML = '<div class="w-full aspect-[3/2] rounded-2xl border border-white/10 bg-white/[0.03] flex flex-col items-center justify-center text-center px-6">'
							+ '<div class="text-4xl mb-3" aria-hidden="true">\ud83d\uddbc\ufe0f</div>'
							+ '<p class="text-lg font-semibold text-white/80">Your postcard is being prepared</p>'
							+ '<p class="mt-2 text-sm text-white/50">The image is not loading right now.</p>'
							+ (resolvedSid ? '<a href="' + basePath + '/p/' + resolvedSid + '" class="mt-4 text-sm text-cf-orange underline underline-offset-4 hover:text-white">View your digital copy \u2192</a>' : '')
							+ '</div>';
					}
				});

				if (payload && payload.postcardKey) {
					postcardEl.src = basePath + "/api/run-img?key=" + encodeURIComponent(payload.postcardKey);
					const scenePart = payload.sceneName || payload.sceneId || "";
					metaEl.textContent = scenePart ? scenePart + " · " + (resolvedSid || "").slice(0, 8) + "…" : "";
				} else if (resolvedSid) {
					postcardEl.src = basePath + "/api/run-img?key=" + encodeURIComponent("runs/" + resolvedSid + "/postcard.jpg");
					metaEl.textContent = "session " + resolvedSid.slice(0, 8) + "…";
				} else {
					postcardEl.classList.add("hidden");
					metaEl.textContent = "No postcard found — please start over.";
				}

				var printPollTimer = null;

				function setPrintState(state) {
					var labels = printBtn.querySelectorAll("[data-label]");
					labels.forEach(function (el) {
						var match = el.getAttribute("data-label") === state;
						el.classList.toggle("hidden", !match);
						el.classList.toggle("inline-flex", match);
					});
				}

				function showPrintError(msg) { printError.textContent = msg; printError.classList.remove("hidden"); }
				function clearPrintError() { printError.classList.add("hidden"); printError.textContent = ""; }
				function stopPrintPoll() { if (printPollTimer) { clearInterval(printPollTimer); printPollTimer = null; } }

				function startPrintPoll(jobId) {
					stopPrintPoll();
					printPollTimer = setInterval(async function () {
						try {
							var res = await fetch(basePath + "/api/kiosk/print/" + encodeURIComponent(jobId) + "/status");
							if (!res.ok) return;
							var data = await res.json().catch(function () { return {}; });
							if (data.status === "printed") {
								stopPrintPoll(); setPrintState("printed");
								printBtn.classList.remove("hover:bg-cf-orange-dark"); printBtn.classList.add("cursor-default");
							} else if (data.status === "failed") {
								stopPrintPoll(); setPrintState("failed"); printBtn.disabled = true;
								showPrintError("The printer couldn't complete your postcard. A staff member can reprint it from the admin dashboard.");
							}
						} catch (e) {}
					}, 2000);
				}

				if (!resolvedSid) { printBtn.disabled = true; printBtn.classList.add("opacity-50"); }

				printBtn.addEventListener("click", async function () {
					if (printBtn.disabled || !resolvedSid) return;
					clearPrintError(); printBtn.disabled = true; setPrintState("loading");
					try {
						var minDelay = new Promise(function (r) { setTimeout(r, 800); });
						var request = fetch(basePath + "/api/kiosk/print", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ sessionId: resolvedSid }),
						});
						var results = await Promise.all([request, minDelay]);
						var res = results[0];
						var data = await res.json().catch(function () { return {}; });
						if (!res.ok || !data.ok) throw new Error(data.error || "request failed (" + res.status + ")");
						if (data.status === "printed") {
							setPrintState("printed"); printBtn.classList.remove("hover:bg-cf-orange-dark"); printBtn.classList.add("cursor-default");
							return;
						}
						setPrintState("queued");
						if (data.jobId) startPrintPoll(data.jobId);
					} catch (err) {
						console.warn("print enqueue failed:", err); setPrintState("idle"); printBtn.disabled = false;
						showPrintError("Couldn't queue the print. Tap again, or ask a staff member.");
					}
				});

				let remaining = IDLE_SECS;

				function resetCountdown() { remaining = IDLE_SECS; secsEl.textContent = String(remaining); }

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
					if (remaining <= 0) { clearInterval(tick); returnToIdle(); }
				}, 1000);

				restartBtn.addEventListener("click", function () { clearInterval(tick); returnToIdle(); });
			})();
			</script>`,
		),
	);
});

export { app as kioskDoneRoutes };
