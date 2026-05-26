import { Hono } from 'hono';
import { UUID_RE, VALID_SESSION_STATUSES, getSessionStub } from '../../lib/helpers';
import { page } from '../../lib/html';

type SessionStatusName = (typeof VALID_SESSION_STATUSES)[number];

const app = new Hono<{ Bindings: Env }>();

/** Create a new session DO. POST /api/test-session */
app.post('/api/test-session', async (c) => {
	const sessionId = crypto.randomUUID();
	const stub = getSessionStub(c.env, sessionId);
	const state = await stub.getState(sessionId);
	return c.json({ ok: true, sessionId, state });
});

/** Return the current state of a session DO. GET /api/test-session/:id */
app.get('/api/test-session/:id', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) return c.json({ error: 'invalid session id' }, 400);
	const stub = getSessionStub(c.env, id);
	const state = await stub.getState(id);
	return c.json({ ok: true, sessionId: id, state });
});

/** Advance session state machine. POST /api/test-session/:id/status */
app.post('/api/test-session/:id/status', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) return c.json({ error: 'invalid session id' }, 400);

	const ct = c.req.header('content-type') ?? '';
	let parsed: Record<string, unknown> = {};
	const qs = c.req.query('status');
	if (qs) parsed.status = qs;

	if (!parsed.status) {
		try {
			if (ct.includes('application/json')) {
				parsed = (await c.req.json()) as Record<string, unknown>;
			} else if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
				const fd = await c.req.formData();
				for (const [k, v] of fd.entries()) parsed[k] = v;
			} else {
				const text = await c.req.text();
				const m = text.match(/(?:^|&)status=([^&]+)/);
				if (m) parsed.status = decodeURIComponent(m[1]);
			}
		} catch (err) {
			return c.json({ error: 'failed to parse body', details: String(err), contentType: ct }, 400);
		}
	}

	const status = parsed.status;
	if (typeof status !== 'string' || !VALID_SESSION_STATUSES.includes(status as SessionStatusName)) {
		return c.json({ error: 'invalid status', validStatuses: VALID_SESSION_STATUSES }, 400);
	}

	const payload = {
		sceneId: typeof parsed.sceneId === 'string' ? parsed.sceneId : undefined,
		sceneName: typeof parsed.sceneName === 'string' ? parsed.sceneName : undefined,
		selfieKey: typeof parsed.selfieKey === 'string' ? parsed.selfieKey : undefined,
		caricatureKey: typeof parsed.caricatureKey === 'string' ? parsed.caricatureKey : undefined,
		postcardKey: typeof parsed.postcardKey === 'string' ? parsed.postcardKey : undefined,
		postcardUrl: typeof parsed.postcardUrl === 'string' ? parsed.postcardUrl : undefined,
		error: typeof parsed.error === 'string' ? parsed.error : undefined,
		elapsedMs:
			typeof parsed.elapsedMs === 'string' ? Number(parsed.elapsedMs) : typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : undefined,
	};

	const stub = getSessionStub(c.env, id);
	try {
		const state = await stub.markStep(status as SessionStatusName, payload, id);
		return c.json({ ok: true, sessionId: id, state });
	} catch (err) {
		const msg = String(err);
		if (msg.includes('invalid session transition')) {
			return c.json({ error: msg.replace(/^Error: /, ''), hint: 'see TRANSITIONS table in src/session/session.ts' }, 409);
		}
		return c.json({ error: msg }, 500);
	}
});

/** Force-delete a session DO's storage. DELETE /api/test-session/:id */
app.delete('/api/test-session/:id', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) return c.json({ error: 'invalid session id' }, 400);
	const stub = getSessionStub(c.env, id);
	await stub.delete();
	return c.json({ ok: true, sessionId: id, deleted: true });
});

/** Manual driver UI. GET /test-session */
app.get('/test-session', (c) => {
	return c.html(
		page(
			'Session DO — Step 5.3',
			`<main class="min-h-screen flex flex-col items-center px-6 py-12">
				<h1 class="text-3xl font-bold mb-2">Session Durable Object</h1>
				<p class="text-white/60 mb-8 max-w-xl text-center">
					One DO per caricature session with live WebSocket fan-out.
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

/** Per-session driver UI. GET /test-session/:id */
app.get('/test-session/:id', (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) return c.notFound();
	const statusOptions = VALID_SESSION_STATUSES.map((s) => `<option value="${s}">${s}</option>`).join('');
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
					</form>
					<p id="status-msg" class="text-xs text-white/50 mt-3"></p>
					<div class="mt-4 text-[11px] text-white/40 leading-relaxed">
						Allowed transitions: queued → moderating → generating → compositing → done.
					</div>
				</section>

				<section class="w-full mt-6 rounded-2xl bg-white/5 border border-white/10 p-6">
					<h2 class="text-sm font-semibold text-white/60 mb-2">Danger zone</h2>
					<button id="delete-btn" class="rounded-full bg-red-600/80 hover:bg-red-500 px-5 py-2 text-sm font-semibold text-white transition">
						Force-delete DO storage
					</button>
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
							const r = await fetch("/api/test-session/" + id + "/status", { method: "POST", body: fd });
							const j = await r.json();
							if (j.ok) { msgEl.textContent = "✓ marked " + j.state.status; applyState(j.state); }
							else if (r.status === 409) { msgEl.textContent = "⛔ " + j.error; }
							else { msgEl.textContent = "✗ " + (j.error || "error"); }
						});

						deleteBtn.addEventListener("click", async function () {
							if (!confirm("Force-delete this DO's storage?")) return;
							const r = await fetch("/api/test-session/" + id, { method: "DELETE" });
							const j = await r.json();
							msgEl.textContent = j.ok ? "✓ deleted" : "✗ " + (j.error || "error");
						});

						let ws; let backoff = 500;
						function setWsStatus(label, color) { wsLabel.textContent = label; wsDot.className = "size-2 rounded-full " + color; }
						function connect() {
							const proto = location.protocol === "https:" ? "wss:" : "ws:";
							const url = proto + "//" + location.host + "/api/session/" + id + "/ws";
							setWsStatus("connecting…", "bg-yellow-400 animate-pulse");
							ws = new WebSocket(url);
							ws.addEventListener("open", function () { setWsStatus("live", "bg-emerald-500"); backoff = 500; });
							ws.addEventListener("message", function (e) {
								if (e.data === "pong") return;
								try {
									const msg = JSON.parse(e.data);
									if (msg.type === "state") applyState(msg.state);
									else if (msg.type === "deleted") { msgEl.textContent = "✓ session deleted"; setWsStatus("deleted", "bg-red-500"); }
								} catch (err) { console.error("bad ws frame:", e.data, err); }
							});
							ws.addEventListener("close", function () {
								setWsStatus("disconnected — retrying", "bg-red-500");
								setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 10000);
							});
						}
						connect();
					})();
				</script>
			</main>`,
		),
	);
});

export { app as testSessionRoutes };
