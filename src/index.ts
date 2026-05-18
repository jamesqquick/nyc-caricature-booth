import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
	return c.html(`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>I 🟧 NY — Cloudflare NY Tech Week</title>
		<meta name="viewport" content="width=device-width, initial-scale=1" />
	</head>
	<body style="font-family: system-ui, sans-serif; padding: 2rem;">
		<h1>I 🟧 NY</h1>
		<p>Caricature booth — Cloudflare NY Tech Week activation.</p>
		<p>Step 0.1: Hello World ✅</p>
	</body>
</html>`);
});

app.get("/api/health", (c) => {
	return c.json({ status: "ok", step: "0.1" });
});

export default app;
