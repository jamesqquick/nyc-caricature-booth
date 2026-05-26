/**
 * Small cross-cutting helpers shared across route files.
 */

import type { Context } from 'hono';
import { page } from './html';

// ---------------------------------------------------------------------------
// Session ID validation
// ---------------------------------------------------------------------------

export const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export const VALID_SESSION_STATUSES = ['queued', 'moderating', 'generating', 'compositing', 'done', 'errored'] as const;
export type SessionStatusName = (typeof VALID_SESSION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Session Durable Object
// ---------------------------------------------------------------------------

export function getSessionStub(env: Env, sessionId: string) {
	const id = env.SESSION.idFromName(sessionId);
	return env.SESSION.get(id);
}

// ---------------------------------------------------------------------------
// Branded 404 for /p/* routes
// ---------------------------------------------------------------------------

export function brandedPostcardNotFound(c: Context<any>, id?: string, emptyEmoji = '🎨') {
	const idPreview = id ? id.slice(0, 8) : '';
	const previewHtml = idPreview
		? `<p class="text-white/60 mb-2">No session matches <code class="text-cf-orange">${idPreview}…</code></p>`
		: `<p class="text-white/60 mb-2">No postcard at this address.</p>`;

	c.status(404);
	return c.html(
		page(
			'Postcard not found',
			`<main class="min-h-screen flex flex-col items-center justify-center px-6 py-12">
				<div class="text-center max-w-xl">
					<div class="text-6xl mb-6">${emptyEmoji}</div>
					<h1 class="text-3xl font-bold mb-3">We couldn't find that postcard</h1>
					${previewHtml}
					<p class="text-white/50 text-sm">
						If you just scanned a QR from a printed postcard, double-check the link.
						Sessions older than the event window may have been cleaned up.
					</p>
					<a href="/" class="mt-10 inline-block rounded-full bg-cf-orange px-6 py-3 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">
						See what we built
					</a>
				</div>
			</main>`,
		),
	);
}
