import { Hono } from 'hono';
import { page } from '../lib/html';

const app = new Hono<{ Bindings: Env }>();

/**
 * Admin metrics page. Queries the Analytics Engine SQL API for event counts
 * over the last 24h. Requires the AE_API_TOKEN secret.
 * GET /admin/metrics
 */
app.get('/admin/metrics', async (c) => {
	const apiToken = c.env.AE_API_TOKEN;

	const noTokenHtml = `<main class="min-h-screen px-6 py-8 max-w-4xl mx-auto">
		<header class="flex items-center justify-between mb-8">
			<div>
				<div class="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-white/50">
					Booth admin
				</div>
				<h1 class="mt-1 text-2xl font-bold">Event metrics</h1>
			</div>
			<div class="flex items-center gap-4 text-xs text-white/50">
				<a href="/admin" class="text-cf-orange hover:text-white underline underline-offset-4">\u2190 Dashboard</a>
				<a href="/admin/events" class="text-cf-orange hover:text-white underline underline-offset-4">Events</a>
				<a href="/admin/logout" class="text-cf-orange hover:text-white underline underline-offset-4">Sign out</a>
			</div>
		</header>
		<div class="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
			<p class="text-white/60 mb-4">Analytics Engine querying requires an API token.</p>
			<p class="text-xs text-white/40">Run <code class="text-cf-orange">npx wrangler secret put AE_API_TOKEN</code> with a token that has <em>Account Analytics Read</em> permission.</p>
		</div>
	</main>`;

	if (!apiToken) {
		return c.html(page('Metrics \u2014 Admin', noTokenHtml));
	}

	return c.html(
		page(
			'Metrics \u2014 Admin',
			`<main class="min-h-screen px-6 py-8 max-w-4xl mx-auto">
				<header class="flex items-center justify-between mb-8">
					<div>
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-white/50">
							Booth admin
						</div>
						<h1 class="mt-1 text-2xl font-bold">Event metrics</h1>
						<p class="text-xs text-white/40 mt-1">Last 24 hours \u2014 from Analytics Engine</p>
					</div>
					<div class="flex items-center gap-4 text-xs text-white/50">
						<a href="/admin" class="text-cf-orange hover:text-white underline underline-offset-4">\u2190 Dashboard</a>
						<a href="/admin/events" class="text-cf-orange hover:text-white underline underline-offset-4">Events</a>
						<a href="/admin/logout" class="text-cf-orange hover:text-white underline underline-offset-4">Sign out</a>
					</div>
				</header>

				<section id="metrics-cards" class="mb-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
					<div class="col-span-full text-center text-white/40 py-8">Loading metrics\u2026</div>
				</section>

				<section class="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
					<div class="px-5 py-4 border-b border-white/5">
						<h2 class="text-sm font-semibold text-white/80">Events timeline (hourly)</h2>
					</div>
					<div id="metrics-timeline" class="p-5 min-h-[200px]">
						<div class="text-center text-white/40 py-8">Loading\u2026</div>
					</div>
				</section>

				<p id="metrics-updated" class="mt-4 text-center text-[11px] uppercase tracking-widest text-white/30"></p>
			</main>
			<script>
			(function () {
				var cardsEl = document.getElementById("metrics-cards");
				var timelineEl = document.getElementById("metrics-timeline");
				var updatedEl = document.getElementById("metrics-updated");

				function escapeHtml(s) {
					return String(s == null ? "" : s)
						.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
				}

				function renderCard(label, value, accent) {
					return '<div class="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">'
						+ '<div class="text-[10px] uppercase tracking-widest text-white/40">' + escapeHtml(label) + '</div>'
						+ '<div class="mt-1 text-2xl font-bold ' + (accent || "text-white") + '">' + escapeHtml(String(value)) + '</div>'
						+ '</div>';
				}

				function renderTimeline(rows) {
					if (!rows || rows.length === 0) {
						return '<div class="text-center text-white/40 py-8">No events in the last 24 hours.</div>';
					}
					var html = '<div class="overflow-x-auto"><table class="w-full text-xs">';
					html += '<thead class="text-left text-[10px] uppercase tracking-widest text-white/40"><tr>';
					html += '<th class="px-3 py-2 font-medium">Hour</th>';
					html += '<th class="px-3 py-2 font-medium text-right">Events</th>';
					html += '<th class="px-3 py-2 font-medium">Bar</th>';
					html += '</tr></thead><tbody class="divide-y divide-white/5">';
					var maxCount = Math.max.apply(null, rows.map(function (r) { return r.count; }));
					for (var i = 0; i < rows.length; i++) {
						var r = rows[i];
						var pct = maxCount > 0 ? Math.round((r.count / maxCount) * 100) : 0;
						html += '<tr class="hover:bg-white/[0.02]">';
						html += '<td class="px-3 py-2 text-white/60 whitespace-nowrap">' + escapeHtml(r.hour) + '</td>';
						html += '<td class="px-3 py-2 text-right font-mono text-white/80">' + r.count + '</td>';
						html += '<td class="px-3 py-2 w-full"><div class="h-4 rounded bg-cf-orange/30" style="width:' + pct + '%"></div></td>';
						html += '</tr>';
					}
					html += '</tbody></table></div>';
					return html;
				}

				async function loadMetrics() {
					try {
						var res = await fetch("/api/admin/metrics", { credentials: "same-origin" });
						if (res.status === 401) { window.location.href = "/admin/login"; return; }
						if (!res.ok) throw new Error("HTTP " + res.status);
						var data = await res.json();

						var counts = data.counts || {};
						cardsEl.innerHTML = ""
							+ renderCard("Sessions", counts["session.created"] || 0)
							+ renderCard("Completed", counts["workflow.done"] || 0, "text-emerald-300")
							+ renderCard("Errored", counts["workflow.errored"] || 0, "text-red-300")
							+ renderCard("Prints requested", counts["print.requested"] || 0)
							+ renderCard("Prints completed", counts["print.completed"] || 0, "text-emerald-300")
							+ renderCard("Prints failed", counts["print.failed"] || 0, "text-red-300")
							+ renderCard("Emails captured", counts["email.captured"] || 0, "text-cf-orange")
							+ renderCard("Sessions deleted", counts["session.deleted"] || 0);

						timelineEl.innerHTML = renderTimeline(data.timeline || []);
						updatedEl.textContent = "Updated " + new Date().toLocaleTimeString();
					} catch (err) {
						console.error("[metrics] load failed:", err);
						cardsEl.innerHTML = '<div class="col-span-full text-center text-red-400 py-4">Failed to load metrics: ' + escapeHtml(err.message) + '</div>';
					}
				}

				loadMetrics();
			})();
			</script>`,
		),
	);
});

export { app as adminMetricsRoutes };
