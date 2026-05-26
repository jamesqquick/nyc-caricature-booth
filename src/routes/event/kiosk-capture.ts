import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';
import { kioskPage } from '../../lib/html';

const app = new Hono<EventEnv>();

/**
 * Live camera capture screen (step 1 of 3).
 * GET /kiosk/capture
 */
app.get('/kiosk/capture', (c) => {
	const basePath = c.get('basePath');
	const origin = new URL(c.req.url).origin;
	const eventUrl = `${origin}${basePath}/`;
	const qrSrc = `${basePath}/api/kiosk/qr?url=${encodeURIComponent(eventUrl)}`;
	return c.html(
		kioskPage(
			'Capture your selfie',
			`			<div class="flex justify-center pt-4 sm:fixed sm:top-4 sm:left-4 sm:z-50 sm:pt-0 sm:block">
				<img src="${qrSrc}" alt="QR code — scan to open this page"
					class="w-20 sm:w-24 rounded-xl border border-white/10 bg-white p-1.5" />
			</div>
			<main id="capture-root" class="min-h-[100dvh] h-[100dvh] w-full flex flex-col">
				<header class="shrink-0 px-6 pt-4 sm:pt-8 pb-2 flex items-center justify-between">
					<a href="${basePath}/kiosk" class="text-sm text-white/50 hover:text-white sm:pl-32">← Cancel</a>
					<span class="text-xs uppercase tracking-[0.25em] text-white/40 hidden sm:inline">Step 1 of 3 · Selfie</span>
					<span class="w-12"></span>
				</header>

				<section class="flex-1 min-h-0 flex flex-col items-center justify-center px-4 sm:px-6 py-2 gap-3">
					<div class="relative h-full w-full max-w-[640px] max-h-full flex items-center justify-center">
						<div class="relative h-full max-h-full aspect-[3/4] rounded-[2.5rem] overflow-hidden bg-black/60 ring-1 ring-white/10 shadow-[0_0_60px_rgba(246,130,31,0.15)]">
							<video id="cap-video" class="absolute inset-0 h-full w-full object-cover -scale-x-100" playsinline muted autoplay></video>
							<img id="cap-preview" class="absolute inset-0 h-full w-full object-cover hidden -scale-x-100" alt="captured frame" />
							<div class="absolute inset-0 pointer-events-none flex items-center justify-center">
								<div class="size-[78%] rounded-full border-2 border-white/30 mix-blend-screen"></div>
							</div>
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
					<p class="mt-2 text-center text-[10px] uppercase tracking-[0.2em] text-white/25">
						We don't store your photo after the event · <a href="${basePath}/privacy" class="underline underline-offset-2 hover:text-white/40">Privacy</a>
					</p>
				</footer>
			</main>

			<script>
			(function () {
				const basePath = ${JSON.stringify(basePath)};
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
					setOverlay(
						'<div class="size-12 rounded-full border-2 border-cf-orange/40 border-t-cf-orange animate-spin mb-4"></div>' +
						'<div class="text-xl font-semibold">Starting camera\u2026</div>' +
						'<p class="mt-2 text-sm text-white/60">If you see a permissions prompt, tap Allow.</p>'
					);
					if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
						setOverlay(
							'<div class="size-16 rounded-full border-2 border-red-400/30 bg-red-500/10 flex items-center justify-center text-2xl mb-4" aria-hidden="true">\u26a0\ufe0f</div>' +
							'<div class="text-xl font-semibold">Camera not supported</div>' +
							'<p class="mt-2 text-sm text-white/60 max-w-xs">This browser cannot access the camera. Try Safari on iPad or Chrome on desktop.</p>' +
							'<a href="' + basePath + '/kiosk" class="mt-6 inline-flex items-center justify-center rounded-full bg-cf-orange px-8 py-3 text-base font-bold text-black hover:bg-cf-orange-dark active:scale-[0.98] transition">\u2190 Back to start</a>'
						);
						return;
					}
					try {
						stream = await navigator.mediaDevices.getUserMedia({
							video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
							audio: false,
						});
						video.srcObject = stream;
						await video.play().catch(function () {});
						setOverlay(null);
						shutter.disabled = false;
					} catch (err) {
						console.error("getUserMedia failed:", err);
						const denied = String(err && err.name) === "NotAllowedError";
						setOverlay(
							'<div class="size-16 rounded-full border-2 border-red-400/30 bg-red-500/10 flex items-center justify-center text-2xl mb-4" aria-hidden="true">' +
							(denied ? '\ud83d\udeab' : '\u26a0\ufe0f') + '</div>' +
							'<div class="text-xl font-semibold">' + (denied ? "Camera access blocked" : "Camera unavailable") + '</div>' +
							'<p class="mt-2 text-sm text-white/60 max-w-xs">' +
							(denied ? "We need camera access to take your selfie. Check your browser or device settings, then tap Retry." : "Make sure no other app is using the camera, then tap Retry.") +
							'</p>' +
							'<button id="cap-retry-perms" class="mt-6 inline-flex items-center justify-center rounded-full bg-cf-orange px-8 py-3 text-base font-bold text-black hover:bg-cf-orange-dark active:scale-[0.98] transition">Retry permissions</button>' +
							'<a href="' + basePath + '/kiosk" class="mt-3 text-sm text-white/50 hover:text-white underline underline-offset-4">\u2190 Back to start</a>'
						);
						var retryPerms = document.getElementById("cap-retry-perms");
						if (retryPerms) retryPerms.addEventListener("click", function () { startCamera(); });
					}
				}

				function stopCamera() {
					if (stream) {
						stream.getTracks().forEach(function (t) { t.stop(); });
						stream = null;
					}
				}

				function takePhoto() {
					if (!video.videoWidth) return;
					const canvas = document.createElement("canvas");
					canvas.width = video.videoWidth;
					canvas.height = video.videoHeight;
					const ctx = canvas.getContext("2d");
					ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
					canvas.toBlob(function (blob) {
						if (!blob) { statusEl.textContent = "✗ Failed to capture frame."; return; }
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
						hint.textContent = "";
					}, "image/jpeg", 0.92);
				}

				async function retake() {
					capturedBlob = null;
					if (capturedUrl) { URL.revokeObjectURL(capturedUrl); capturedUrl = null; }
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
						const r = await fetch(basePath + "/api/kiosk/selfie", { method: "POST", body: fd });
						const j = await r.json();
						if (!r.ok || !j.ok) throw new Error(j.error || "upload failed");
						sessionStorage.setItem("kiosk:selfie", JSON.stringify({
							sessionId: j.sessionId,
							selfieKey: j.selfieKey,
							size: j.size,
							capturedAt: Date.now(),
						}));
						statusEl.textContent = "✓ Uploaded. Pick a scene next…";
						window.location.href = basePath + "/kiosk/scene";
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
				window.addEventListener("pagehide", stopCamera);
				window.addEventListener("beforeunload", stopCamera);
				startCamera();
			})();
			</script>`,
		),
	);
});

export { app as kioskCaptureRoutes };
