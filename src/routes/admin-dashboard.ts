import { Hono } from 'hono';
import { loadAdminSessions, loadAdminStats } from '../lib/admin-data';
import { page, escapeScriptJson } from '../lib/html';
import { renderAdminStatCards, renderAdminSceneBreakdown, renderAdminTableBody } from '../lib/admin-render';

const app = new Hono<{ Bindings: Env }>();

/**
 * Admin dashboard. Server-renders the initial sessions table; client polls
 * /api/admin/sessions + /api/admin/stats every 10s and re-renders.
 * GET /admin
 */
app.get('/admin', async (c) => {
	const [rows, stats] = await Promise.all([loadAdminSessions(c.env), loadAdminStats(c.env)]);
	const initialJson = JSON.stringify({ sessions: rows, stats });

	return c.html(
		page(
			'Admin dashboard',
			`<main class="min-h-screen px-6 py-8 max-w-6xl mx-auto">
				<header class="flex items-center justify-between mb-8">
					<div>
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-white/50">
							Booth admin
						</div>
						<h1 class="mt-1 text-2xl font-bold">Live sessions</h1>
					</div>
					<div class="flex items-center gap-4 text-xs text-white/50">
						<span id="admin-poll-indicator" class="inline-flex items-center gap-2">
							<span class="size-2 rounded-full bg-emerald-400 animate-pulse"></span>
							<span>Auto-refresh · 10s</span>
						</span>
						<a href="/admin/events" class="text-cf-orange hover:text-white underline underline-offset-4">Events</a>
						<a href="/admin/metrics" class="text-cf-orange hover:text-white underline underline-offset-4">Metrics</a>
						<a href="/admin/logout" class="text-cf-orange hover:text-white underline underline-offset-4">Sign out</a>
					</div>
				</header>

				<!-- Notyf toast library (loaded only on /admin) -->
				<link rel="stylesheet" href="https://unpkg.com/notyf@3.10.0/notyf.min.css" />
				<script src="https://unpkg.com/notyf@3.10.0/notyf.min.js"></script>
				<style>
					.notyf__toast { font-family: inherit; border-radius: 12px; }
					.notyf__toast--success { background: #f6821f; }
					.notyf__toast--error   { background: #ef4444; }
					.notyf__icon { background: transparent !important; }
					.notyf__icon-success, .notyf__icon-error {
						background: transparent !important;
						border-color: rgba(255,255,255,0.9) !important;
					}
					.notyf__icon-success::after, .notyf__icon-success::before,
					.notyf__icon-error::after,   .notyf__icon-error::before {
						background: #ffffff !important;
					}
					.notyf__message { font-weight: 500; }
				</style>

				<section id="admin-stats" class="mb-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
					${renderAdminStatCards(stats)}
				</section>

				<section class="mb-8 rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4">
					<div class="flex items-center justify-between mb-3">
						<h2 class="text-sm font-semibold text-white/80">Sessions by scene</h2>
						<span class="text-[11px] uppercase tracking-widest text-white/40">All-time</span>
					</div>
					<div id="admin-scene-breakdown" class="flex flex-wrap gap-2">
						${renderAdminSceneBreakdown(stats)}
					</div>
				</section>

				<section class="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead class="bg-white/5 text-left text-[11px] uppercase tracking-widest text-white/50">
								<tr>
									<th class="px-4 py-3 font-medium">Session</th>
									<th class="px-4 py-3 font-medium">Status</th>
									<th class="px-4 py-3 font-medium">Scene</th>
									<th class="px-4 py-3 font-medium">Created</th>
									<th class="px-4 py-3 font-medium">Duration</th>
									<th class="px-4 py-3 font-medium">Email</th>
									<th class="px-4 py-3 font-medium">Print</th>
									<th class="px-4 py-3 font-medium text-right">Actions</th>
								</tr>
							</thead>
							<tbody id="admin-tbody" class="divide-y divide-white/5">
								${renderAdminTableBody(rows)}
							</tbody>
						</table>
					</div>
					<div class="px-4 py-2 text-[11px] uppercase tracking-widest text-white/40 border-t border-white/5 flex items-center justify-between">
						<span><span id="admin-row-count">${rows.length}</span> sessions · last 30</span>
						<span id="admin-last-updated">Updated just now</span>
					</div>
				</section>
			</main>

			<script id="admin-initial" type="application/json">${escapeScriptJson(initialJson)}</script>
			<script>
			(function () {
				var initialEl = document.getElementById("admin-initial");
				var lastSnapshot = JSON.parse(initialEl.textContent || '{"sessions":[],"stats":null}');
				var tbody = document.getElementById("admin-tbody");
				var rowCount = document.getElementById("admin-row-count");
				var lastUpdated = document.getElementById("admin-last-updated");
				var statsEl = document.getElementById("admin-stats");
				var sceneEl = document.getElementById("admin-scene-breakdown");

				function escapeHtml(s) {
					return String(s == null ? "" : s)
						.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
						.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
				}

				function statusClass(s) {
					if (s === "completed") return "bg-emerald-500/20 text-emerald-300 ring-emerald-400/30";
					if (s === "errored")   return "bg-red-500/20 text-red-300 ring-red-400/30";
					if (!s || s === "pending") return "bg-white/10 text-white/60 ring-white/20";
					return "bg-amber-500/20 text-amber-300 ring-amber-400/30";
				}

				function printClass(s) {
					if (s === "printed")  return "bg-emerald-500/20 text-emerald-300 ring-emerald-400/30";
					if (s === "failed")   return "bg-red-500/20 text-red-300 ring-red-400/30";
					if (s === "printing") return "bg-cf-orange/20 text-cf-orange ring-cf-orange/30";
					if (s === "pending")  return "bg-amber-500/20 text-amber-300 ring-amber-400/30";
					return "bg-white/5 text-white/40 ring-white/10";
				}

				function fmtTs(secs) {
					if (!secs) return "—";
					var d = new Date(Number(secs) * 1000);
					return d.toLocaleString(undefined, {
						month: "short", day: "numeric",
						hour: "numeric", minute: "2-digit",
					});
				}

				function formatTimes() {
					var nodes = document.querySelectorAll("time[data-ts]");
					for (var i = 0; i < nodes.length; i++) {
						var n = nodes[i];
						var secs = Number(n.getAttribute("data-ts"));
						if (secs > 0) n.textContent = fmtTs(secs);
					}
				}

				function fmtDuration(ms) {
					if (ms == null) return "—";
					if (ms < 1000) return ms + " ms";
					var s = Math.round(ms / 1000);
					if (s < 60) return s + "s";
					var m = Math.floor(s / 60);
					return m + "m " + (s % 60) + "s";
				}

				function renderActions(r) {
					var buttons = [];
					var isCompleted = r.status === "completed" && !!r.postcardKey;
					if (isCompleted) {
						buttons.push(
							'<button type="button" data-action="retry-print" data-session="' + escapeHtml(r.sessionId) + '"'
							+ ' class="inline-flex items-center rounded-full border border-cf-orange/40 bg-cf-orange/10 px-3 py-1 text-xs text-cf-orange hover:bg-cf-orange/20 hover:border-cf-orange/60 disabled:opacity-50 disabled:cursor-not-allowed transition">🖨️ Retry print</button>'
						);
					}
					if (r.hasEmail && isCompleted) {
						buttons.push(
							'<button type="button" data-action="resend-email" data-session="' + escapeHtml(r.sessionId) + '"'
							+ ' class="inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-white/80 hover:border-white/30 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition">📧 Resend email</button>'
						);
					}
					buttons.push(
						'<button type="button" data-action="delete-session" data-session="' + escapeHtml(r.sessionId) + '"'
						+ ' class="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-400 hover:bg-red-500/20 hover:border-red-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition">🗑️ Delete</button>'
					);
					return '<div class="inline-flex items-center gap-1.5 justify-end">' + buttons.join("") + '</div>';
				}

				function renderTimeTag(secs) {
					if (!secs) return '<span class="text-white/40">—</span>';
					return '<time data-ts="' + Number(secs) + '" class="whitespace-nowrap">' + escapeHtml(fmtTs(secs)) + '</time>';
				}

				function renderRow(r) {
					var shortId = (r.sessionId || "").slice(0, 8);
					var status = r.status || "pending";
					var printStatus = r.printStatus || "—";
					return ''
						+ '<tr class="hover:bg-white/[0.03]">'
						+ '<td class="px-4 py-3 font-mono text-xs text-white/80">' + escapeHtml(shortId) + '</td>'
						+ '<td class="px-4 py-3"><span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ' + statusClass(status) + '">' + escapeHtml(status) + '</span></td>'
						+ '<td class="px-4 py-3 text-white/80">' + escapeHtml(r.sceneName || "—") + '</td>'
						+ '<td class="px-4 py-3 text-white/60 whitespace-nowrap">' + renderTimeTag(r.createdAt) + '</td>'
						+ '<td class="px-4 py-3 text-white/60 whitespace-nowrap">' + escapeHtml(fmtDuration(r.pipelineDurationMs)) + '</td>'
						+ '<td class="px-4 py-3 text-white/60">' + escapeHtml(r.emailMasked || "—") + '</td>'
						+ '<td class="px-4 py-3"><span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ' + printClass(r.printStatus) + '">' + escapeHtml(printStatus) + '</span></td>'
						+ '<td class="px-4 py-3 text-right whitespace-nowrap">' + renderActions(r) + '</td>'
						+ '</tr>';
				}

				function fmtAvg(secs) {
					if (secs == null) return "—";
					if (secs < 60) return secs.toFixed(1) + "s";
					var m = Math.floor(secs / 60);
					var s = Math.round(secs - m * 60);
					return m + "m " + s + "s";
				}

				function renderStatCard(label, value, accent) {
					var accentCls = accent || "text-white";
					return ''
						+ '<div class="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">'
						+ '<div class="text-[10px] uppercase tracking-widest text-white/40">' + escapeHtml(label) + '</div>'
						+ '<div class="mt-1 text-2xl font-bold ' + accentCls + '">' + escapeHtml(value) + '</div>'
						+ '</div>';
				}

				function renderStats(stats) {
					if (!stats) return;
					statsEl.innerHTML = ''
						+ renderStatCard("Total", String(stats.totalSessions))
						+ renderStatCard("Completed", String(stats.completed), "text-emerald-300")
						+ renderStatCard("Errored", String(stats.errored), "text-red-300")
						+ renderStatCard("Avg pipeline", fmtAvg(stats.avgPipelineSec))
						+ renderStatCard("Emails", String(stats.emailsCollected), "text-cf-orange")
						+ renderStatCard("Printed", String(stats.postcardsPrinted), "text-cf-orange");

					var scenes = stats.sceneBreakdown || [];
					if (scenes.length === 0) {
						sceneEl.innerHTML = '<span class="text-xs text-white/40">No scenes used yet.</span>';
					} else {
						sceneEl.innerHTML = scenes.map(function (s) {
							return '<span class="inline-flex items-center gap-2 rounded-full bg-white/[0.04] border border-white/10 px-3 py-1.5 text-xs">'
								+ '<span class="text-white/80">' + escapeHtml(s.sceneName) + '</span>'
								+ '<span class="text-white/40">·</span>'
								+ '<span class="font-mono text-cf-orange">' + s.count + '</span>'
								+ '</span>';
						}).join("");
					}
				}

				function renderSessions(sessions) {
					if (sessions.length === 0) {
						tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-white/40">No sessions yet.</td></tr>';
					} else {
						tbody.innerHTML = sessions.map(renderRow).join("");
					}
					rowCount.textContent = String(sessions.length);
				}

				function render(snapshot) {
					renderSessions(snapshot.sessions || []);
					if (snapshot.stats) renderStats(snapshot.stats);
					formatTimes();
					lastUpdated.textContent = "Updated " + new Date().toLocaleTimeString();
				}

				async function poll() {
					try {
						var results = await Promise.all([
							fetch("/api/admin/sessions", { credentials: "same-origin" }),
							fetch("/api/admin/stats",    { credentials: "same-origin" }),
						]);
						if (results[0].status === 401 || results[1].status === 401) {
							window.location.href = "/admin/login";
							return;
						}
						if (!results[0].ok || !results[1].ok) {
							throw new Error("HTTP " + results[0].status + "/" + results[1].status);
						}
						var sessionsBody = await results[0].json();
						var stats = await results[1].json();
						lastSnapshot = { sessions: sessionsBody.sessions, stats: stats };
						render(lastSnapshot);
					} catch (err) {
						console.error("[admin] poll failed:", err);
					}
				}

				var notyf = new Notyf({
					duration: 4000,
					position: { x: "right", y: "bottom" },
					dismissible: true,
					ripple: false,
				});
				function toast(msg, isError) {
					if (isError) notyf.error(msg);
					else         notyf.success(msg);
				}

				async function callJson(url, opts) {
					var r = await fetch(url, Object.assign({ credentials: "same-origin" }, opts || {}));
					if (r.status === 401) {
						window.location.href = "/admin/login";
						throw new Error("unauthorized");
					}
					var body = await r.json().catch(function () { return {}; });
					if (!r.ok) {
						var err = (body && body.error) ? body.error : ("HTTP " + r.status);
						throw new Error(err);
					}
					return body;
				}

				tbody.addEventListener("click", function (ev) {
					var btn = ev.target.closest && ev.target.closest("button[data-action]");
					if (!btn) return;
					var action = btn.getAttribute("data-action");
					var sessionId = btn.getAttribute("data-session");
					if (!sessionId) return;
					if (btn.disabled) return;
					btn.disabled = true;
					var shortId = sessionId.slice(0, 8);

					var promise;
					if (action === "retry-print") {
						promise = callJson("/api/admin/reprint/" + encodeURIComponent(sessionId), {
							method: "POST",
						}).then(function () {
							toast("Queued reprint for " + shortId);
							poll();
						});
					} else if (action === "resend-email") {
						promise = callJson("/api/admin/resend-email/" + encodeURIComponent(sessionId), {
							method: "POST",
						}).then(function () {
							toast("Resent email for " + shortId);
						});
					} else if (action === "delete-session") {
						if (!confirm("Permanently delete ALL data for session " + shortId + "...?" + "\\n\\n" + "This removes the selfie, caricature, postcard, print jobs, and email from our systems. Cannot be undone.")) {
							btn.disabled = false;
							return;
						}
						promise = callJson("/api/admin/session/" + encodeURIComponent(sessionId), {
							method: "DELETE",
						}).then(function (j) {
							toast("Deleted session " + shortId + " (" + (j.deleted || []).length + " items)");
							poll();
						});
					} else {
						btn.disabled = false;
						return;
					}

					promise.catch(function (err) {
						toast("Failed: " + err.message, true);
					}).finally(function () {
						btn.disabled = false;
					});
				});

				formatTimes();
				setInterval(poll, 10000);
			})();
			</script>`,
		),
	);
});

export { app as adminDashboardRoutes };
