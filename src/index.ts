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
					Step 1.3 &middot; KV scenes seeded
				</div>
			</main>`,
		),
	);
});

app.get("/api/health", (c) => {
	return c.json({ status: "ok", step: "1.3" });
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
