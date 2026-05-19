import { Hono, type Context } from "hono";

import { moderateImage } from "./lib/moderation";
import { runFlux } from "./lib/flux";
import { loadScenes, type Scene } from "./lib/scenes";
import {
	POSTCARD_H,
	POSTCARD_W,
	buildPostcard,
	newPostcardId,
	qrPng,
} from "./lib/postcard";

export { CaricatureWorkflow } from "./workflows/caricature";
export { SessionDO } from "./session/session";

const app = new Hono<{ Bindings: Env }>();

// Postcard composition (constants, qrPng, encodePng, buildPostcard,
// newPostcardId) lives in src/lib/postcard.ts so the workflow's composite
// step can share it.

// Moderation helpers are now in src/lib/moderation.ts (shared with workflows).

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${title}</title>
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<link rel="stylesheet" href="/app.css" />
		<link rel="icon" href="/cloudflare-logo.png" />
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
		<link rel="icon" href="/cloudflare-logo.png" />
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

app.get("/", (c) => {
	return c.html(
		page(
			"I 🧡 NY — Cloudflare NY Tech Week",
			`<header class="absolute top-0 left-0 right-0 px-8 py-6 flex items-center justify-between">
				<div class="flex items-center gap-2 text-sm uppercase tracking-widest text-white/60">
					<img src="/cloudflare-logo.png" alt="" class="h-5 w-5" />
					<span>Cloudflare &middot; NY Tech Week 2026</span>
				</div>
				<a href="/api/health" class="text-xs text-white/40 hover:text-white/80 transition">/api/health</a>
			</header>
			<main class="min-h-screen flex flex-col items-center justify-center px-6">
				<div class="flex items-center gap-6 text-7xl md:text-9xl font-black leading-none">
					<span>I</span>
					<img src="/cloudflare-logo.png" alt="Cloudflare" class="h-20 md:h-28 w-auto drop-shadow-[0_0_24px_rgba(246,130,31,0.5)]" />
					<span>NY</span>
				</div>
				<p class="mt-8 max-w-xl text-center text-lg text-white/70">
					AI caricature postcard booth. Take a selfie, pick an iconic NYC scene, walk away with a postcard.
				</p>
				<div class="mt-12 inline-flex items-center gap-2 rounded-full border border-cf-orange/40 bg-cf-orange/10 px-4 py-2 text-sm text-cf-orange">
					<span class="size-2 rounded-full bg-cf-orange animate-pulse"></span>
					Phase 6 complete &middot; Full kiosk flow live
				</div>
				<div class="mt-6 flex flex-col items-center gap-2">
					<a href="/kiosk" class="text-sm text-cf-orange hover:text-white underline underline-offset-4 transition">
						📱 Kiosk: idle → capture → scene → review → live status → done (6.6) →
					</a>
					<a href="/test-workflow-moderate" class="text-xs text-white/60 hover:text-white underline underline-offset-4 transition">
						⚡ Full pipeline + live Session DO (step 5.4)
					</a>
					<a href="/test-session" class="text-xs text-white/60 hover:text-white underline underline-offset-4 transition">
						🪪 Session DO playground (no workflow)
					</a>
					<a href="/api/test-workflow" target="_blank" rel="noopener" class="text-xs text-white/60 hover:text-white underline underline-offset-4 transition">
						⚙️ Trigger bare workflow (no input)
					</a>
					<a href="/test-postcard" class="text-xs text-white/60 hover:text-white underline underline-offset-4 transition">
						📮 4×6 postcard format with QR
					</a>
					<a href="/test-watermark" class="text-xs text-white/60 hover:text-white underline underline-offset-4 transition">
						🏷️ Watermark overlay only
					</a>
					<a href="/test-moderate" class="text-xs text-white/60 hover:text-white underline underline-offset-4 transition">
						🛡️ Content moderation
					</a>
					<a href="/test-scene-grid" class="text-xs text-white/60 hover:text-white underline underline-offset-4 transition">
						🎬 Generate all 6 scenes from one selfie
					</a>
					<a href="/test-i2i" class="text-xs text-white/60 hover:text-white underline underline-offset-4 transition">
						🪄 Single-scene caricature test
					</a>
					<a href="/api/test-ai" target="_blank" rel="noopener" class="text-xs text-white/40 hover:text-white/80 transition">
						(or just the text-to-image test)
					</a>
				</div>
			</main>`,
		),
	);
});

app.get("/api/health", (c) => {
	return c.json({ status: "ok", step: "8.6" });
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
app.post("/api/kiosk/selfie", async (c) => {
	let inForm: FormData;
	try {
		inForm = await c.req.formData();
	} catch (err) {
		return c.json(
			{ error: "expected multipart/form-data with 'selfie'", details: String(err) },
			400,
		);
	}
	const selfie = inForm.get("selfie");
	if (!(selfie instanceof File) || selfie.size === 0) {
		return c.json({ error: "missing selfie file" }, 400);
	}

	const sessionId = crypto.randomUUID();
	// Always JPEG: the kiosk client encodes via canvas.toBlob("image/jpeg").
	const selfieKey = `kiosk/${sessionId}/selfie.jpg`;

	const buf = await selfie.arrayBuffer();
	await c.env.BUCKET.put(selfieKey, buf, {
		httpMetadata: { contentType: selfie.type || "image/jpeg" },
		customMetadata: {
			sessionId,
			source: "kiosk",
			capturedAt: new Date().toISOString(),
		},
	});

	return c.json({
		ok: true,
		sessionId,
		selfieKey,
		size: buf.byteLength,
		contentType: selfie.type || "image/jpeg",
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
app.post("/api/kiosk/start", async (c) => {
	let body: { sessionId?: unknown; selfieKey?: unknown; sceneId?: unknown };
	try {
		body = await c.req.json();
	} catch (err) {
		return c.json(
			{ error: "expected JSON body { sessionId, selfieKey, sceneId }", details: String(err) },
			400,
		);
	}

	const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
	const selfieKey = typeof body.selfieKey === "string" ? body.selfieKey : "";
	const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";

	if (!UUID_RE.test(sessionId)) {
		return c.json({ error: "invalid sessionId" }, 400);
	}
	// Lock the selfieKey shape down so a client can't point the workflow
	// at an arbitrary R2 object (e.g. workflow-test/<other>/selfie.jpg).
	const expectedPrefix = `kiosk/${sessionId}/`;
	if (!selfieKey.startsWith(expectedPrefix)) {
		return c.json(
			{ error: `selfieKey must start with ${expectedPrefix}`, got: selfieKey },
			400,
		);
	}
	if (!sceneId) {
		return c.json({ error: "missing sceneId" }, 400);
	}

	// Validate sceneId against KV.
	let scenes: Scene[];
	try {
		scenes = await loadScenes(c.env);
	} catch (err) {
		return c.json({ error: "scenes unavailable", details: String(err) }, 500);
	}
	if (!scenes.some((s) => s.id === sceneId)) {
		return c.json({ error: `unknown sceneId: ${sceneId}` }, 400);
	}

	// Validate the selfie actually exists in R2. head() is cheap and
	// catches stale sessionStorage from before an R2 lifecycle sweep.
	const head = await c.env.BUCKET.head(selfieKey);
	if (!head) {
		return c.json({ error: `selfie not found in R2: ${selfieKey}` }, 404);
	}

	const publicOrigin = new URL(c.req.url).origin;
	const instance = await c.env.CARICATURE_WORKFLOW.create({
		params: {
			sessionId,
			selfieKey,
			sceneId,
			publicOrigin,
			note: "kiosk",
		},
	});

	const statusUrl = `/kiosk/status/${instance.id}?session=${sessionId}`;
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
app.post("/api/kiosk/print", async (c) => {
	let body: { sessionId?: unknown };
	try {
		body = await c.req.json();
	} catch (err) {
		return c.json({ error: "expected JSON body { sessionId }", details: String(err) }, 400);
	}

	const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
	if (!UUID_RE.test(sessionId)) {
		return c.json({ error: "invalid sessionId" }, 400);
	}

	// The session must be completed and have a postcard before we can print.
	const session = await c.env.DB.prepare(
		"SELECT id, status, postcard_key, scene_name FROM sessions WHERE id = ?",
	)
		.bind(sessionId)
		.first<{ id: string; status: string | null; postcard_key: string | null; scene_name: string | null }>();

	if (!session) {
		return c.json({ error: "session not found" }, 404);
	}
	if (session.status !== "completed" || !session.postcard_key) {
		return c.json(
			{ error: "session is not ready to print", status: session.status },
			409,
		);
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
		console.log(
			`[kiosk-print] session=${sessionId} already queued jobId=${existing.id} status=${existing.status}`,
		);
		return c.json({
			ok: true,
			alreadyQueued: true,
			jobId: existing.id,
			status: existing.status,
		});
	}

	const origin = new URL(c.req.url).origin;
	const postcardUrl = `${origin}/p/${sessionId}`;
	const sceneName = session.scene_name ?? "NYC scene";

	const insertResult = await c.env.DB.prepare(
		`INSERT INTO print_jobs (session_id, postcard_key, postcard_url, scene_name)
		 VALUES (?, ?, ?, ?)
		 RETURNING id`,
	)
		.bind(sessionId, session.postcard_key, postcardUrl, sceneName)
		.first<{ id: string }>();

	if (!insertResult) {
		return c.json({ error: "failed to enqueue print job" }, 500);
	}

	console.log(
		`[kiosk-print] session=${sessionId} jobId=${insertResult.id} queued sceneName=${sceneName}`,
	);

	return c.json({
		ok: true,
		alreadyQueued: false,
		jobId: insertResult.id,
		status: "pending",
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
app.get("/api/kiosk/print/:jobId/status", async (c) => {
	const jobId = c.req.param("jobId");
	if (!jobId) return c.json({ error: "missing jobId" }, 400);

	const row = await c.env.DB.prepare(
		"SELECT status, printed_at, error_msg FROM print_jobs WHERE id = ?",
	)
		.bind(jobId)
		.first<{ status: string; printed_at: number | null; error_msg: string | null }>();

	if (!row) return c.json({ error: "job not found" }, 404);

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
app.get("/api/kiosk/qr", (c) => {
	const raw = c.req.query("url");
	if (!raw) return c.json({ error: "missing url param" }, 400);

	let target: string;
	try {
		target = decodeURIComponent(raw);
	} catch {
		return c.json({ error: "invalid url encoding" }, 400);
	}

	// Only allow URLs that start with our own origin so this isn't an
	// open proxy for arbitrary QR codes.
	const workerOrigin = new URL(c.req.url).origin;
	if (!target.startsWith(workerOrigin + "/") && target !== workerOrigin) {
		return c.json({ error: "url must be on this origin" }, 403);
	}

	const png = qrPng(target, 400);
	return new Response(png, {
		headers: {
			"content-type": "image/png",
			// QR contents are deterministic; cache aggressively on CDN.
			"cache-control": "public, max-age=31536000, immutable",
		},
	});
});

/**
 * Idle / landing screen. This is what passersby see when no one is using
 * the booth. Big visual, one obvious action.
 * GET /kiosk
 */
app.get("/kiosk", (c) => {
	return c.html(
		kioskPage(
			"I 🧡 NY — Tap to start",
			`<main class="h-full w-full flex flex-col">
				<header class="px-8 pt-10 pb-4 flex items-center gap-3 text-white/70">
					<img src="/cloudflare-logo.png" alt="" class="h-6 w-6" />
					<span class="text-xs uppercase tracking-[0.25em]">Cloudflare · NY Tech Week 2026</span>
				</header>

				<section class="flex-1 flex flex-col items-center justify-center px-8 text-center">
					<div class="flex items-center gap-4 text-[clamp(4rem,18vw,11rem)] font-bold leading-none">
						<span>I</span>
						<img src="/cloudflare-logo.png" alt="Cloudflare"
							class="h-[0.85em] w-auto drop-shadow-[0_0_40px_rgba(246,130,31,0.55)]" />
						<span>NY</span>
					</div>

					<h1 class="mt-10 text-[clamp(2rem,6vw,3.5rem)] font-bold leading-tight text-balance">
						AI Caricature Booth
					</h1>
					<p class="mt-4 max-w-md text-lg text-white/70 text-balance">
						Take a selfie, pick an iconic NYC scene, walk away with a printed postcard.
						Built end-to-end on Cloudflare.
					</p>

					<a href="/kiosk/capture"
						class="mt-16 inline-flex items-center justify-center rounded-full bg-cf-orange px-16 py-7 text-2xl font-bold text-black shadow-[0_0_60px_rgba(246,130,31,0.45)] hover:bg-cf-orange-dark active:scale-[0.98] transition">
						Tap to start
					</a>
					<p class="mt-6 text-xs uppercase tracking-[0.3em] text-white/40">
						Takes about 30 seconds
					</p>
				</section>

				<footer class="px-8 pb-10 text-center text-[11px] uppercase tracking-[0.25em] text-white/30">
					Photos processed on-device · No data stored after the event
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
app.get("/kiosk/capture", (c) => {
	return c.html(
		kioskPage(
			"Capture your selfie",
			`<main id="capture-root" class="min-h-[100dvh] h-[100dvh] w-full flex flex-col">
				<header class="shrink-0 px-6 pt-4 sm:pt-8 pb-2 flex items-center justify-between">
					<a href="/kiosk" class="text-sm text-white/50 hover:text-white">← Cancel</a>
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
				</footer>
			</main>

			<script>
			(function () {
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
					setOverlay('<div class="text-xl font-semibold">Starting camera…</div><p class="mt-2 text-sm text-white/60">If you see a permissions prompt, tap Allow.</p>');
					if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
						setOverlay('<div class="text-xl font-semibold text-red-300">This browser can\\'t access the camera.</div><p class="mt-2 text-sm text-white/60">Try Safari on iPad or Chrome on desktop.</p>');
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
							'<div class="text-xl font-semibold text-red-300">' +
							(denied ? "Camera access blocked" : "Camera unavailable") +
							'</div><p class="mt-2 text-sm text-white/60">' +
							(denied
								? "Open Settings → Safari → Camera and allow access, then reload."
								: "Make sure no other app is using the camera, then reload.") +
							'</p>'
						);
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
						hint.textContent = "Looks good? Tap 'Use this photo' to continue.";
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
						const r = await fetch("/api/kiosk/selfie", { method: "POST", body: fd });
						const j = await r.json();
						if (!r.ok || !j.ok) throw new Error(j.error || "upload failed");
						sessionStorage.setItem("kiosk:selfie", JSON.stringify({
							sessionId: j.sessionId,
							selfieKey: j.selfieKey,
							size: j.size,
							capturedAt: Date.now(),
						}));
						statusEl.textContent = "✓ Uploaded. Pick a scene next…";
						window.location.href = "/kiosk/scene";
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
app.get("/kiosk/scene", async (c) => {
	let scenes: Scene[];
	try {
		scenes = await loadScenes(c.env);
	} catch (err) {
		console.error("loadScenes failed:", err);
		return c.html(
			kioskPage(
				"Pick a scene",
				`<main class="min-h-[100dvh] w-full flex flex-col items-center justify-center px-8 text-center">
					<div class="text-2xl font-semibold text-red-300">Scenes unavailable</div>
					<p class="mt-3 text-sm text-white/60 max-w-md">${String(err)}</p>
					<a href="/kiosk" class="mt-8 text-sm text-white/60 hover:text-white underline">← Back to start</a>
				</main>`,
			),
			500,
		);
	}

	const cards = scenes
		.map(
			(s, idx) => `<button type="button"
				data-scene-id="${s.id}"
				data-scene-name="${s.name.replace(/"/g, "&quot;")}"
				data-scene-emoji="${s.emoji.replace(/"/g, "&quot;")}"
				class="scene-card group relative flex flex-col items-start text-left rounded-3xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/30 active:scale-[0.98] transition p-4 sm:p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cf-orange disabled:opacity-50 disabled:cursor-not-allowed"
				style="animation-delay: ${idx * 40}ms;">
				<div class="text-4xl sm:text-5xl leading-none mb-2 sm:mb-3" aria-hidden="true">${s.emoji}</div>
				<div class="text-base sm:text-lg font-semibold leading-tight">${s.name}</div>
				<div class="mt-1 text-xs sm:text-sm text-white/60 leading-snug line-clamp-2">${s.description}</div>
			</button>`,
		)
		.join("\n");

	return c.html(
		kioskPage(
			"Pick a scene",
			`<main id="scene-root" class="min-h-[100dvh] w-full flex flex-col">
				<header class="shrink-0 px-6 pt-4 sm:pt-8 pb-2 flex items-center justify-between">
					<a href="/kiosk/capture" class="text-sm text-white/50 hover:text-white">← Retake selfie</a>
					<span class="text-xs uppercase tracking-[0.25em] text-white/40 hidden sm:inline">Step 2 of 3 · Scene</span>
					<span class="w-24"></span>
				</header>

				<section class="flex-1 min-h-0 flex flex-col items-center px-4 sm:px-6 pt-2 pb-4 gap-4 sm:gap-6">
					<div class="text-center max-w-md">
						<h1 class="text-[clamp(1.75rem,5vw,2.5rem)] font-bold leading-tight">Pick your NYC scene</h1>
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
				const grid = document.getElementById("scene-grid");
				const statusEl = document.getElementById("scene-status");

				// Guard: this screen requires a selfie handoff. If sessionStorage
				// is empty the user landed here directly (page refresh, deep link,
				// etc.) — bounce them back to capture.
				const raw = sessionStorage.getItem("kiosk:selfie");
				if (!raw) {
					window.location.replace("/kiosk/capture");
					return;
				}
				let selfie;
				try {
					selfie = JSON.parse(raw);
					if (!selfie || !selfie.sessionId || !selfie.selfieKey) throw new Error("incomplete payload");
				} catch (err) {
					console.error("bad kiosk:selfie payload:", err);
					sessionStorage.removeItem("kiosk:selfie");
					window.location.replace("/kiosk/capture");
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
					window.location.href = "/kiosk/review";
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
app.get("/kiosk/review", (c) => {
	return c.html(
		kioskPage(
			"Review your postcard",
			`<main class="min-h-[100dvh] w-full flex flex-col">
				<header class="shrink-0 px-6 pt-4 sm:pt-8 pb-2 flex items-center justify-between">
					<a href="/kiosk/scene" class="text-sm text-white/50 hover:text-white">← Pick different scene</a>
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
								<div id="rev-scene-emoji" class="text-6xl sm:text-7xl leading-none" aria-hidden="true">🗽</div>
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
				const selfieEl = document.getElementById("rev-selfie");
				const emojiEl = document.getElementById("rev-scene-emoji");
				const nameEl = document.getElementById("rev-scene-name");
				const goBtn = document.getElementById("rev-go");
				const statusEl = document.getElementById("rev-status");

				const raw = sessionStorage.getItem("kiosk:selfie");
				if (!raw) {
					window.location.replace("/kiosk/capture");
					return;
				}
				let data;
				try {
					data = JSON.parse(raw);
					if (!data || !data.sessionId || !data.selfieKey) throw new Error("incomplete payload");
				} catch (err) {
					sessionStorage.removeItem("kiosk:selfie");
					window.location.replace("/kiosk/capture");
					return;
				}
				if (!data.sceneId) {
					window.location.replace("/kiosk/scene");
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
						const r = await fetch("/api/kiosk/start", {
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
app.get("/kiosk/status/:instanceId", (c) => {
	const instanceId = c.req.param("instanceId");
	if (!UUID_RE.test(instanceId)) return c.notFound();
	const sessionFromQs = c.req.query("session");
	const sessionId =
		sessionFromQs && UUID_RE.test(sessionFromQs) ? sessionFromQs : null;

	// Without a sessionId we have nothing to subscribe to. Show a polite
	// error instead of a broken stepper.
	if (!sessionId) {
		return c.html(
			kioskPage(
				"Missing session",
				`<main class="min-h-[100dvh] w-full flex flex-col items-center justify-center px-8 text-center gap-6">
					<div class="text-2xl font-semibold text-red-300">Missing session id</div>
					<p class="text-sm text-white/60 max-w-md">This page can't track a postcard without ?session=&lt;id&gt;.</p>
					<a href="/kiosk" class="inline-flex items-center justify-center rounded-full bg-cf-orange px-10 py-4 text-base font-bold text-black hover:bg-cf-orange-dark transition">Start over</a>
				</main>`,
			),
			400,
		);
	}

	return c.html(
		kioskPage(
			"Making your postcard",
			`<main id="status-root" class="min-h-[100dvh] w-full flex flex-col">
				<header class="shrink-0 px-6 pt-4 sm:pt-8 pb-2 flex items-center justify-between">
					<div class="flex items-center gap-2 text-white/50 text-xs uppercase tracking-[0.25em]">
						<img src="/cloudflare-logo.png" alt="" class="h-4 w-4" />
						<span>I 🧡 NY · Caricature Booth</span>
					</div>
					<div id="status-conn" class="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-white/30">
						<span id="status-conn-dot" class="size-2 rounded-full bg-yellow-400 animate-pulse"></span>
						<span id="status-conn-label">connecting…</span>
					</div>
				</header>

				<!-- Working state: stepper + headline. Replaced wholesale on errored. -->
				<section id="status-working" class="flex-1 min-h-0 flex flex-col items-center justify-center px-6 sm:px-8 gap-8">
					<div class="text-center max-w-md">
						<h1 id="status-headline" class="text-[clamp(1.75rem,5vw,2.5rem)] font-bold leading-tight">Making your postcard</h1>
						<p id="status-subhead" class="mt-3 text-sm sm:text-base text-white/60">Hang tight — this usually takes about 30 seconds.</p>
					</div>

					<!--
						Stepper. Each row has:
						  - a leading marker (spinner / check / dim dot)
						  - the friendly label
						  - an optional hint that only shows on the active row
					-->
					<ol id="status-steps" class="w-full max-w-md flex flex-col gap-3 sm:gap-4">
						${[
							{ key: "check", label: "Checking your photo" },
							{ key: "paint", label: "Painting your caricature", hint: "This is the slow one — about 20 seconds." },
							{ key: "frame", label: "Adding the postcard frame" },
							{ key: "ready", label: "Your postcard is ready" },
						]
							.map(
								(s) => `<li data-step="${s.key}" class="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5 sm:py-4 transition">
									<span class="step-marker shrink-0 mt-0.5 size-7 rounded-full border border-white/15 flex items-center justify-center text-xs text-white/40">·</span>
									<div class="min-w-0 flex-1">
										<div class="step-label text-base sm:text-lg font-semibold leading-tight text-white/50">${s.label}</div>
										${s.hint ? `<div class="step-hint mt-1 text-xs text-white/40 hidden">${s.hint}</div>` : ""}
									</div>
								</li>`,
							)
							.join("\n")}
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
					queued: "Hang tight — this usually takes about 30 seconds.",
					moderating: "Making sure your photo is good to go.",
					generating: "AI is painting your caricature — this is the slow part.",
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
						window.location.href = "/kiosk/done?session=" + encodeURIComponent(sid);
					}, 500);
				}

				function handleErrored(state) {
					workingSection.classList.add("hidden");
					erroredSection.classList.remove("hidden");
					erroredSection.classList.add("flex");
					// Don't surface raw error text on the kiosk; show a friendly
					// line but include a shortened detail for staff.
					const raw = (state && state.error) ? String(state.error) : "";
					const short = raw ? raw.slice(0, 120) : "";
					errMsgEl.textContent = short
						? "We couldn't finish your postcard. (" + short + ")"
						: "We couldn't finish your postcard. Please try again.";
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
					window.location.href = "/kiosk";
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
					const url = proto + "//" + location.host + "/api/session/" + sessionId + "/ws";
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
app.get("/kiosk/done", (c) => {
	const sessionFromQs = c.req.query("session");
	const sessionId =
		sessionFromQs && UUID_RE.test(sessionFromQs) ? sessionFromQs : null;

	// Build the QR src at render time so the <img> tag is ready on first
	// paint. We construct the pickup URL using the same origin as this
	// request — same logic the workflow uses for postcardUrl.
	const pickupUrl = sessionId
		? `${new URL(c.req.url).origin}/p/${sessionId}`
		: null;
	const qrSrc = pickupUrl
		? `/api/kiosk/qr?url=${encodeURIComponent(pickupUrl)}`
		: null;

	return c.html(
		kioskPage(
			"Your postcard is ready",
			`<main id="done-root" class="min-h-[100dvh] w-full flex flex-col" style="touch-action:manipulation;">
				<header class="shrink-0 px-6 pt-4 sm:pt-6 pb-2 flex items-center justify-between">
					<div class="flex items-center gap-2 text-white/50 text-xs uppercase tracking-[0.25em]">
						<img src="/cloudflare-logo.png" alt="" class="h-4 w-4" />
						<span>I 🧡 NY · Caricature Booth</span>
					</div>
					<!-- QR code top-right — always visible for scanning -->
					<div class="flex flex-col items-center gap-1">
						${qrSrc
							? `<img src="${qrSrc}" alt="QR code for digital copy"
									class="w-20 sm:w-24 rounded-xl border border-white/10 bg-white p-1.5" />`
							: `<div class="w-20 sm:w-24 aspect-square rounded-xl border border-white/10 bg-white/5"></div>`}
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
								<span>Print failed — tap to retry</span>
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
							var res = await fetch("/api/kiosk/print/" + encodeURIComponent(jobId) + "/status");
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
								printBtn.disabled = false;
								showPrintError(data.errorMsg || "The printer reported a failure.");
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
						var request = fetch("/api/kiosk/print", {
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
					window.location.href = "/kiosk";
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
 * Client-side JS polls `/api/display/feed` every 30s and diffs by sessionId
 * to avoid full re-renders.
 */
app.get("/display", async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT id, scene_name, postcard_key, completed_at
		 FROM sessions
		 WHERE status = 'completed' AND postcard_key IS NOT NULL
		 ORDER BY completed_at DESC
		 LIMIT 8`,
	).all<{
		id: string;
		scene_name: string | null;
		postcard_key: string;
		completed_at: number | null;
	}>();

	const now = Math.floor(Date.now() / 1000);
	const formatAge = (completedAt: number | null): string => {
		if (!completedAt) return "just now";
		const diff = Math.max(0, now - completedAt);
		if (diff < 60) return "just now";
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		return `${Math.floor(diff / 86400)}d ago`;
	};

	const cards = results
		.map((row) => {
			const sceneName = row.scene_name ?? "Untitled scene";
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
		.join("");

	const empty = `<div class="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] py-24 text-center">
		<div class="text-5xl">🗽</div>
		<p class="mt-4 text-lg text-white/70">No postcards yet — be the first!</p>
		<p class="mt-1 text-sm text-white/40">Walk over to the iPad to get started.</p>
	</div>`;

	return c.html(
		page(
			"I 🧡 NY — Gallery",
			`<div class="display-shimmer fixed inset-0 pointer-events-none" aria-hidden="true"></div>
			<header class="relative px-12 pt-10 pb-8 flex items-center justify-between">
				<div class="text-sm uppercase tracking-widest text-white/60">
					NY Tech Week 2026
				</div>
				<img src="/api/kiosk/qr?url=${encodeURIComponent("https://nyc-caricature-booth.examples.workers.dev")}" alt="QR code — scan to visit" class="h-24 w-24 rounded" />
				<div class="flex items-center gap-4 text-4xl font-black leading-none">
					<span>I</span>
					<img src="/cloudflare-logo.png" alt="Cloudflare" class="display-glow h-10 w-auto" />
					<span>NY</span>
				</div>
			</header>
			<main class="relative px-12 pb-12">
				<div class="mb-8 flex items-end justify-between">
					<div>
						<h1 class="text-5xl md:text-6xl font-black tracking-tight">Fresh from the booth</h1>
						<p class="mt-3 text-lg text-white/60">AI caricature postcards, generated live on Cloudflare.</p>
					</div>
					<a href="/kiosk" class="hidden md:inline-flex items-center gap-2 rounded-full bg-cf-orange px-6 py-3 text-base font-semibold text-black hover:bg-cf-orange-dark transition">
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
						+ '<div class="text-5xl">🗽</div>'
						+ '<p class="mt-4 text-lg text-white/70">No postcards yet — be the first!</p>'
						+ '<p class="mt-1 text-sm text-white/40">Walk over to the iPad to get started.</p>'
						+ '</div>';
				}

				async function poll() {
					try {
						var res = await fetch("/api/display/feed");
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
app.get("/api/display/feed", async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT id, scene_id, scene_name, postcard_key, completed_at
		 FROM sessions
		 WHERE status = 'completed' AND postcard_key IS NOT NULL
		 ORDER BY completed_at DESC
		 LIMIT 8`,
	).all<{
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
 * GET /api/print-agent/jobs?limit=5
 */
app.get("/api/print-agent/jobs", async (c) => {
	const limit = Math.min(Number(c.req.query("limit")) || 5, 20);
	const { results } = await c.env.DB.prepare(
		`SELECT id, session_id, postcard_key, postcard_url, scene_name, created_at
		 FROM print_jobs
		 WHERE status = 'pending'
		 ORDER BY created_at ASC
		 LIMIT ?`,
	)
		.bind(limit)
		.all<{
			id: string;
			session_id: string;
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
app.post("/api/print-agent/jobs/:id/ack", async (c) => {
	const jobId = c.req.param("id");
	const body = await c.req.json<{ status: "printed" | "failed"; error?: string }>();

	if (body.status !== "printed" && body.status !== "failed") {
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
		return c.json({ error: "job not found or already acked" }, 404);
	}

	return c.json({ ok: true, jobId, status: body.status });
});

/**
 * Test endpoint: seed a print job for an existing completed session.
 * GET /api/test-print-job?session=<sessionId>
 * If no session param, picks the most recent completed session.
 */
app.get("/api/test-print-job", async (c) => {
	const sessionId = c.req.query("session");
	const origin = new URL(c.req.url).origin;

	const row = sessionId
		? await c.env.DB.prepare(
				"SELECT id, postcard_key, scene_name FROM sessions WHERE id = ? AND status = 'completed'",
			)
				.bind(sessionId)
				.first<{ id: string; postcard_key: string; scene_name: string }>()
		: await c.env.DB.prepare(
				"SELECT id, postcard_key, scene_name FROM sessions WHERE status = 'completed' AND postcard_key IS NOT NULL ORDER BY completed_at DESC LIMIT 1",
			).first<{ id: string; postcard_key: string; scene_name: string }>();

	if (!row) return c.json({ error: "no completed session found" }, 404);

	await c.env.DB.prepare(
		"INSERT INTO print_jobs (session_id, postcard_key, postcard_url, scene_name) VALUES (?, ?, ?, ?)",
	)
		.bind(row.id, row.postcard_key, `${origin}/p/${row.id}`, row.scene_name)
		.run();

	return c.json({ ok: true, sessionId: row.id, postcardKey: row.postcard_key, sceneName: row.scene_name });
});

/**
 * Triggers a new instance of the (bare) caricature workflow.
 * GET /api/test-workflow?note=...
 */
app.get("/api/test-workflow", async (c) => {
	const note = c.req.query("note") ?? undefined;
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
app.get("/api/test-workflow/:id", async (c) => {
	const id = c.req.param("id");
	try {
		const instance = await c.env.CARICATURE_WORKFLOW.get(id);
		const status = await instance.status();
		return c.json({ ok: true, instanceId: id, status });
	} catch (err) {
		return c.json({ error: "instance not found", details: String(err) }, 404);
	}
});

// ---------------------------------------------------------------------------
// SessionDO test endpoints (step 5.1)
//
// One DO per session, addressed by `idFromName(sessionId)`. These routes are
// thin proxies to the DO's RPC methods so we can verify the binding works
// before wiring the workflow to it in 5.4.
// ---------------------------------------------------------------------------

const UUID_RE =
	/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const VALID_SESSION_STATUSES = [
	"queued",
	"moderating",
	"generating",
	"compositing",
	"done",
	"errored",
] as const;
type SessionStatusName = (typeof VALID_SESSION_STATUSES)[number];

function getSessionStub(env: Env, sessionId: string) {
	const id = env.SESSION.idFromName(sessionId);
	return env.SESSION.get(id);
}

/**
 * Creates a new session DO (random UUID) and seeds it to status=queued.
 * POST /api/test-session
 */
app.post("/api/test-session", async (c) => {
	const sessionId = crypto.randomUUID();
	const stub = getSessionStub(c.env, sessionId);
	const state = await stub.getState(sessionId);
	return c.json({ ok: true, sessionId, state });
});

/**
 * Returns the current state of a session DO.
 * GET /api/test-session/:id
 */
app.get("/api/test-session/:id", async (c) => {
	const id = c.req.param("id");
	if (!UUID_RE.test(id)) return c.json({ error: "invalid session id" }, 400);
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
app.post("/api/test-session/:id/status", async (c) => {
	const id = c.req.param("id");
	if (!UUID_RE.test(id)) return c.json({ error: "invalid session id" }, 400);

	// Accept JSON, form-urlencoded, multipart form-data, or ?status= query
	// param so curl, the HTML form, and fetch(FormData) all work.
	const ct = c.req.header("content-type") ?? "";
	let parsed: Record<string, unknown> = {};
	const qs = c.req.query("status");
	if (qs) parsed.status = qs;

	if (!parsed.status) {
		try {
			if (ct.includes("application/json")) {
				parsed = (await c.req.json()) as Record<string, unknown>;
			} else if (
				ct.includes("application/x-www-form-urlencoded") ||
				ct.includes("multipart/form-data")
			) {
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
					error: "failed to parse body",
					details: String(err),
					contentType: ct,
				},
				400,
			);
		}
	}

	const status = parsed.status;
	if (
		typeof status !== "string" ||
		!VALID_SESSION_STATUSES.includes(status as SessionStatusName)
	) {
		return c.json(
			{ error: "invalid status", validStatuses: VALID_SESSION_STATUSES },
			400,
		);
	}

	const payload = {
		sceneId: typeof parsed.sceneId === "string" ? parsed.sceneId : undefined,
		sceneName:
			typeof parsed.sceneName === "string" ? parsed.sceneName : undefined,
		selfieKey:
			typeof parsed.selfieKey === "string" ? parsed.selfieKey : undefined,
		caricatureKey:
			typeof parsed.caricatureKey === "string"
				? parsed.caricatureKey
				: undefined,
		postcardKey:
			typeof parsed.postcardKey === "string" ? parsed.postcardKey : undefined,
		postcardUrl:
			typeof parsed.postcardUrl === "string" ? parsed.postcardUrl : undefined,
		error: typeof parsed.error === "string" ? parsed.error : undefined,
		elapsedMs:
			typeof parsed.elapsedMs === "string"
				? Number(parsed.elapsedMs)
				: typeof parsed.elapsedMs === "number"
					? parsed.elapsedMs
					: undefined,
	};

	const stub = getSessionStub(c.env, id);
	try {
		const state = await stub.markStep(
			status as SessionStatusName,
			payload,
			id,
		);
		return c.json({ ok: true, sessionId: id, state });
	} catch (err) {
		const msg = String(err);
		// InvalidTransitionError is thrown across RPC as a plain error; match
		// on the message we know the DO produces.
		if (msg.includes("invalid session transition")) {
			return c.json(
				{
					error: msg.replace(/^Error: /, ""),
					hint: "see TRANSITIONS table in src/session/session.ts",
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
app.delete("/api/test-session/:id", async (c) => {
	const id = c.req.param("id");
	if (!UUID_RE.test(id)) return c.json({ error: "invalid session id" }, 400);
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
app.get("/api/session/:id/ws", async (c) => {
	const id = c.req.param("id");
	if (!UUID_RE.test(id)) return c.json({ error: "invalid session id" }, 400);
	if (c.req.header("Upgrade") !== "websocket") {
		return c.json({ error: "expected websocket upgrade" }, 426);
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
app.get("/test-session", (c) => {
	return c.html(
		page(
			"Session DO — Step 5.3",
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

app.get("/test-session/:id", (c) => {
	const id = c.req.param("id");
	if (!UUID_RE.test(id)) return c.notFound();
	const statusOptions = VALID_SESSION_STATUSES.map(
		(s) => `<option value="${s}">${s}</option>`,
	).join("");
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
app.get("/test-workflow-moderate", (c) => {
	return c.html(
		page(
			"Workflow — Step 4.4",
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
							<option value="hot-dog-stand">🌭 Hot Dog Stand</option>
							<option value="subway">🚇 Subway Platform</option>
							<option value="central-park">🌳 Central Park</option>
							<option value="broadway">🎭 Broadway</option>
							<option value="times-square">🌆 Times Square</option>
							<option value="brooklyn-bridge">🌉 Brooklyn Bridge</option>
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
app.post("/api/test-workflow-moderate", async (c) => {
	let inForm: FormData;
	try {
		inForm = await c.req.formData();
	} catch (err) {
		return c.json({ error: "expected multipart/form-data with 'selfie'", details: String(err) }, 400);
	}
	const selfie = inForm.get("selfie");
	if (!(selfie instanceof File) || selfie.size === 0) {
		return c.json({ error: "missing selfie file" }, 400);
	}
	const sceneId = String(inForm.get("scene_id") ?? "hot-dog-stand");

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
	const ext = (selfie.name.match(/\.(jpe?g|png|webp|heic)$/i)?.[1] ?? "jpg").toLowerCase();
	const selfieKey = `workflow-test/${sessionId}/selfie.${ext}`;

	await c.env.BUCKET.put(selfieKey, await selfie.arrayBuffer(), {
		httpMetadata: { contentType: selfie.type || "image/jpeg" },
		customMetadata: {
			sessionId,
			originalName: selfie.name || "(unnamed)",
		},
	});

	const publicOrigin = new URL(c.req.url).origin;
	const instance = await c.env.CARICATURE_WORKFLOW.create({
		params: {
			sessionId,
			selfieKey,
			sceneId,
			publicOrigin,
			note: "step-4.4-full-pipeline-test",
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
app.get("/test-workflow-moderate/:id", (c) => {
	const id = c.req.param("id");
	if (!UUID_RE.test(id)) {
		return c.notFound();
	}
	const sessionFromQs = c.req.query("session");
	const sessionId =
		sessionFromQs && UUID_RE.test(sessionFromQs) ? sessionFromQs : null;

	return c.html(
		page(
			`Workflow ${id.slice(0, 8)}…`,
			`<main class="min-h-screen flex flex-col items-center px-6 py-12 max-w-3xl mx-auto">
				<h1 class="text-3xl font-bold mb-2">Workflow run</h1>
				<p class="text-white/60 text-sm">Instance: <code class="text-white/80">${id}</code></p>
				${
					sessionId
						? `<p class="text-white/60 text-sm mt-1">Session: <code class="text-white/80">${sessionId}</code></p>`
						: ""
				}
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
						: ""
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
app.get("/test-i2i", (c) => {
	return c.html(
		page(
			"Test image-to-image — Step 2.2",
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
							<option value="hot-dog-stand">🌭 Hot Dog Stand</option>
							<option value="subway">🚇 Subway Platform</option>
							<option value="central-park">🌳 Central Park</option>
							<option value="broadway">🎭 Broadway</option>
							<option value="times-square">🌆 Times Square</option>
							<option value="brooklyn-bridge">🌉 Brooklyn Bridge</option>
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
app.post("/api/test-i2i", async (c) => {
	let inForm: FormData;
	try {
		inForm = await c.req.formData();
	} catch (err) {
		return c.json({ error: "expected multipart/form-data with 'selfie'", details: String(err) }, 400);
	}
	const selfie = inForm.get("selfie");
	const sceneId = String(inForm.get("scene_id") ?? "hot-dog-stand");

	if (!(selfie instanceof File) || selfie.size === 0) {
		return c.json({ error: "missing selfie file" }, 400);
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
		const { bytes, contentType, elapsedMs } = await runFlux(c.env.AI, {
			prompt: scene.prompt,
			selfieBytes,
			selfieType: selfie.type,
		});

		return new Response(bytes, {
			headers: {
				"content-type": contentType,
				"content-length": String(bytes.byteLength),
				"x-elapsed-ms": String(elapsedMs),
				"x-scene-id": scene.id,
				"x-scene-name": scene.name,
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
app.get("/test-scene-grid", (c) => {
	return c.html(
		page(
			"Scene prompt spike — Step 2.3",
			`<main class="min-h-screen flex flex-col items-center px-6 py-12">
				<h1 class="text-3xl font-bold mb-2">Scene prompt spike</h1>
				<p class="text-white/60 mb-8 max-w-xl text-center">
					Upload one selfie. We'll generate one caricature for every NYC scene in parallel,
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
app.post("/api/test-scene-grid", async (c) => {
	let inForm: FormData;
	try {
		inForm = await c.req.formData();
	} catch (err) {
		return c.json({ error: "expected multipart/form-data with 'selfie'", details: String(err) }, 400);
	}
	const selfie = inForm.get("selfie");
	if (!(selfie instanceof File) || selfie.size === 0) {
		return c.json({ error: "missing selfie file" }, 400);
	}

	let scenes: Scene[];
	try {
		scenes = await loadScenes(c.env);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}

	const runId = String(Date.now());
	const selfieBytes = await selfie.arrayBuffer();
	const selfieType = selfie.type || "image/jpeg";

	// Also stash the original selfie so the review page can show the input.
	await c.env.BUCKET.put(`prompt-spike/${runId}/selfie.jpg`, selfieBytes, {
		httpMetadata: { contentType: selfieType },
	});

	const overallStart = Date.now();
	const results = await Promise.allSettled(
		scenes.map(async (scene) => {
			const { bytes, contentType, elapsedMs } = await runFlux(c.env.AI, {
				prompt: scene.prompt,
				selfieBytes,
				selfieType,
			});
			const ext = contentType === "image/png" ? "png" : "jpg";
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

	const successes = results
		.map((r, i) => ({ scene: scenes[i], result: r }))
		.filter((x) => x.result.status === "fulfilled");
	const failures = results
		.map((r, i) => ({ scene: scenes[i], result: r }))
		.filter((x) => x.result.status === "rejected");

	// Redirect (303 = POST-redirect-GET) to the review page for this run.
	const url = new URL(c.req.url);
	url.pathname = `/test-scene-grid/${runId}`;
	url.search = "";
	c.header("x-total-ms", String(totalMs));
	c.header("x-successes", String(successes.length));
	c.header("x-failures", String(failures.length));
	return c.redirect(url.toString(), 303);
});

/**
 * Side-by-side review page for a scene-grid run.
 * GET /test-scene-grid/:runId
 */
app.get("/test-scene-grid/:runId", async (c) => {
	const runId = c.req.param("runId");
	if (!/^\d+$/.test(runId)) return c.notFound();

	const scenes = await loadScenes(c.env);
	const prefix = `prompt-spike/${runId}/`;
	const listing = await c.env.BUCKET.list({ prefix, limit: 100 });
	const keysByScene = new Map<string, string>();
	for (const obj of listing.objects) {
		const filename = obj.key.slice(prefix.length); // "<sceneId>.jpg" or "selfie.jpg"
		const sceneId = filename.replace(/\.(jpg|png)$/i, "");
		keysByScene.set(sceneId, obj.key);
	}

	const selfieKey = keysByScene.get("selfie");
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
		.join("\n");

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
app.get("/api/scene-grid-img", async (c) => {
	const key = c.req.query("key");
	if (!key || !key.startsWith("prompt-spike/")) {
		return c.json({ error: "invalid key" }, 400);
	}
	const obj = await c.env.BUCKET.get(key);
	if (!obj) return c.json({ error: "not found", key }, 404);
	return new Response(obj.body, {
		headers: {
			"content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
			"content-length": String(obj.size),
			"cache-control": "public, max-age=3600",
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
app.get("/api/run-img", async (c) => {
	const key = c.req.query("key");
	if (!key || (!key.startsWith("runs/") && !key.startsWith("kiosk/"))) {
		return c.json({ error: "invalid key" }, 400);
	}
	const obj = await c.env.BUCKET.get(key);
	if (!obj) return c.json({ error: "not found", key }, 404);

	const headers: Record<string, string> = {
		"content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
		"content-length": String(obj.size),
		"cache-control": "public, max-age=3600",
	};

	// Optional ?download=1 — force the browser to download instead of preview.
	// Used by the /p/:id digital pickup landing's "Download" button. We pick
	// a friendly filename based on the last path segment of the R2 key so the
	// user gets `postcard.jpg` instead of a UUID-laden URL.
	if (c.req.query("download")) {
		const tail = key.split("/").pop() ?? "image";
		headers["content-disposition"] = `attachment; filename="nyc-${tail}"`;
	}

	return new Response(obj.body, { headers });
});

/**
 * Renders the moderation test form.
 * GET /test-moderate
 */
app.get("/test-moderate", (c) => {
	return c.html(
		page(
			"Moderation test — Step 2.4",
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
app.post("/api/test-moderate", async (c) => {
	let inForm: FormData;
	try {
		inForm = await c.req.formData();
	} catch (err) {
		return c.json({ error: "expected multipart/form-data with 'image'", details: String(err) }, 400);
	}
	const image = inForm.get("image");
	if (!(image instanceof File) || image.size === 0) {
		return c.json({ error: "missing image file" }, 400);
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
app.get("/test-watermark", (c) => {
	return c.html(
		page(
			"Watermark test — Step 3.1",
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
app.post("/api/test-watermark", async (c) => {
	let inForm: FormData;
	try {
		inForm = await c.req.formData();
	} catch (err) {
		return c.json({ error: "expected multipart/form-data with 'image'", details: String(err) }, 400);
	}
	const image = inForm.get("image");
	if (!(image instanceof File) || image.size === 0) {
		return c.json({ error: "missing image file" }, 400);
	}

	// Fetch watermark from our static assets binding
	const wmReq = new Request("http://internal/watermark.png");
	const wmResp = await c.env.ASSETS.fetch(wmReq);
	if (!wmResp.ok || !wmResp.body) {
		return c.json({ error: "watermark asset not available" }, 500);
	}

	const started = Date.now();
	try {
		const baseStream = image.stream();
		const wmStream = wmResp.body;

		// Watermark width ≈ 40% of postcard width (the brand mark is wide because the
		// Cloudflare logo is a long horizontal cloud — see public/watermark.png).
		const result = await c.env.IMAGES.input(baseStream)
			.draw(
				c.env.IMAGES.input(wmStream).transform({ width: 400 }),
				{ bottom: 32, right: 32, opacity: 0.95 },
			)
			.output({ format: "image/jpeg" });

		const response = result.response();
		const elapsedMs = Date.now() - started;
		response.headers.set("x-elapsed-ms", String(elapsedMs));
		return response;
	} catch (err) {
		return c.json({ error: "watermark composition failed", details: String(err) }, 500);
	}
});

/**
 * Renders the postcard test form.
 * GET /test-postcard
 */
app.get("/test-postcard", (c) => {
	return c.html(
		page(
			"Postcard format — Step 3.3",
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
app.post("/api/test-postcard", async (c) => {
	let inForm: FormData;
	try {
		inForm = await c.req.formData();
	} catch (err) {
		return c.json({ error: "expected multipart/form-data with 'image'", details: String(err) }, 400);
	}
	const image = inForm.get("image");
	if (!(image instanceof File) || image.size === 0) {
		return c.json({ error: "missing image file" }, 400);
	}

	const includeQr = inForm.get("include_qr") === "on";
	const postcardId = includeQr ? newPostcardId() : undefined;
	const qrUrl = postcardId ? `${new URL(c.req.url).origin}/p/${postcardId}` : undefined;

	const started = Date.now();
	try {
		const response = await buildPostcard(c.env, image.stream(), { qrUrl });
		const elapsedMs = Date.now() - started;
		response.headers.set("x-elapsed-ms", String(elapsedMs));
		response.headers.set("x-postcard-dimensions", `${POSTCARD_W}x${POSTCARD_H}`);
		if (postcardId) {
			response.headers.set("x-postcard-id", postcardId);
			response.headers.set("x-postcard-url", qrUrl!);
		}
		return response;
	} catch (err) {
		return c.json({ error: "postcard build failed", details: String(err) }, 500);
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
function brandedPostcardNotFound(c: Context<{ Bindings: Env }>, id?: string) {
	const idPreview = id ? id.slice(0, 8) : "";
	const previewHtml = idPreview
		? `<p class="text-white/60 mb-2">No session matches <code class="text-cf-orange">${idPreview}…</code></p>`
		: `<p class="text-white/60 mb-2">No postcard at this address.</p>`;

	c.status(404);
	return c.html(
		page(
			"Postcard not found",
			`<main class="min-h-screen flex flex-col items-center justify-center px-6 py-12">
				<div class="text-center max-w-xl">
					<div class="text-6xl mb-6">🗽</div>
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
app.get("/p/:id", async (c) => {
	const id = c.req.param("id");
	const isShortSlug = /^[a-z2-9]{6,16}$/.test(id);
	const isUuid = UUID_RE.test(id);

	const origin = new URL(c.req.url).origin;
	const pickupUrl = `${origin}/p/${id}`;

	// ---- Malformed id — branded 404 ----
	if (!isShortSlug && !isUuid) {
		return brandedPostcardNotFound(c, id);
	}

	// ---- Legacy short slug (test postcards from /test-postcard) ----
	if (isShortSlug) {
		return c.html(
			page(
				`Test postcard — ${id}`,
				`<main class="min-h-screen flex flex-col items-center justify-center px-6 py-12">
					<div class="text-center max-w-2xl">
						<img src="/cloudflare-logo.png" alt="" class="mx-auto h-16 w-auto mb-6 drop-shadow-[0_0_24px_rgba(246,130,31,0.5)]" />
						<h1 class="text-3xl font-bold mb-2">You scanned a test postcard</h1>
						<p class="text-white/60 mb-8">Postcard ID: <code class="text-cf-orange">${id}</code></p>
						<p class="text-white/60">
							This QR was generated by the <code>/test-postcard</code> dev endpoint.
							Real postcards link to a session UUID and show the full digital pickup page.
						</p>
						<a href="/" class="mt-10 inline-block rounded-full bg-cf-orange px-6 py-3 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">
							See what we built
						</a>
					</div>
				</main>`,
			),
		);
	}

	// ---- UUID: look up the session in D1 ----
	const row = await c.env.DB.prepare(
		`SELECT id, status, scene_name, postcard_key, completed_at, email
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
		}>();

	// ---- Not found in D1 ----
	if (!row) {
		return brandedPostcardNotFound(c, id);
	}

	// ---- Still in progress (workflow hasn't reached `store` yet) ----
	if (row.status !== "completed" || !row.postcard_key) {
		const stateLabel =
			row.status === "errored"
				? "Something went wrong with this postcard"
				: "Your postcard is still being generated…";
		const helpCopy =
			row.status === "errored"
				? "Head back to the booth and the staff will help you start a new one."
				: "Hang tight — this page will refresh automatically. The whole pipeline usually finishes in under a minute.";
		const shouldAutoRefresh = row.status !== "errored";
		return c.html(
			page(
				"Your postcard — preparing…",
				`<main class="min-h-screen flex flex-col items-center justify-center px-6 py-12">
					<div class="text-center max-w-xl">
						<div class="mx-auto mb-6 size-16 rounded-full border-2 border-cf-orange/40 border-t-cf-orange animate-spin"></div>
						<h1 class="text-3xl font-bold mb-3">${stateLabel}</h1>
						<p class="text-white/60">${helpCopy}</p>
						<p class="text-white/40 text-xs mt-6">session ${id.slice(0, 8)}…</p>
					</div>
				</main>
				${shouldAutoRefresh ? `<script>setTimeout(function(){ location.reload(); }, 5000);</script>` : ""}`,
			),
		);
	}

	// ---- Happy path: completed session with a postcard ----
	const sceneName = row.scene_name ?? "NYC scene";
	const postcardKey = row.postcard_key;
	const postcardSrc = `/api/run-img?key=${encodeURIComponent(postcardKey)}`;
	const downloadSrc = `/api/run-img?key=${encodeURIComponent(postcardKey)}&download=1`;

	// Format completed_at as a human-readable date (UTC ok — this is a souvenir,
	// timezone precision isn't critical and avoids a libraries-free pitfall).
	const completedLabel = row.completed_at
		? new Date(row.completed_at * 1000).toLocaleString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
				hour: "numeric",
				minute: "2-digit",
				timeZone: "America/New_York",
				timeZoneName: "short",
			})
		: "Just now";

	return c.html(
		page(
			`Your postcard — ${sceneName}`,
			`<header class="absolute top-0 left-0 right-0 px-6 sm:px-8 py-6 flex items-center justify-between z-10">
				<a href="/" class="flex items-center gap-2 text-sm uppercase tracking-widest text-white/60 hover:text-white transition">
					<img src="/cloudflare-logo.png" alt="" class="h-5 w-5" />
					<span>Cloudflare &middot; NY Tech Week 2026</span>
				</a>
				<div class="hidden sm:flex items-center gap-3 text-2xl font-black leading-none">
					<span>I</span>
					<img src="/cloudflare-logo.png" alt="Cloudflare" class="h-6 w-auto drop-shadow-[0_0_16px_rgba(246,130,31,0.6)]" />
					<span>NY</span>
				</div>
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
						${row.email
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
								<p id="email-success" class="hidden text-sm text-cf-orange text-center mt-3"></p>`}
					</section>

					<!-- Footer -->
					<footer class="mt-12 flex items-center justify-center gap-2 text-xs text-white/40">
						<span>Built end-to-end on</span>
						<img src="/cloudflare-logo.png" alt="Cloudflare" class="h-3.5 w-auto opacity-80" />
						<span>Cloudflare</span>
					</footer>
				</div>
			</main>

			<script>
			(function () {
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
							var res = await fetch("/api/p/" + encodeURIComponent(sessionId) + "/email", {
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
app.post("/api/p/:id/email", async (c) => {
	const id = c.req.param("id");
	if (!UUID_RE.test(id)) {
		return c.json({ error: "invalid session id" }, 400);
	}

	let body: { email?: unknown };
	try {
		body = await c.req.json();
	} catch (err) {
		return c.json({ error: "expected JSON body { email }", details: String(err) }, 400);
	}

	const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
	// Minimal email validation — we're not going to RFC-5322 this, but
	// we do want to catch obvious garbage before it hits D1.
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return c.json({ error: "invalid email address" }, 400);
	}
	if (email.length > 320) {
		return c.json({ error: "email address too long" }, 400);
	}

	// Verify the session is completed. No point in storing email for a
	// session that never produced a postcard.
	const session = await c.env.DB.prepare(
		"SELECT id, status, postcard_key FROM sessions WHERE id = ?",
	)
		.bind(id)
		.first<{ id: string; status: string | null; postcard_key: string | null }>();

	if (!session) {
		return c.json({ error: "session not found" }, 404);
	}
	if (session.status !== "completed" || !session.postcard_key) {
		return c.json({ error: "session is not completed" }, 409);
	}

	await c.env.DB.prepare(
		"UPDATE sessions SET email = ?, email_submitted_at = unixepoch() WHERE id = ?",
	)
		.bind(email, id)
		.run();

	console.log(`[email-optin] session=${id} email=${email.slice(0, 3)}***`);

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
app.get("/p", (c) => brandedPostcardNotFound(c));
app.get("/p/:id/*", (c) => brandedPostcardNotFound(c, c.req.param("id")));

/**
 * Test endpoint: generate an image with Workers AI (FLUX.2 klein 4B).
 * GET /api/test-ai?prompt=...
 * Returns image/png directly so you can preview in browser.
 */
app.get("/api/test-ai", async (c) => {
	const prompt =
		c.req.query("prompt") ??
		"A stylized illustration of a hot dog on a New York City sidewalk with yellow taxis blurred in the background, vibrant cartoon style.";

	try {
		const { bytes, contentType, elapsedMs } = await runFlux(c.env.AI, { prompt });
		return new Response(bytes, {
			headers: {
				"content-type": contentType,
				"content-length": String(bytes.byteLength),
				"x-elapsed-ms": String(elapsedMs),
				"x-prompt": prompt,
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
app.get("/api/scenes", async (c) => {
	const raw = await c.env.CONFIG.get("scenes");
	if (!raw) return c.json({ error: "scenes not configured" }, 500);

	try {
		const scenes = JSON.parse(raw);
		return c.json({ count: scenes.length, scenes });
	} catch (err) {
		return c.json({ error: "invalid scenes JSON", details: String(err) }, 500);
	}
});

/**
 * Test endpoint: insert a row into D1 and read recent rows back.
 * GET /api/test-db
 */
app.get("/api/test-db", async (c) => {
	const id = crypto.randomUUID();
	const inserted = await c.env.DB.prepare(
		"INSERT INTO sessions (id, status) VALUES (?, ?) RETURNING id, created_at, status",
	)
		.bind(id, "test")
		.first<{ id: string; created_at: number; status: string }>();

	const recent = await c.env.DB.prepare(
		"SELECT id, created_at, status FROM sessions ORDER BY created_at DESC LIMIT 5",
	).all<{ id: string; created_at: number; status: string }>();

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
app.get("/api/test-upload", async (c) => {
	// 1x1 transparent PNG, base64 encoded
	const tinyPngBase64 =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
	const bytes = Uint8Array.from(atob(tinyPngBase64), (ch) => ch.charCodeAt(0));

	const key = `test/${Date.now()}-tiny.png`;
	await c.env.BUCKET.put(key, bytes, {
		httpMetadata: { contentType: "image/png" },
	});

	return c.json({ ok: true, key, size: bytes.byteLength });
});

/**
 * Test endpoint: lists the most recent R2 objects (for verification).
 * GET /api/test-list
 */
app.get("/api/test-list", async (c) => {
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
app.get("/api/test-get", async (c) => {
	const key = c.req.query("key");
	if (!key) return c.json({ error: "missing ?key=" }, 400);

	const obj = await c.env.BUCKET.get(key);
	if (!obj) return c.json({ error: "not found", key }, 404);

	return new Response(obj.body, {
		headers: {
			"content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
			"content-length": String(obj.size),
		},
	});
});

export default app;
