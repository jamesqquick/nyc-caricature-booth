import { Hono } from "hono";

import { moderateImage } from "./lib/moderation";
import { runFlux } from "./lib/flux";
import { loadScenes, type Scene } from "./lib/scenes";
import {
	POSTCARD_H,
	POSTCARD_W,
	buildPostcard,
	newPostcardId,
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
					Step 5.2 &middot; Session DO state machine
				</div>
				<div class="mt-6 flex flex-col items-center gap-2">
					<a href="/test-session" class="text-sm text-cf-orange hover:text-white underline underline-offset-4 transition">
						🪪 Session DO state machine (step 5.2) →
					</a>
					<a href="/test-workflow-moderate" class="text-xs text-white/60 hover:text-white underline underline-offset-4 transition">
						⚡ Full workflow pipeline (selfie + scene → postcard)
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
	return c.json({ status: "ok", step: "5.2" });
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
 * Manual driver page for the SessionDO (step 5.2).
 * Click to create a session, then use the status form to drive its state.
 * GET /test-session       — landing / create
 * GET /test-session/:id   — drive an existing session
 */
app.get("/test-session", (c) => {
	return c.html(
		page(
			"Session DO — Step 5.2",
			`<main class="min-h-screen flex flex-col items-center px-6 py-12">
				<h1 class="text-3xl font-bold mb-2">Session Durable Object</h1>
				<p class="text-white/60 mb-8 max-w-xl text-center">
					One DO per caricature session. Step 5.2 adds a validated state machine
					(queued → moderating → generating → compositing → done; any → errored)
					and self-deletes 5 minutes after reaching a terminal state.
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
					<h2 class="text-sm font-semibold text-white/60 mb-2">Current state</h2>
					<pre id="state" class="text-xs whitespace-pre-wrap break-words text-white/80">loading…</pre>
					<button id="refresh" class="mt-4 text-sm text-cf-orange hover:underline">↻ refresh</button>
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

						const statusSelect = formEl.querySelector('select[name="status"]');
						async function refresh() {
							const r = await fetch("/api/test-session/" + id);
							const j = await r.json();
							stateEl.textContent = JSON.stringify(j.state, null, 2);
							if (j.state && j.state.status) statusSelect.value = j.state.status;
						}
						refreshEl.addEventListener("click", refresh);
						formEl.addEventListener("submit", async function (e) {
							e.preventDefault();
							msgEl.textContent = "updating…";
							const fd = new FormData(formEl);
							// drop empty optional payload fields
							for (const [k, v] of Array.from(fd.entries())) {
								if (typeof v === "string" && v.trim() === "") fd.delete(k);
							}
							const r = await fetch("/api/test-session/" + id + "/status", {
								method: "POST",
								body: fd,
							});
							const j = await r.json();
							if (j.ok) {
								msgEl.textContent = "✓ marked " + j.state.status;
								stateEl.textContent = JSON.stringify(j.state, null, 2);
								statusSelect.value = j.state.status;
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
							refresh();
						});
						refresh();
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
	url.search = "";
	return c.redirect(url.toString(), 303);
});

/**
 * Live status page for a workflow-moderate run.
 * Auto-polls /api/test-workflow/:id every 1s until terminal state.
 * GET /test-workflow-moderate/:id
 */
app.get("/test-workflow-moderate/:id", (c) => {
	const id = c.req.param("id");
	if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
		return c.notFound();
	}
	return c.html(
		page(
			`Workflow ${id.slice(0, 8)}…`,
			`<main class="min-h-screen flex flex-col items-center px-6 py-12 max-w-3xl mx-auto">
				<h1 class="text-3xl font-bold mb-2">Workflow run</h1>
				<p class="text-white/60 text-sm">Instance: <code class="text-white/80">${id}</code></p>
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
						const labelEl = document.getElementById("wf-status-label");
						const pulseEl = document.getElementById("wf-pulse");
						const elapsedEl = document.getElementById("wf-elapsed");
						const startedEl = document.getElementById("wf-started");
						const rawEl = document.getElementById("wf-raw");
						const previewEl = document.getElementById("wf-preview");
						const caricatureEl = document.getElementById("wf-caricature");
						const postcardEl = document.getElementById("wf-postcard");
						const postcardLinkEl = document.getElementById("wf-postcard-link");

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
 * R2 image proxy constrained to the workflow `runs/` prefix.
 * Used by the workflow status page to preview caricature + postcard, and
 * by /p/:id to render the digital pickup postcard.
 * GET /api/run-img?key=runs/<sessionId>/(caricature|postcard).(jpg|png)
 */
app.get("/api/run-img", async (c) => {
	const key = c.req.query("key");
	if (!key || !key.startsWith("runs/")) {
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
 * Placeholder digital-pickup landing page for a postcard.
 * GET /p/:id
 * In a later step this will fetch the real caricature from R2 and offer
 * email opt-in. For now it just confirms QR scanning works end-to-end.
 */
app.get("/p/:id", async (c) => {
	const id = c.req.param("id");
	// Accept either the short slug (legacy test postcards from /test-postcard)
	// OR a UUID (the workflow's sessionId, used by the real pipeline).
	const isShortSlug = /^[a-z2-9]{6,16}$/.test(id);
	const isUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
	if (!isShortSlug && !isUuid) return c.notFound();

	// For UUIDs (real workflow runs) we have a stored postcard we can show.
	let postcardUrl: string | undefined;
	if (isUuid) {
		const postcardKey = `runs/${id}/postcard.jpg`;
		const head = await c.env.BUCKET.head(postcardKey);
		if (head) {
			postcardUrl = `/api/run-img?key=${encodeURIComponent(postcardKey)}`;
		}
	}

	const preview = postcardUrl
		? `<img src="${postcardUrl}" alt="Your postcard" class="mx-auto rounded-2xl shadow-2xl border border-white/10 max-w-full" />
			 <p class="text-white/60 mt-6 text-sm">High-resolution copy. In the final booth this will also offer an email opt-in for a digital download.</p>`
		: `<img src="/cloudflare-logo.png" alt="" class="mx-auto h-16 w-auto mb-6 drop-shadow-[0_0_24px_rgba(246,130,31,0.5)]" />
			 <p class="text-white/60 mt-6">
				This is a placeholder. In the full booth, this page will let you
				download a high-resolution digital copy and optionally drop your
				email to get a copy sent.
			 </p>`;

	return c.html(
		page(
			`Your postcard — ${id.slice(0, 8)}`,
			`<main class="min-h-screen flex flex-col items-center justify-center px-6 py-12">
				<div class="text-center max-w-2xl">
					<h1 class="text-3xl font-bold mb-2">You scanned a postcard!</h1>
					<p class="text-white/60 mb-8">Postcard ID: <code class="text-cf-orange">${id}</code></p>
					${preview}
					<a href="/" class="mt-10 inline-block rounded-full bg-cf-orange px-6 py-3 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">
						See what we built
					</a>
				</div>
			</main>`,
		),
	);
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
