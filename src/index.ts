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
					Step 0.3 &middot; Deployed to production
				</div>
			</main>`,
		),
	);
});

app.get("/api/health", (c) => {
	return c.json({ status: "ok", step: "0.3" });
});

export default app;
