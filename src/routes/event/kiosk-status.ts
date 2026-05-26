import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';
import { kioskPage } from '../../lib/html';
import { UUID_RE } from '../../lib/helpers';

const app = new Hono<EventEnv>();

/**
 * Live status stepper — subscribes via WebSocket to the SessionDO and walks
 * through queued → moderating → generating → compositing → done.
 * GET /kiosk/status/:instanceId?session=<sid>
 */
app.get('/kiosk/status/:instanceId', async (c) => {
	const basePath = c.get('basePath');
	const instanceId = c.req.param('instanceId');
	if (!UUID_RE.test(instanceId)) return c.notFound();
	const sessionFromQs = c.req.query('session');
	const sessionId = sessionFromQs && UUID_RE.test(sessionFromQs) ? sessionFromQs : null;

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

				<section id="status-working" class="flex-1 min-h-0 flex flex-col items-center justify-center px-6 sm:px-8 gap-8">
					<div class="text-center max-w-md">
						<h1 id="status-headline" class="text-[clamp(1.75rem,5vw,2.5rem)] font-bold leading-tight">Making your postcard</h1>
						<p id="status-subhead" class="mt-3 text-sm sm:text-base text-white/60"></p>
					</div>

					<ol id="status-steps" class="w-full max-w-md flex flex-col gap-3 sm:gap-4">
						${[
							{ key: 'check', label: 'Checking your photo' },
							{ key: 'paint', label: 'Painting your caricature' },
							{ key: 'frame', label: 'Adding the postcard frame' },
							{ key: 'ready', label: 'Your postcard is ready' },
						]
							.map(
								(s) => `<li data-step="${s.key}" class="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5 sm:py-4 transition">
									<span class="step-marker shrink-0 mt-0.5 size-7 rounded-full border border-white/15 flex items-center justify-center text-xs text-white/40">·</span>
									<div class="min-w-0 flex-1">
										<div class="step-label text-base sm:text-lg font-semibold leading-tight text-white/50">${s.label}</div>
									</div>
								</li>`,
							)
							.join('\n')}
					</ol>
				</section>

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

				const STATUS_TO_STEP_INDEX = { queued: 0, moderating: 0, generating: 1, compositing: 2, done: 3 };
				const STATUS_TO_HEADLINE = { queued: "Getting started", moderating: "Checking your photo", generating: "Painting your caricature", compositing: "Adding the postcard frame", done: "Your postcard is ready" };
				const STATUS_TO_SUBHEAD = { queued: "", moderating: "Making sure your photo is good to go.", generating: "", compositing: "Watermark + QR code coming together.", done: "Hold on while we hand it off…" };

				function applyStepper(activeIdx) {
					const items = stepsRoot.querySelectorAll("li[data-step]");
					items.forEach(function (li, idx) {
						const marker = li.querySelector(".step-marker");
						const label = li.querySelector(".step-label");
						marker.classList.remove("bg-emerald-500", "border-emerald-500", "text-black", "bg-cf-orange/20", "border-cf-orange", "text-cf-orange", "animate-pulse", "border-white/15", "text-white/40");
						if (idx < activeIdx) {
							marker.classList.add("bg-emerald-500", "border-emerald-500", "text-black");
							marker.textContent = "✓";
							label.classList.remove("text-white/50", "text-white"); label.classList.add("text-white/80");
						} else if (idx === activeIdx) {
							marker.classList.add("bg-cf-orange/20", "border-cf-orange", "text-cf-orange", "animate-pulse");
							marker.textContent = "●";
							label.classList.remove("text-white/50", "text-white/80"); label.classList.add("text-white");
						} else {
							marker.classList.add("border-white/15", "text-white/40");
							marker.textContent = "·";
							label.classList.remove("text-white", "text-white/80"); label.classList.add("text-white/50");
						}
					});
				}

				let didRedirect = false;
				let lastState = null;

				function handleDone(state) {
					if (didRedirect) return;
					didRedirect = true;
					const sid = sessionId || state.sessionId;
					try {
						sessionStorage.setItem("kiosk:done", JSON.stringify({
							sessionId: sid, sceneId: state.sceneId, sceneName: state.sceneName,
							selfieKey: state.selfieKey, caricatureKey: state.caricatureKey,
							postcardKey: state.postcardKey, postcardUrl: state.postcardUrl, finishedAt: Date.now(),
						}));
					} catch (err) { console.warn("could not stash done payload:", err); }
					applyStepper(STATUS_TO_STEP_INDEX.done);
					headlineEl.textContent = STATUS_TO_HEADLINE.done;
					subheadEl.textContent = STATUS_TO_SUBHEAD.done;
					setTimeout(function () { window.location.href = basePath + "/kiosk/done?session=" + encodeURIComponent(sid); }, 500);
				}

				function handleErrored(state) {
					workingSection.classList.add("hidden");
					erroredSection.classList.remove("hidden");
					erroredSection.classList.add("flex");
					const raw = (state && state.error) ? String(state.error) : "";
					if (raw.indexOf("moderation rejected") !== -1) {
						errMsgEl.textContent = "Your photo didn't pass our content check. Please try again with a different selfie.";
					} else {
						errMsgEl.textContent = "We couldn't finish your postcard. Please try again.";
					}
					if (raw) console.warn("[kiosk-status] error detail:", raw);
				}

				function applyState(state) {
					if (!state) return;
					lastState = state;
					if (state.status === "done") { handleDone(state); return; }
					if (state.status === "errored") { handleErrored(state); return; }
					const idx = STATUS_TO_STEP_INDEX[state.status];
					if (typeof idx !== "number") return;
					applyStepper(idx);
					if (STATUS_TO_HEADLINE[state.status]) headlineEl.textContent = STATUS_TO_HEADLINE[state.status];
					if (STATUS_TO_SUBHEAD[state.status]) subheadEl.textContent = STATUS_TO_SUBHEAD[state.status];
				}

				retryBtn.addEventListener("click", function () {
					try { sessionStorage.removeItem("kiosk:selfie"); } catch (e) {}
					try { sessionStorage.removeItem("kiosk:done"); } catch (e) {}
					window.location.href = basePath + "/kiosk";
				});

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
						everConnected = true; connectedAt = Date.now(); backoff = 500;
						setConn("live", "bg-emerald-500", false);
					});
					ws.addEventListener("message", function (e) {
						if (e.data === "pong") return;
						let msg;
						try { msg = JSON.parse(e.data); } catch (err) { console.error("bad ws frame:", e.data, err); return; }
						if (msg && msg.type === "state") applyState(msg.state);
						else if (msg && msg.type === "deleted") {
							if (!didRedirect && (!lastState || lastState.status !== "done")) {
								handleErrored({ error: "session expired before postcard finished" });
							}
						}
					});
					ws.addEventListener("close", function () {
						const sinceOpen = Date.now() - connectedAt;
						if (!everConnected || sinceOpen > DISCONNECT_GRACE_MS) setConn("reconnecting…", "bg-yellow-400", true);
						if (didRedirect) return;
						setTimeout(connect, backoff);
						backoff = Math.min(backoff * 2, 10000);
					});
					ws.addEventListener("error", function (err) { console.error("ws error:", err); });
				}

				connect();
			})();
			</script>`,
		),
	);
});

export { app as kioskStatusRoutes };
