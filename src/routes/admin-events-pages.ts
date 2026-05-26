import { Hono } from 'hono';
import { listEvents } from '../lib/event-ctx';
import { page, escapeAttr, escapeHtml } from '../lib/html';
import { adminEventNav, eventStatusPill } from '../lib/admin-render';

const app = new Hono<{ Bindings: Env }>();

/** Event list page — GET /admin/events */
app.get('/admin/events', async (c) => {
	const events = await listEvents(c.env);

	const countRows = await c.env.DB.prepare(`SELECT event_id, COUNT(*) as cnt FROM sessions GROUP BY event_id`).all<{
		event_id: string | null;
		cnt: number;
	}>();
	const counts = new Map(countRows.results.map((r) => [r.event_id, r.cnt]));

	const eventCards = events
		.map((ev) => {
			const cnt = counts.get(ev.id) ?? 0;
			const canDelete = ev.status === 'draft' && cnt === 0;
			return `<div class="px-4 py-3 hover:bg-white/[0.03] border-b border-white/5 last:border-b-0" data-event-card="${escapeAttr(ev.id)}">
				<div class="flex items-center gap-3 flex-wrap">
					<a href="/e/${escapeAttr(ev.id)}" target="_blank" rel="noopener"
						class="font-semibold text-sm text-white hover:text-cf-orange transition inline-flex items-center gap-1.5">
						${escapeHtml(ev.name)} <span class="text-xs">\u2197</span>
					</a>
					${eventStatusPill(ev.status)}
					<span class="hidden sm:inline font-mono text-xs text-white/40">${escapeHtml(ev.id)}</span>
					<span class="hidden sm:inline text-white/40 text-xs">\u00B7</span>
					<span class="hidden sm:inline text-white/50 text-xs">${cnt} session${cnt !== 1 ? 's' : ''}</span>
				</div>
				<div class="flex items-center gap-1.5 mt-2">
					<a href="/admin/events/${escapeAttr(ev.id)}" aria-label="Edit event" data-tooltip="Edit"
						class="inline-flex items-center gap-1 rounded-full border border-cf-orange/40 bg-cf-orange/10 px-2.5 sm:px-3 py-1 text-xs text-cf-orange hover:bg-cf-orange/20 transition">
						\u270E<span class="hidden sm:inline"> Edit</span>
					</a>
					<button type="button" data-action="clone-event" data-event-id="${escapeAttr(ev.id)}" aria-label="Clone event" data-tooltip="Clone"
						class="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2.5 sm:px-3 py-1 text-xs text-white/80 hover:border-white/30 transition">
						\u2398<span class="hidden sm:inline"> Clone</span>
					</button>
					${
						canDelete
							? `<button type="button" data-action="delete-event" data-event-id="${escapeAttr(ev.id)}" aria-label="Delete event" data-tooltip="Delete"
						class="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 sm:px-3 py-1 text-xs text-red-400 hover:bg-red-500/20 transition">
						\u2716<span class="hidden sm:inline"> Delete</span>
					</button>`
							: ''
					}
				</div>
			</div>`;
		})
		.join('');

	return c.html(
		page(
			'Events — Admin',
			`<main class="min-h-screen px-6 py-8 max-w-6xl mx-auto">
				${adminEventNav(`<h1 class="mt-1 text-2xl font-bold">Events</h1>`)}

				<link rel="stylesheet" href="https://unpkg.com/notyf@3.10.0/notyf.min.css" />
				<script src="https://unpkg.com/notyf@3.10.0/notyf.min.js"></script>
				<style>
					.notyf__toast { font-family: inherit; border-radius: 12px; }
					.notyf__toast--success { background: #f6821f; }
					.notyf__toast--error   { background: #ef4444; }
					.notyf__icon { background: transparent !important; }
					.notyf__icon-success, .notyf__icon-error { background: transparent !important; border-color: rgba(255,255,255,0.9) !important; }
					.notyf__icon-success::after, .notyf__icon-success::before,
					.notyf__icon-error::after,   .notyf__icon-error::before { background: #ffffff !important; }
					.notyf__message { font-weight: 500; }
				</style>

				<section class="mb-6 flex items-center justify-between">
					<p class="hidden sm:block text-sm text-white/50">${events.length} event${events.length !== 1 ? 's' : ''}</p>
					<a href="/admin/events/new"
						class="inline-flex items-center gap-2 rounded-full bg-cf-orange px-5 py-2 text-sm font-semibold text-black hover:bg-cf-orange-dark transition sm:ml-auto">
						+ Create event
					</a>
				</section>

				<section class="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
					${eventCards || `<div class="px-4 py-8 text-center text-white/40">No events yet.</div>`}
				</section>
			</main>
			<script>
			(function () {
				var notyf = new Notyf({ duration: 3000, position: { x: "right", y: "top" } });
				function toast(msg, isErr) { notyf[isErr ? "error" : "success"](msg); }

				document.addEventListener("click", function (e) {
					var btn = e.target.closest("[data-action]");
					if (!btn) return;
					var action = btn.getAttribute("data-action");
					var eventId = btn.getAttribute("data-event-id");

					if (action === "clone-event") {
						btn.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(eventId) + "/clone", { method: "POST", credentials: "same-origin" })
							.then(function (r) { return r.json(); })
							.then(function (j) {
								if (j.error) { toast(j.error, true); btn.disabled = false; return; }
								toast("Cloned as " + j.newEventId);
								setTimeout(function () { window.location.href = "/admin/events/" + encodeURIComponent(j.newEventId); }, 800);
							})
							.catch(function (err) { toast("Clone failed: " + err.message, true); btn.disabled = false; });
					}

					if (action === "delete-event") {
						if (!confirm("Delete event '" + eventId + "'? This cannot be undone.")) return;
						btn.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(eventId), { method: "DELETE", credentials: "same-origin" })
							.then(function (r) { return r.json(); })
							.then(function (j) {
								if (j.error) { toast(j.error, true); btn.disabled = false; return; }
								toast("Deleted");
								var card = document.querySelector('[data-event-card="' + eventId + '"]');
								if (card) card.remove();
							})
							.catch(function (err) { toast("Delete failed: " + err.message, true); btn.disabled = false; });
					}
				});
			})();
			</script>`,
		),
	);
});

/** Create event form — GET /admin/events/new */
app.get('/admin/events/new', (c) => {
	return c.html(
		page(
			'New event — Admin',
			`<main class="min-h-screen px-6 py-8 max-w-2xl mx-auto">
				${adminEventNav(`<h1 class="mt-1 text-2xl font-bold">Create event</h1>`)}

				<form id="create-form" class="space-y-4">
					<div>
						<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Name</label>
						<input name="name" type="text" required placeholder="NYC Tech Week 2026"
							class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cf-orange/50 focus:outline-none" />
					</div>
					<div>
						<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Slug (URL-safe ID)</label>
						<input name="id" type="text" required placeholder="nyc-tech-week-2026" pattern="[a-z0-9][a-z0-9\\-]{1,62}[a-z0-9]"
							class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white font-mono placeholder:text-white/30 focus:border-cf-orange/50 focus:outline-none" />
						<p class="mt-1 text-xs text-white/40">Lowercase letters, numbers, hyphens. 3–64 chars.</p>
					</div>
					<div>
						<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Status</label>
						<select name="status"
							class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none">
							<option value="draft">Draft</option>
							<option value="active">Active</option>
							<option value="archived">Archived</option>
						</select>
					</div>
					<button type="submit"
						class="inline-flex items-center gap-2 rounded-full bg-cf-orange px-6 py-3 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">
						Create event
					</button>
				</form>
			</main>
			<script>
			(function () {
				var form = document.getElementById("create-form");
				var nameInput = form.querySelector('[name="name"]');
				var slugInput = form.querySelector('[name="id"]');
				var slugEdited = false;

				slugInput.addEventListener("input", function () { slugEdited = true; });
				nameInput.addEventListener("input", function () {
					if (slugEdited) return;
					slugInput.value = nameInput.value
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.replace(/^-|-$/g, "")
						.slice(0, 64);
				});

				form.addEventListener("submit", function (e) {
					e.preventDefault();
					var btn = form.querySelector('button[type="submit"]');
					btn.disabled = true;
					var body = {
						id: slugInput.value,
						name: nameInput.value,
						status: form.querySelector('[name="status"]').value,
					};
					fetch("/api/admin/events", {
						method: "POST",
						credentials: "same-origin",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					})
						.then(function (r) { return r.json(); })
						.then(function (j) {
							if (j.error) { alert(j.error); btn.disabled = false; return; }
							window.location.href = "/admin/events/" + encodeURIComponent(j.id);
						})
						.catch(function (err) { alert("Failed: " + err.message); btn.disabled = false; });
				});
			})();
			</script>`,
		),
	);
});

export { app as adminEventsPagesRoutes };
