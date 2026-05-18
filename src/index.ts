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
					Step 2.1 &middot; Workers AI hello world
				</div>
				<a href="/api/test-ai" target="_blank" rel="noopener" class="mt-6 text-sm text-white/60 hover:text-white underline underline-offset-4 transition">
					🖼️ Try the AI image generator →
				</a>
			</main>`,
		),
	);
});

app.get("/api/health", (c) => {
	return c.json({ status: "ok", step: "2.1" });
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
