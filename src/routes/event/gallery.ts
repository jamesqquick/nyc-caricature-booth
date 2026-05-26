import { Hono } from 'hono';
import type { EventEnv } from '../../lib/types';
import { page, escapeAttr } from '../../lib/html';

const app = new Hono<EventEnv>();

/**
 * Big-screen gallery — last 8 completed postcards, polls every 30s.
 * GET /gallery
 */
app.get('/gallery', async (c) => {
	const { event } = c.get('eventCtx');
	const basePath = c.get('basePath');
	const { results } = await c.env.DB.prepare(
		`SELECT id, scene_name, postcard_key, completed_at
		 FROM sessions
		 WHERE event_id = ? AND status = 'completed' AND postcard_key IS NOT NULL
		 ORDER BY completed_at DESC
		 LIMIT 8`,
	)
		.bind(event.id)
		.all<{ id: string; scene_name: string | null; postcard_key: string; completed_at: number | null }>();

	const now = Math.floor(Date.now() / 1000);
	const formatAge = (completedAt: number | null): string => {
		if (!completedAt) return 'just now';
		const diff = Math.max(0, now - completedAt);
		if (diff < 60) return 'just now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		return `${Math.floor(diff / 86400)}d ago`;
	};

	const cards = results
		.map((row) => {
			const sceneName = row.scene_name ?? 'Untitled scene';
			const age = formatAge(row.completed_at);
			const imgUrl = `${basePath}/api/run-img?key=${encodeURIComponent(row.postcard_key)}`;
			return `<article class="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_24px_rgba(0,0,0,0.4)]">
				<div class="aspect-[3/2] w-full overflow-hidden bg-black">
					<img src="${imgUrl}" alt="${sceneName} postcard" class="h-full w-full object-cover" loading="lazy" />
				</div>
				<div class="flex items-center justify-between px-4 py-3">
					<div class="text-base font-semibold">${sceneName}</div>
					<div class="text-xs uppercase tracking-widest text-white/50">${age}</div>
				</div>
			</article>`;
		})
		.join('');

	const empty = `<div class="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] py-24 text-center">
		<div class="text-5xl">🎨</div>
		<p class="mt-4 text-lg text-white/70">No postcards yet — be the first!</p>
		<p class="mt-1 text-sm text-white/40">Walk over to the iPad to get started.</p>
	</div>`;

	const origin = new URL(c.req.url).origin;
	const qrTarget = `${origin}${basePath}/kiosk`;

	return c.html(
		page(
			`${event.name} — Gallery`,
			`<div class="display-shimmer fixed inset-0 pointer-events-none" aria-hidden="true"></div>
			<header class="relative px-12 pt-10 pb-8 flex items-center justify-between">
				<div class="text-lg font-bold uppercase tracking-widest text-white/80">
					${escapeAttr(event.name)}
				</div>
				<img src="${basePath}/api/kiosk/qr?url=${encodeURIComponent(qrTarget)}" alt="QR code — scan to start" class="h-24 w-24 rounded" />
			</header>
			<main class="relative px-12 pb-12">
				<div class="mb-8 flex items-end justify-between">
					<div>
						<h1 class="text-5xl md:text-6xl font-black tracking-tight">Fresh from the booth</h1>
						<p class="mt-3 text-lg text-white/60">AI caricature postcards, generated live on Cloudflare.</p>
					</div>
					<a href="${basePath}/kiosk" class="hidden md:inline-flex items-center gap-2 rounded-full bg-cf-orange px-6 py-3 text-base font-semibold text-black hover:bg-cf-orange-dark transition">
						Create yours now
					</a>
				</div>
				<section id="gallery" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
					${results.length === 0 ? empty : cards}
				</section>
			</main>
			<footer class="relative px-12 py-8 flex items-center justify-center border-t border-white/5">
				<div class="inline-flex items-center gap-3 rounded-full border border-cf-orange/30 bg-cf-orange/10 px-5 py-2.5 text-sm font-medium text-cf-orange">
					<img src="/cloudflare-logo.png" alt="" class="h-5 w-auto" />
					<span>Built end-to-end on Cloudflare</span>
				</div>
			</footer>
			<script>
			(function () {
				var basePath = ${JSON.stringify(basePath)};
				var POLL_INTERVAL = 30000;
				var gallery = document.getElementById("gallery");
				var currentIds = ${JSON.stringify(results.map((r) => r.id))};

				function formatAge(completedAt) {
					if (!completedAt) return "just now";
					var diff = Math.max(0, Math.floor(Date.now() / 1000) - completedAt);
					if (diff < 60) return "just now";
					if (diff < 3600) return Math.floor(diff / 60) + "m ago";
					if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
					return Math.floor(diff / 86400) + "d ago";
				}

				function buildCard(s) {
					var name = s.sceneName || "Untitled scene";
					var imgUrl = basePath + "/api/run-img?key=" + encodeURIComponent(s.postcardKey);
					return '<article class="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_24px_rgba(0,0,0,0.4)]">'
						+ '<div class="aspect-[3/2] w-full overflow-hidden bg-black">'
						+ '<img src="' + imgUrl + '" alt="' + name + ' postcard" class="h-full w-full object-cover" loading="lazy" />'
						+ '</div>'
						+ '<div class="flex items-center justify-between px-4 py-3">'
						+ '<div class="text-base font-semibold">' + name + '</div>'
						+ '<div class="text-xs uppercase tracking-widest text-white/50">' + formatAge(s.completedAt) + '</div>'
						+ '</div></article>';
				}

				function buildEmpty() {
					return '<div class="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] py-24 text-center">'
						+ '<div class="text-5xl">🎨</div>'
						+ '<p class="mt-4 text-lg text-white/70">No postcards yet — be the first!</p>'
						+ '<p class="mt-1 text-sm text-white/40">Walk over to the iPad to get started.</p>'
						+ '</div>';
				}

				async function poll() {
					try {
						var res = await fetch(basePath + "/api/gallery/feed");
						if (!res.ok) return;
						var data = await res.json();
						var sessions = data.sessions || [];
						var newIds = sessions.map(function (s) { return s.sessionId; });
						if (JSON.stringify(newIds) === JSON.stringify(currentIds)) return;
						currentIds = newIds;
						gallery.innerHTML = sessions.length === 0 ? buildEmpty() : sessions.map(buildCard).join("");
					} catch (e) {}
				}

				setInterval(poll, POLL_INTERVAL);
			})();
			</script>`,
		),
	);
});

/**
 * JSON feed of last 8 completed sessions for the gallery polling loop.
 * GET /api/gallery/feed
 */
app.get('/api/gallery/feed', async (c) => {
	const { event } = c.get('eventCtx');
	const { results } = await c.env.DB.prepare(
		`SELECT id, scene_id, scene_name, postcard_key, completed_at
		 FROM sessions
		 WHERE event_id = ? AND status = 'completed' AND postcard_key IS NOT NULL
		 ORDER BY completed_at DESC
		 LIMIT 8`,
	)
		.bind(event.id)
		.all<{ id: string; scene_id: string | null; scene_name: string | null; postcard_key: string; completed_at: number | null }>();

	return c.json({
		sessions: results.map((r) => ({
			sessionId: r.id,
			sceneId: r.scene_id,
			sceneName: r.scene_name,
			postcardKey: r.postcard_key,
			completedAt: r.completed_at,
		})),
	});
});

export { app as galleryRoutes };
