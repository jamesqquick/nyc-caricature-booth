import { Hono } from 'hono';
import { listEvents } from '../lib/event-ctx';
import { page, escapeAttr } from '../lib/html';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
	const events = await listEvents(c.env);
	const activeEvents = events.filter((e) => e.status === 'active');

	if (activeEvents.length === 1) {
		// Single active event — redirect straight to it
		return c.redirect(`/e/${activeEvents[0].id}`, 302);
	}

	const cards =
		activeEvents.length === 0
			? `<p class="text-white/60 text-center py-12">No active events right now.</p>`
			: activeEvents
					.map(
						(e) => `<a href="/e/${escapeAttr(e.id)}" class="block rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/30 transition p-6">
			<div class="text-xl font-bold">${escapeAttr(e.name)}</div>
			<p class="mt-2 text-sm text-white/60">${escapeAttr(e.tagline)}</p>
		</a>`,
					)
					.join('\n');

	return c.html(
		page(
			'AI Caricature Booth',
			`<main class="max-w-2xl mx-auto px-6 py-16">
				<h1 class="text-4xl font-bold text-center mb-2">AI Caricature Booth</h1>
				<p class="text-center text-white/60 mb-12">Pick an event to get started.</p>
				<div class="flex flex-col gap-4">${cards}</div>
				<footer class="mt-16 text-center text-[11px] uppercase tracking-[0.25em] text-white/30">
					Built end-to-end on Cloudflare
				</footer>
			</main>`,
		),
	);
});

export { app as rootRoutes };
