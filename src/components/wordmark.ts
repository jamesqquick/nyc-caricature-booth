/**
 * Render helpers for event branding.
 *
 * These emit HTML strings — not framework components — because the
 * worker server-renders everything as template literals.
 */

/** Escape a string for safe interpolation inside an HTML attribute value. */
const esc = (s: string): string =>
	s
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

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
