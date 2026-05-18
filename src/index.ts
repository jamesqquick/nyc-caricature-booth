import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

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
					Step 2.2 &middot; Image-to-image with selfie
				</div>
				<div class="mt-6 flex flex-col items-center gap-2">
					<a href="/test-i2i" class="text-sm text-cf-orange hover:text-white underline underline-offset-4 transition">
						🪄 Try the selfie → caricature flow →
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
	return c.json({ status: "ok", step: "2.2" });
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
							<span>Generating… this usually takes 2–10s</span>
						</span>
					</button>
					<p id="i2i-hint" class="text-xs text-white/40">Takes ~5-15 seconds. The page will return the JPEG directly.</p>
				</form>
				<script>
					(function () {
						const form = document.getElementById("i2i-form");
						const button = document.getElementById("i2i-submit");
						const selfie = document.getElementById("i2i-selfie");
						const scene = document.getElementById("i2i-scene");
						const idleLabel = button.querySelector('[data-label="idle"]');
						const loadingLabel = button.querySelector('[data-label="loading"]');
						const hint = document.getElementById("i2i-hint");
						let started = 0;
						let tickHandle = null;

						function setLoading(on) {
							button.disabled = on;
							selfie.disabled = on;
							scene.disabled = on;
							idleLabel.classList.toggle("hidden", on);
							loadingLabel.classList.toggle("hidden", !on);
							loadingLabel.classList.toggle("inline-flex", on);
						}

						form.addEventListener("submit", function () {
							setLoading(true);
							started = Date.now();
							hint.textContent = "Elapsed: 0.0s";
							tickHandle = setInterval(function () {
								const s = ((Date.now() - started) / 1000).toFixed(1);
								hint.textContent = "Elapsed: " + s + "s";
							}, 100);
						});

						// If the user comes back via the bfcache (browser back button) reset state.
						window.addEventListener("pageshow", function (e) {
							if (e.persisted) {
								setLoading(false);
								if (tickHandle) clearInterval(tickHandle);
								hint.textContent = "Takes ~5-15 seconds. The page will return the JPEG directly.";
							}
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
	const inForm = await c.req.formData();
	const selfie = inForm.get("selfie");
	const sceneId = String(inForm.get("scene_id") ?? "hot-dog-stand");

	if (!(selfie instanceof File) || selfie.size === 0) {
		return c.json({ error: "missing selfie file" }, 400);
	}

	// Lookup the scene prompt from KV
	const raw = await c.env.CONFIG.get("scenes");
	if (!raw) return c.json({ error: "scenes not configured" }, 500);
	const scenes = JSON.parse(raw) as Array<{ id: string; prompt: string; name: string }>;
	const scene = scenes.find((s) => s.id === sceneId);
	if (!scene) return c.json({ error: `unknown scene_id: ${sceneId}` }, 400);

	// Build multipart payload for Workers AI
	const aiForm = new FormData();
	aiForm.append("prompt", scene.prompt);
	aiForm.append("width", "1024");
	aiForm.append("height", "1024");
	// Re-wrap the selfie as a Blob so we control the content type
	const selfieBlob = new Blob([await selfie.arrayBuffer()], {
		type: selfie.type || "image/jpeg",
	});
	aiForm.append("input_image_0", selfieBlob, selfie.name || "selfie.jpg");

	const formResponse = new Response(aiForm);
	const formStream = formResponse.body;
	const formContentType =
		formResponse.headers.get("content-type") ?? "multipart/form-data";

	const started = Date.now();
	const resp = (await c.env.AI.run("@cf/black-forest-labs/flux-2-klein-4b", {
		multipart: {
			body: formStream as ReadableStream,
			contentType: formContentType,
		},
	})) as { image?: string } | unknown;
	const elapsedMs = Date.now() - started;

	if (
		!resp ||
		typeof resp !== "object" ||
		!("image" in resp) ||
		typeof resp.image !== "string"
	) {
		return c.json(
			{ error: "unexpected AI response shape", got: resp, elapsedMs },
			500,
		);
	}

	const bytes = Uint8Array.from(atob(resp.image), (ch) => ch.charCodeAt(0));
	const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
	const isPng =
		bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
	const contentType = isJpeg
		? "image/jpeg"
		: isPng
			? "image/png"
			: "application/octet-stream";

	return new Response(bytes, {
		headers: {
			"content-type": contentType,
			"content-length": String(bytes.byteLength),
			"x-elapsed-ms": String(elapsedMs),
			"x-scene-id": scene.id,
			"x-scene-name": scene.name,
		},
	});
});

/**
 * Test endpoint: generate an image with Workers AI (FLUX.2 klein 4B).
 * GET /api/test-ai?prompt=...
 * Returns image/png directly so you can preview in browser.
 */
app.get("/api/test-ai", async (c) => {
	const prompt =
		c.req.query("prompt") ??
		"A stylized illustration of a hot dog on a New York City sidewalk with yellow taxis blurred in the background, vibrant cartoon style.";

	const form = new FormData();
	form.append("prompt", prompt);
	form.append("width", "1024");
	form.append("height", "1024");

	// Wrap FormData in a Request so we can grab a properly-formed multipart body + content-type
	const formRequest = new Request("http://dummy", { method: "POST", body: form });
	const formStream = formRequest.body;
	const formContentType =
		formRequest.headers.get("content-type") ?? "multipart/form-data";

	const started = Date.now();
	const resp = (await c.env.AI.run("@cf/black-forest-labs/flux-2-klein-4b", {
		multipart: {
			body: formStream as ReadableStream,
			contentType: formContentType,
		},
	})) as { image?: string } | unknown;
	const elapsedMs = Date.now() - started;

	// FLUX.2 returns { image: "<base64 string>" }
	if (!resp || typeof resp !== "object" || !("image" in resp) || typeof resp.image !== "string") {
		return c.json(
			{ error: "unexpected AI response shape", got: resp, elapsedMs },
			500,
		);
	}

	const bytes = Uint8Array.from(atob(resp.image), (ch) => ch.charCodeAt(0));

	// FLUX.2 actually returns JPEG bytes. Sniff the magic number to set the right content-type.
	const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
	const isPng =
		bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
	const contentType = isJpeg
		? "image/jpeg"
		: isPng
			? "image/png"
			: "application/octet-stream";

	return new Response(bytes, {
		headers: {
			"content-type": contentType,
			"content-length": String(bytes.byteLength),
			"x-elapsed-ms": String(elapsedMs),
			"x-prompt": prompt,
		},
	});
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
	await c.env.IMAGES.put(key, bytes, {
		httpMetadata: { contentType: "image/png" },
	});

	return c.json({ ok: true, key, size: bytes.byteLength });
});

/**
 * Test endpoint: lists the most recent R2 objects (for verification).
 * GET /api/test-list
 */
app.get("/api/test-list", async (c) => {
	const listing = await c.env.IMAGES.list({ limit: 10 });
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

	const obj = await c.env.IMAGES.get(key);
	if (!obj) return c.json({ error: "not found", key }, 404);

	return new Response(obj.body, {
		headers: {
			"content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
			"content-length": String(obj.size),
		},
	});
});

export default app;
