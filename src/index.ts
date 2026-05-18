import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
	return c.html(`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>I 🧡 NY — Cloudflare NY Tech Week</title>
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<style>
			body {
				font-family: system-ui, -apple-system, sans-serif;
				padding: 2rem;
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				min-height: 100vh;
				margin: 0;
			}
			.brand {
				display: inline-flex;
				align-items: center;
				gap: 0.5rem;
				font-size: 4rem;
				font-weight: 800;
			}
			.brand img {
				height: 4rem;
				width: auto;
			}
			p {
				color: #555;
				margin-top: 0.5rem;
			}
		</style>
	</head>
	<body>
		<div class="brand">
			<span>I</span>
			<img src="/cloudflare-logo.png" alt="Cloudflare" />
			<span>NY</span>
		</div>
		<p>Caricature booth — Cloudflare NY Tech Week activation.</p>
		<p>Step 0.1: Hello World ✅</p>
	</body>
</html>`);
});

app.get("/api/health", (c) => {
	return c.json({ status: "ok", step: "0.1" });
});

export default app;
