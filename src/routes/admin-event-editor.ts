import { Hono } from 'hono';
import { loadEvent, loadAllScenes } from '../lib/event-ctx';
import { page, escapeAttr, escapeHtml, escapeScriptJson } from '../lib/html';
import { adminEventNav, eventStatusPill } from '../lib/admin-render';

const app = new Hono<{ Bindings: Env }>();

/**
 * Tabbed event editor — Settings, Branding, Copy, Scenes, Prompts.
 * GET /admin/events/:eventId
 */
app.get('/admin/events/:eventId', async (c) => {
	const eventId = c.req.param('eventId');
	const ev = await loadEvent(c.env, eventId);
	if (!ev) {
		return c.html(
			page('Not found', `<main class="min-h-screen flex items-center justify-center"><p class="text-white/60">Event not found.</p></main>`),
			404,
		);
	}
	const scenes = await loadAllScenes(c.env, eventId);

	const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM sessions WHERE event_id = ?`).bind(eventId).first<{ cnt: number }>();
	const sessionCount = countRow?.cnt ?? 0;
	const canDelete = ev.status === 'draft' && sessionCount === 0;

	const scenesJson = escapeScriptJson(JSON.stringify(scenes));

	return c.html(
		page(
			`${ev.name} — Admin`,
			`<main class="min-h-screen px-6 py-8 max-w-4xl mx-auto">
				${adminEventNav(`
					<div class="flex items-center gap-2 mt-1">
						<a href="/admin/events" class="text-cf-orange hover:text-white text-sm">\u2190 Events</a>
						<span class="text-white/30">/</span>
						<h1 class="text-2xl font-bold">${escapeHtml(ev.name)}</h1>
						${eventStatusPill(ev.status)}
					</div>
				`)}

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

				<!-- Tabs -->
				<nav class="flex gap-1 mb-6 border-b border-white/10 pb-px">
					<button data-tab="settings" class="tab-btn px-4 py-2 text-sm rounded-t-lg border border-transparent -mb-px transition">Settings</button>
					<button data-tab="branding" class="tab-btn px-4 py-2 text-sm rounded-t-lg border border-transparent -mb-px transition">Branding</button>
					<button data-tab="copy" class="tab-btn px-4 py-2 text-sm rounded-t-lg border border-transparent -mb-px transition">Copy</button>
					<button data-tab="scenes" class="tab-btn px-4 py-2 text-sm rounded-t-lg border border-transparent -mb-px transition">Scenes</button>
					<button data-tab="prompts" class="tab-btn px-4 py-2 text-sm rounded-t-lg border border-transparent -mb-px transition">Prompts</button>
				</nav>

				<!-- Tab: Settings -->
				<section data-panel="settings" class="tab-panel hidden">
					<form id="settings-form" class="space-y-6 max-w-xl">
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Slug</label>
							<input name="id" type="text" value="${escapeAttr(ev.id)}" pattern="[a-z0-9][a-z0-9\\-]{1,62}[a-z0-9]"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white font-mono focus:border-cf-orange/50 focus:outline-none" />
							<p class="mt-1 text-xs text-white/40">Changing the slug changes all URLs for this event.</p>
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Name</label>
							<input name="name" type="text" value="${escapeAttr(ev.name)}" required
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none" />
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Status</label>
							<select name="status"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none">
								<option value="draft" ${ev.status === 'draft' ? 'selected' : ''}>Draft</option>
								<option value="active" ${ev.status === 'active' ? 'selected' : ''}>Active</option>
								<option value="archived" ${ev.status === 'archived' ? 'selected' : ''}>Archived</option>
							</select>
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Timezone</label>
							<input name="timezone" type="text" value="${escapeAttr(ev.timezone)}"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none" />
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Privacy email</label>
							<input name="privacy_email" type="email" value="${escapeAttr(ev.privacy_email)}"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none" />
						</div>
						<button type="submit" class="rounded-full bg-cf-orange px-6 py-2.5 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">Save settings</button>
					</form>
					${
						canDelete
							? `
					<div class="mt-12 pt-8 border-t border-red-500/20">
						<h3 class="text-sm font-semibold text-red-400 mb-2">Danger zone</h3>
						<p class="text-xs text-white/50 mb-3">This event is a draft with no sessions. Deleting it is permanent.</p>
						<button type="button" id="delete-event-btn"
							class="rounded-full border border-red-500/40 bg-red-500/10 px-5 py-2 text-sm text-red-400 hover:bg-red-500/20 transition">
							Delete event
						</button>
					</div>`
							: ''
					}
				</section>

				<!-- Tab: Branding -->
				<section data-panel="branding" class="tab-panel hidden">
					<div class="flex flex-col xl:flex-row xl:items-start gap-8">
						<!-- Left column: watermark controls -->
						<div class="space-y-8 xl:w-1/2">
							<div>
								<label class="block text-xs uppercase tracking-widest text-white/50 mb-2">Bottom-right watermark (PNG)</label>
								<p class="text-xs text-white/40 mb-3">Composited onto the bottom-right corner of every postcard. Nothing is shown if not set.</p>
								<div id="watermark-preview" class="mb-3">
									${
										ev.watermark_image_key
											? `<div class="inline-flex items-center gap-3 rounded-lg bg-white/5 border border-white/10 p-3">
											<img src="/api/admin/events/${escapeAttr(ev.id)}/watermark" alt="watermark" class="h-12" />
											<button type="button" id="remove-watermark-btn" class="text-xs text-red-400 hover:text-red-300 underline">Remove</button>
										</div>`
											: `<p class="text-xs text-white/40 italic">No watermark set.</p>`
									}
								</div>
								${
									ev.watermark_image_key
										? `<div class="mb-3">
										<label class="block text-xs text-white/50 mb-1">Width</label>
										<div class="flex items-center gap-3">
											<input type="range" id="wm-right-slider" min="100" max="900" step="10" value="${ev.watermark_w ?? 540}"
												class="w-48 accent-cf-orange" />
											<span id="wm-right-label" class="text-xs text-white/60 font-mono w-36">${ev.watermark_w ?? 540}px · ${Math.round(((ev.watermark_w ?? 540) / 1800) * 100)}%</span>
										</div>
									</div>`
										: ''
								}
								<form id="watermark-form" enctype="multipart/form-data" class="flex items-center gap-3">
									<input type="file" name="file" accept="image/png" class="text-xs text-white/60 file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-xs file:text-white/80 file:cursor-pointer hover:file:bg-white/15" />
									<button type="submit" class="rounded-full bg-cf-orange px-4 py-2 text-xs font-semibold text-black hover:bg-cf-orange-dark transition">Upload</button>
								</form>
							</div>

							<div>
								<label class="block text-xs uppercase tracking-widest text-white/50 mb-2">Bottom-left watermark (PNG)</label>
								<p class="text-xs text-white/40 mb-3">Composited onto the bottom-left corner of every postcard. Nothing is shown if not set.</p>
								<div id="watermark-left-preview" class="mb-3">
									${
										ev.watermark_image_key_left
											? `<div class="inline-flex items-center gap-3 rounded-lg bg-white/5 border border-white/10 p-3">
											<img src="/api/admin/events/${escapeAttr(ev.id)}/watermark-left" alt="watermark left" class="h-12" />
											<button type="button" id="remove-watermark-left-btn" class="text-xs text-red-400 hover:text-red-300 underline">Remove</button>
										</div>`
											: `<p class="text-xs text-white/40 italic">No watermark set.</p>`
									}
								</div>
								${
									ev.watermark_image_key_left
										? `<div class="mb-3">
										<label class="block text-xs text-white/50 mb-1">Width</label>
										<div class="flex items-center gap-3">
											<input type="range" id="wm-left-slider" min="100" max="900" step="10" value="${ev.watermark_left_w ?? 540}"
												class="w-48 accent-cf-orange" />
											<span id="wm-left-label" class="text-xs text-white/60 font-mono w-36">${ev.watermark_left_w ?? 540}px · ${Math.round(((ev.watermark_left_w ?? 540) / 1800) * 100)}%</span>
										</div>
									</div>`
										: ''
								}
								<form id="watermark-left-form" enctype="multipart/form-data" class="flex items-center gap-3">
									<input type="file" name="file" accept="image/png" class="text-xs text-white/60 file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-xs file:text-white/80 file:cursor-pointer hover:file:bg-white/15" />
									<button type="submit" class="rounded-full bg-cf-orange px-4 py-2 text-xs font-semibold text-black hover:bg-cf-orange-dark transition">Upload</button>
								</form>
							</div>
						</div>

						<!-- Right column: postcard preview (sticky on xl) -->
						<div class="xl:sticky xl:top-4 xl:w-1/2 min-w-0">
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-2">Postcard preview</label>
							<p class="text-xs text-white/40 mb-3">Approximate layout — actual postcard is 1800×1200 px.${ev.watermark_image_key || ev.watermark_image_key_left ? ' Drag the sliders to resize.' : ' Upload watermarks to see them here.'}</p>
							<div id="postcard-preview" style="position:relative;aspect-ratio:3/2;overflow:hidden;border-radius:0.5rem;border:1px solid rgba(255,255,255,0.1);background-color:#e5e7eb;background-image:repeating-conic-gradient(#d1d5db 0% 25%,#e5e7eb 0% 50%);background-size:16px 16px;">
								${
									ev.watermark_image_key
										? `<img id="preview-wm-right" src="/api/admin/events/${escapeAttr(ev.id)}/watermark"
											style="position:absolute;bottom:${((56 / 1200) * 100).toFixed(2)}%;right:${((56 / 1800) * 100).toFixed(2)}%;width:${(((ev.watermark_w ?? 540) / 1800) * 100).toFixed(2)}%;opacity:0.95;" />`
										: ''
								}
								${
									ev.watermark_image_key_left
										? `<img id="preview-wm-left" src="/api/admin/events/${escapeAttr(ev.id)}/watermark-left"
											style="position:absolute;bottom:${((56 / 1200) * 100).toFixed(2)}%;left:${((56 / 1800) * 100).toFixed(2)}%;width:${(((ev.watermark_left_w ?? 540) / 1800) * 100).toFixed(2)}%;opacity:0.95;" />`
										: ''
								}
							</div>
						</div>
					</div>

					<!-- Accent color: always full width below -->
					<div class="mt-8 max-w-xl">
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Accent color</label>
							<div class="flex items-center gap-3">
								<input id="accent-color-input" name="accent_color" type="text" value="${escapeAttr(ev.accent_color)}" placeholder="#f6821f"
									class="w-40 rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white font-mono focus:border-cf-orange/50 focus:outline-none" />
								<div id="color-swatch" class="size-10 rounded-lg border border-white/10" style="background:${escapeAttr(ev.accent_color)}"></div>
							</div>
						</div>
					</div>
				</section>

				<!-- Tab: Copy -->
				<section data-panel="copy" class="tab-panel hidden">
					<form id="copy-form" class="space-y-6 max-w-xl">
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Tagline</label>
							<p class="text-xs text-white/40 mb-2">Shown on the event landing page below the title.</p>
							<input name="tagline" type="text" value="${escapeAttr(ev.tagline)}"
								placeholder="Take a selfie, pick a scene, walk away with a printed postcard."
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cf-orange/50 focus:outline-none" />
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Kiosk idle subhead</label>
							<p class="text-xs text-white/40 mb-2">Shown on the kiosk idle screen below the main heading.</p>
							<input name="kiosk_idle_subhead" type="text" value="${escapeAttr(ev.kiosk_idle_subhead)}"
								placeholder="Cloudflare Kiosk \u00B7 For more information on Cloudflare, visit cloudflare.com"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cf-orange/50 focus:outline-none" />
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Scene picker heading</label>
							<p class="text-xs text-white/40 mb-2">Heading above the scene picker cards in the kiosk flow.</p>
							<input name="scene_picker_heading" type="text" value="${escapeAttr(ev.scene_picker_heading)}"
								placeholder="Pick your scene"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cf-orange/50 focus:outline-none" />
						</div>
						<button type="submit" class="rounded-full bg-cf-orange px-6 py-2.5 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">Save copy</button>
					</form>
				</section>

				<!-- Tab: Scenes -->
				<section data-panel="scenes" class="tab-panel hidden">
					<div id="scenes-container" class="space-y-3"></div>
					<button type="button" id="add-scene-btn"
						class="mt-4 inline-flex items-center gap-2 rounded-full bg-cf-orange px-5 py-2.5 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">
						+ Add scene
					</button>
				</section>

				<!-- Tab: Prompts -->
				<section data-panel="prompts" class="tab-panel hidden">
					<form id="prompts-form" class="space-y-6 max-w-xl">
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Style preamble</label>
							<p class="text-xs text-white/40 mb-2">Prepended to every scene prompt. Describe the overall art style.</p>
							<textarea name="scene_style_preamble" rows="4"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none">${escapeHtml(ev.scene_style_preamble ?? '')}</textarea>
						</div>
						<div>
							<label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Constraints</label>
							<p class="text-xs text-white/40 mb-2">Appended to every scene prompt. Negative constraints, safety rules, etc.</p>
							<textarea name="scene_constraints" rows="4"
								class="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white focus:border-cf-orange/50 focus:outline-none">${escapeHtml(ev.scene_constraints ?? '')}</textarea>
						</div>
						<button type="submit" class="rounded-full bg-cf-orange px-6 py-2.5 text-sm font-semibold text-black hover:bg-cf-orange-dark transition">Save prompts</button>
					</form>
				</section>
			</main>

			<script id="scenes-data" type="application/json">${scenesJson}</script>
			<script>
			(function () {
				var EVENT_ID = ${JSON.stringify(ev.id)};
				var notyf = new Notyf({ duration: 3000, position: { x: "right", y: "top" } });
				function toast(msg, isErr) { notyf[isErr ? "error" : "success"](msg); }

				// ---- Tabs ----
				var tabs = document.querySelectorAll(".tab-btn");
				var panels = document.querySelectorAll(".tab-panel");
				function activateTab(name) {
					tabs.forEach(function (t) {
						var active = t.getAttribute("data-tab") === name;
						t.className = "tab-btn px-4 py-2 text-sm rounded-t-lg border -mb-px transition " +
							(active ? "border-white/10 border-b-cf-ink bg-cf-ink text-white" : "border-transparent text-white/50 hover:text-white/80");
					});
					panels.forEach(function (p) {
						p.classList.toggle("hidden", p.getAttribute("data-panel") !== name);
					});
					history.replaceState(null, "", "#" + name);
				}
				tabs.forEach(function (t) {
					t.addEventListener("click", function () { activateTab(t.getAttribute("data-tab")); });
				});
				activateTab(location.hash.slice(1) || "settings");

				// ---- Generic save helper ----
				function saveFields(fields) {
					return fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID), {
						method: "PUT",
						credentials: "same-origin",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(fields),
					}).then(function (r) { return r.json(); })
					.then(function (j) {
						if (j.error) throw new Error(j.error);
						if (fields.id && fields.id !== EVENT_ID) {
							window.location.href = "/admin/events/" + encodeURIComponent(fields.id);
							return;
						}
						toast("Saved");
					});
				}

				// ---- Settings form ----
				document.getElementById("settings-form").addEventListener("submit", function (e) {
					e.preventDefault();
					var f = e.target;
					saveFields({
						id: f.querySelector('[name="id"]').value,
						name: f.querySelector('[name="name"]').value,
						status: f.querySelector('[name="status"]').value,
						timezone: f.querySelector('[name="timezone"]').value,
						privacy_email: f.querySelector('[name="privacy_email"]').value,
					}).catch(function (err) { toast(err.message, true); });
				});

				// ---- Delete event ----
				var delBtn = document.getElementById("delete-event-btn");
				if (delBtn) {
					delBtn.addEventListener("click", function () {
						if (!confirm("Permanently delete this event?")) return;
						delBtn.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID), { method: "DELETE", credentials: "same-origin" })
							.then(function (r) { return r.json(); })
							.then(function (j) {
								if (j.error) { toast(j.error, true); delBtn.disabled = false; return; }
								window.location.href = "/admin/events";
							})
							.catch(function (err) { toast(err.message, true); delBtn.disabled = false; });
					});
				}

				// ---- Accent color: live swatch + auto-save on blur ----
				var accentInput = document.getElementById("accent-color-input");
				var swatch = document.getElementById("color-swatch");
				if (accentInput && swatch) {
					accentInput.addEventListener("input", function () { swatch.style.background = accentInput.value; });
					accentInput.addEventListener("change", function () {
						saveFields({ accent_color: accentInput.value })
							.catch(function (err) { toast(err.message, true); });
					});
				}

				// ---- Watermark upload (right) ----
				document.getElementById("watermark-form").addEventListener("submit", function (e) {
					e.preventDefault();
					var form = e.target;
					var fd = new FormData(form);
					if (!fd.get("file") || !fd.get("file").size) { toast("Select a PNG file", true); return; }
					fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/watermark", {
						method: "POST", credentials: "same-origin", body: fd,
					}).then(function (r) { return r.json(); })
					.then(function (j) {
						if (j.error) { toast(j.error, true); return; }
						toast("Watermark uploaded");
						setTimeout(function () { location.reload(); }, 600);
					}).catch(function (err) { toast(err.message, true); });
				});

				// ---- Remove watermark (right) ----
				var rmWm = document.getElementById("remove-watermark-btn");
				if (rmWm) {
					rmWm.addEventListener("click", function () {
						rmWm.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/watermark", { method: "DELETE", credentials: "same-origin" })
							.then(function (r) { return r.json(); })
							.then(function (j) {
								if (j.error) { toast(j.error, true); rmWm.disabled = false; return; }
								toast("Watermark removed");
								setTimeout(function () { location.reload(); }, 600);
							}).catch(function (err) { toast(err.message, true); rmWm.disabled = false; });
					});
				}

				// ---- Watermark upload (left) ----
				document.getElementById("watermark-left-form").addEventListener("submit", function (e) {
					e.preventDefault();
					var form = e.target;
					var fd = new FormData(form);
					if (!fd.get("file") || !fd.get("file").size) { toast("Select a PNG file", true); return; }
					fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/watermark-left", {
						method: "POST", credentials: "same-origin", body: fd,
					}).then(function (r) { return r.json(); })
					.then(function (j) {
						if (j.error) { toast(j.error, true); return; }
						toast("Left watermark uploaded");
						setTimeout(function () { location.reload(); }, 600);
					}).catch(function (err) { toast(err.message, true); });
				});

				// ---- Remove watermark (left) ----
				var rmWmL = document.getElementById("remove-watermark-left-btn");
				if (rmWmL) {
					rmWmL.addEventListener("click", function () {
						rmWmL.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/watermark-left", { method: "DELETE", credentials: "same-origin" })
							.then(function (r) { return r.json(); })
							.then(function (j) {
								if (j.error) { toast(j.error, true); rmWmL.disabled = false; return; }
								toast("Left watermark removed");
								setTimeout(function () { location.reload(); }, 600);
							}).catch(function (err) { toast(err.message, true); rmWmL.disabled = false; });
					});
				}

				// ---- Watermark size sliders + preview ----
				var POSTCARD_W = 1800;
				var previewRight = document.getElementById("preview-wm-right");
				var previewLeft = document.getElementById("preview-wm-left");
				var wmRightSlider = document.getElementById("wm-right-slider");
				var wmLeftSlider = document.getElementById("wm-left-slider");
				var wmRightLabel = document.getElementById("wm-right-label");
				var wmLeftLabel = document.getElementById("wm-left-label");
				function wmLabel(px) {
					return px + "px \u00B7 " + Math.round((px / POSTCARD_W) * 100) + "%";
				}

				if (wmRightSlider) {
					wmRightSlider.addEventListener("input", function () {
						var v = Number(wmRightSlider.value);
						if (wmRightLabel) wmRightLabel.textContent = wmLabel(v);
						if (previewRight) previewRight.style.width = ((v / POSTCARD_W) * 100).toFixed(2) + "%";
					});
					wmRightSlider.addEventListener("change", function () {
						saveFields({ watermark_w: Number(wmRightSlider.value) })
							.catch(function (err) { toast(err.message, true); });
					});
				}
				if (wmLeftSlider) {
					wmLeftSlider.addEventListener("input", function () {
						var v = Number(wmLeftSlider.value);
						if (wmLeftLabel) wmLeftLabel.textContent = wmLabel(v);
						if (previewLeft) previewLeft.style.width = ((v / POSTCARD_W) * 100).toFixed(2) + "%";
					});
					wmLeftSlider.addEventListener("change", function () {
						saveFields({ watermark_left_w: Number(wmLeftSlider.value) })
							.catch(function (err) { toast(err.message, true); });
					});
				}

				// ---- Copy form ----
				document.getElementById("copy-form").addEventListener("submit", function (e) {
					e.preventDefault();
					var f = e.target;
					saveFields({
						tagline: f.querySelector('[name="tagline"]').value,
						kiosk_idle_subhead: f.querySelector('[name="kiosk_idle_subhead"]').value,
						scene_picker_heading: f.querySelector('[name="scene_picker_heading"]').value,
					}).catch(function (err) { toast(err.message, true); });
				});

				// ---- Prompts form ----
				document.getElementById("prompts-form").addEventListener("submit", function (e) {
					e.preventDefault();
					var f = e.target;
					saveFields({
						scene_style_preamble: f.querySelector('[name="scene_style_preamble"]').value,
						scene_constraints: f.querySelector('[name="scene_constraints"]').value,
					}).catch(function (err) { toast(err.message, true); });
				});

				// ---- Scenes ----
				var scenesData = JSON.parse(document.getElementById("scenes-data").textContent || "[]");
				var container = document.getElementById("scenes-container");
				var expanded = {};

				function renderScenes() {
					container.innerHTML = scenesData.map(function (s, idx) {
						var isOpen = expanded[s.id];
						return '<div class="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden" data-scene-id="' + escapeH(s.id) + '">'
							+ '<div class="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.03]" data-toggle-scene="' + escapeH(s.id) + '">'
							+ '<span class="text-lg">' + escapeH(s.emoji) + '</span>'
							+ '<span class="font-semibold text-sm flex-1">' + escapeH(s.name) + '</span>'
							+ '<label class="flex items-center gap-2 text-xs text-white/50" onclick="event.stopPropagation()">'
							+   '<input type="checkbox" ' + (s.is_active ? "checked" : "") + ' data-active-toggle="' + escapeH(s.id) + '" class="accent-orange-500" />'
							+   'Active'
							+ '</label>'
							+ (idx > 0 ? '<button type="button" data-move="up" data-scene-idx="' + idx + '" onclick="event.stopPropagation()" class="text-white/40 hover:text-white text-xs px-1">\u25B2</button>' : '<span class="w-5"></span>')
							+ (idx < scenesData.length - 1 ? '<button type="button" data-move="down" data-scene-idx="' + idx + '" onclick="event.stopPropagation()" class="text-white/40 hover:text-white text-xs px-1">\u25BC</button>' : '<span class="w-5"></span>')
							+ '<span class="text-white/30 text-sm">' + (isOpen ? "\u25B4" : "\u25BE") + '</span>'
							+ '</div>'
							+ (isOpen ? renderSceneForm(s) : '')
							+ '</div>';
					}).join("");
				}

				function renderSceneForm(s) {
					return '<div class="px-4 pb-4 pt-2 border-t border-white/5 space-y-3">'
						+ '<div class="grid grid-cols-2 gap-3">'
						+ '<div><label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Name</label>'
						+ '<input data-field="name" value="' + escapeA(s.name) + '" class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-cf-orange/50 focus:outline-none" /></div>'
						+ '<div><label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Emoji</label>'
						+ '<input data-field="emoji" value="' + escapeA(s.emoji) + '" maxlength="4" class="w-24 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-cf-orange/50 focus:outline-none" /></div>'
						+ '</div>'
						+ '<div><label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Description</label>'
						+ '<input data-field="description" value="' + escapeA(s.description) + '" class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-cf-orange/50 focus:outline-none" /></div>'
						+ '<div><label class="block text-xs uppercase tracking-widest text-white/50 mb-1">Prompt</label>'
						+ '<textarea data-field="prompt" rows="5" class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white font-mono focus:border-cf-orange/50 focus:outline-none">' + escapeH(s.prompt) + '</textarea></div>'
						+ '<div class="flex items-center gap-3">'
						+ '<button type="button" data-save-scene="' + escapeA(s.id) + '" class="rounded-full bg-cf-orange px-5 py-2 text-xs font-semibold text-black hover:bg-cf-orange-dark transition">Save scene</button>'
						+ '<button type="button" data-delete-scene="' + escapeA(s.id) + '" class="rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400 hover:bg-red-500/20 transition">Delete</button>'
						+ '</div></div>';
				}

				function escapeH(s) {
					return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
				}
				function escapeA(s) { return escapeH(s); }

				renderScenes();

				container.addEventListener("click", function (e) {
					var toggle = e.target.closest("[data-toggle-scene]");
					if (toggle) {
						var sid = toggle.getAttribute("data-toggle-scene");
						expanded[sid] = !expanded[sid];
						renderScenes();
						return;
					}

					var moveBtn = e.target.closest("[data-move]");
					if (moveBtn) {
						var dir = moveBtn.getAttribute("data-move");
						var idx = parseInt(moveBtn.getAttribute("data-scene-idx"), 10);
						var swapIdx = dir === "up" ? idx - 1 : idx + 1;
						if (swapIdx < 0 || swapIdx >= scenesData.length) return;
						var tmp = scenesData[idx];
						scenesData[idx] = scenesData[swapIdx];
						scenesData[swapIdx] = tmp;
						var reorder = scenesData.map(function (s, i) { return { id: s.id, sort_order: i }; });
						fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/scenes/reorder", {
							method: "PUT", credentials: "same-origin",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(reorder),
						}).then(function (r) { return r.json(); })
						.then(function (j) {
							if (j.error) toast(j.error, true); else toast("Reordered");
						}).catch(function (err) { toast(err.message, true); });
						renderScenes();
						return;
					}

					var saveBtn = e.target.closest("[data-save-scene]");
					if (saveBtn) {
						var sceneId = saveBtn.getAttribute("data-save-scene");
						var card = container.querySelector('[data-scene-id="' + sceneId + '"]');
						var body = {
							name: card.querySelector('[data-field="name"]').value,
							emoji: card.querySelector('[data-field="emoji"]').value,
							description: card.querySelector('[data-field="description"]').value,
							prompt: card.querySelector('[data-field="prompt"]').value,
						};
						saveBtn.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/scenes/" + encodeURIComponent(sceneId), {
							method: "PUT", credentials: "same-origin",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(body),
						}).then(function (r) { return r.json(); })
						.then(function (j) {
							if (j.error) { toast(j.error, true); saveBtn.disabled = false; return; }
							var s = scenesData.find(function (x) { return x.id === sceneId; });
							if (s) { s.name = body.name; s.emoji = body.emoji; s.description = body.description; s.prompt = body.prompt; }
							toast("Scene saved");
							saveBtn.disabled = false;
						}).catch(function (err) { toast(err.message, true); saveBtn.disabled = false; });
						return;
					}

					var delBtn = e.target.closest("[data-delete-scene]");
					if (delBtn) {
						var sceneId = delBtn.getAttribute("data-delete-scene");
						if (!confirm("Delete scene '" + sceneId + "'?")) return;
						delBtn.disabled = true;
						fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/scenes/" + encodeURIComponent(sceneId), {
							method: "DELETE", credentials: "same-origin",
						}).then(function (r) { return r.json(); })
						.then(function (j) {
							if (j.error) { toast(j.error, true); delBtn.disabled = false; return; }
							scenesData = scenesData.filter(function (x) { return x.id !== sceneId; });
							delete expanded[sceneId];
							renderScenes();
							toast("Scene deleted");
						}).catch(function (err) { toast(err.message, true); delBtn.disabled = false; });
						return;
					}
				});

				container.addEventListener("change", function (e) {
					var toggle = e.target.closest("[data-active-toggle]");
					if (!toggle) return;
					var sceneId = toggle.getAttribute("data-active-toggle");
					var isActive = toggle.checked ? 1 : 0;
					fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/scenes/" + encodeURIComponent(sceneId), {
						method: "PUT", credentials: "same-origin",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ is_active: isActive }),
					}).then(function (r) { return r.json(); })
					.then(function (j) {
						if (j.error) { toast(j.error, true); toggle.checked = !toggle.checked; return; }
						var s = scenesData.find(function (x) { return x.id === sceneId; });
						if (s) s.is_active = isActive;
						toast(isActive ? "Scene activated" : "Scene deactivated");
					}).catch(function (err) { toast(err.message, true); toggle.checked = !toggle.checked; });
				});

				document.getElementById("add-scene-btn").addEventListener("click", function () {
					var name = prompt("Scene name:");
					if (!name) return;
					var id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
					if (!id) { toast("Invalid name", true); return; }
					var maxSort = scenesData.length > 0 ? Math.max.apply(null, scenesData.map(function (s) { return s.sort_order; })) : -1;
					var body = {
						id: id,
						name: name,
						emoji: "\uD83C\uDFA8",
						description: "",
						prompt: "",
						sort_order: maxSort + 1,
						is_active: 1,
					};
					fetch("/api/admin/events/" + encodeURIComponent(EVENT_ID) + "/scenes", {
						method: "POST", credentials: "same-origin",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					}).then(function (r) { return r.json(); })
					.then(function (j) {
						if (j.error) { toast(j.error, true); return; }
						scenesData.push({
							event_id: EVENT_ID, id: body.id, name: body.name, emoji: body.emoji,
							description: body.description, prompt: body.prompt, sort_order: body.sort_order, is_active: body.is_active,
						});
						expanded[body.id] = true;
						renderScenes();
						toast("Scene created");
					}).catch(function (err) { toast(err.message, true); });
				});
			})();
			</script>`,
		),
	);
});

export { app as adminEventEditorRoutes };
