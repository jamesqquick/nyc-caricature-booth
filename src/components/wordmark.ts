/**
 * Render helpers for event branding.
 *
 * These emit HTML strings — not framework components — because the
 * worker server-renders everything as template literals.
 */

import type { EventRecord } from "../lib/types";

/** Escape a string for safe interpolation inside an HTML attribute value. */
const esc = (s: string): string =>
	s
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

/**
 * Large hero wordmark — the big visual at the top of landing / kiosk idle.
 *
 * If the event has a `wordmark_image_key`, renders an <img> from R2.
 * Otherwise falls back to the Cloudflare logo with the event's wordmark_text
 * displayed as styled spans around it (e.g. "I [logo] NY").
 *
 * `size` controls the scale:
 *   - "lg" = landing page hero (7xl–9xl)
 *   - "md" = gallery header / pickup page (4xl)
 */
export function renderHero(
	event: EventRecord,
	size: "lg" | "md" = "lg",
): string {
	if (event.wordmark_image_key) {
		const imgClass = size === "lg"
			? "h-24 md:h-36 w-auto"
			: "h-12 w-auto";
		return `<img src="/api/event-asset/${esc(event.id)}/wordmark" alt="${esc(event.name)}" class="${imgClass}" />`;
	}

	// Convention: wordmark_text uses "|" to mark where the brand image goes.
	// E.g. "I|NY" renders as: I [CF logo or uploaded PNG] NY.
	// The logo/image replaces the pipe. If no pipe, the logo sits before the text.
	const parts = event.wordmark_text.split("|");
	const left = parts[0]?.trim() ?? "";
	const right = parts[1]?.trim() ?? "";

	if (size === "lg") {
		if (right) {
			return `<div class="flex items-center gap-5 sm:gap-6 text-7xl md:text-9xl font-black leading-none">
				<span>${esc(left)}</span>
				<img src="/cloudflare-logo.png" alt="Cloudflare" class="h-20 md:h-28 w-auto drop-shadow-[0_0_24px_rgba(246,130,31,0.5)]" />
				<span>${esc(right)}</span>
			</div>`;
		}
		return `<div class="flex items-center gap-5 sm:gap-6 text-7xl md:text-9xl font-black leading-none">
			<img src="/cloudflare-logo.png" alt="Cloudflare" class="h-20 md:h-28 w-auto drop-shadow-[0_0_24px_rgba(246,130,31,0.5)]" />
			<span>${esc(left)}</span>
		</div>`;
	}

	// md size
	if (right) {
		return `<div class="flex items-center gap-4 text-4xl font-black leading-none">
			<span>${esc(left)}</span>
			<img src="/cloudflare-logo.png" alt="Cloudflare" class="display-glow h-10 w-auto" />
			<span>${esc(right)}</span>
		</div>`;
	}
	return `<div class="flex items-center gap-4 text-4xl font-black leading-none">
		<img src="/cloudflare-logo.png" alt="Cloudflare" class="display-glow h-10 w-auto" />
		<span>${esc(left)}</span>
	</div>`;
}

/**
 * Small inline wordmark for headers/labels (e.g. "I 🧡 NY · Caricature Booth").
 * Returns plain text — no logo image. The pipe "|" is replaced with " 🧡 "
 * to give a readable plain-text representation (e.g. "I|NY" → "I 🧡 NY").
 */
export function renderWordmarkText(event: EventRecord): string {
	return event.wordmark_text.replace("|", " 🧡 ");
}

/**
 * Compact header pill — logo + event name in a small row.
 * Used in landing page header, privacy header, etc.
 */
export function renderHeaderPill(event: EventRecord): string {
	return `<div class="flex items-center gap-2 text-xs sm:text-sm uppercase tracking-[0.25em] text-white/60">
		<img src="/cloudflare-logo.png" alt="" class="h-5 w-5" />
		<span>Cloudflare &middot; ${esc(event.name)}</span>
	</div>`;
}

/**
 * Scene option list HTML for <select> elements.
 * Generates <option> tags from the event's scenes.
 */
export function renderSceneOptions(
	scenes: Array<{ id: string; emoji: string; name: string }>,
	defaultId?: string,
): string {
	return scenes
		.map((s) => {
			const selected = s.id === defaultId ? " selected" : "";
			return `<option value="${esc(s.id)}"${selected}>${s.emoji} ${esc(s.name)}</option>`;
		})
		.join("\n");
}
