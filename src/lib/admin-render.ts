/**
 * Admin-specific HTML rendering helpers.
 * All functions here are used only by admin route files.
 */

import type { AdminSessionRow, AdminStats } from './admin-data';
import { escapeHtml, escapeAttr } from './html';

// ---------------------------------------------------------------------------
// Slug validation
// ---------------------------------------------------------------------------

/** Slug validation: lowercase alphanumeric + hyphens, 3–64 chars. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

// ---------------------------------------------------------------------------
// Status / pill helpers
// ---------------------------------------------------------------------------

/** Status pill class — must match the client-side `statusClass` in /admin JS. */
export function adminStatusClass(s: string): string {
	if (s === 'completed') return 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/30';
	if (s === 'errored') return 'bg-red-500/20 text-red-300 ring-red-400/30';
	if (!s || s === 'pending') return 'bg-white/10 text-white/60 ring-white/20';
	return 'bg-amber-500/20 text-amber-300 ring-amber-400/30';
}

export function adminPrintClass(s: string | null): string {
	if (s === 'printed') return 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/30';
	if (s === 'failed') return 'bg-red-500/20 text-red-300 ring-red-400/30';
	if (s === 'printing') return 'bg-cf-orange/20 text-cf-orange ring-cf-orange/30';
	if (s === 'pending') return 'bg-amber-500/20 text-amber-300 ring-amber-400/30';
	return 'bg-white/5 text-white/40 ring-white/10';
}

/** Status pill for event status. */
export function eventStatusPill(status: string): string {
	const cls =
		status === 'active'
			? 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/30'
			: status === 'archived'
				? 'bg-amber-500/20 text-amber-300 ring-amber-400/30'
				: 'bg-white/10 text-white/60 ring-white/20';
	return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${cls}">${escapeHtml(status)}</span>`;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Server-side, we emit a <time data-ts="<unix-seconds>"> placeholder and
 * let the client JS format it in the viewer's locale on load. This avoids
 * the "flips from UTC 24h to local AM/PM after the first poll" bug.
 */
export function adminTimeTag(secs: number | null): string {
	if (!secs) return `<span class="text-white/40">—</span>`;
	return `<time data-ts="${secs}" class="whitespace-nowrap">…</time>`;
}

export function adminFmtDuration(ms: number | null): string {
	if (ms == null) return '—';
	if (ms < 1000) return `${ms} ms`;
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return `${m}m ${s % 60}s`;
}

export function adminFmtAvg(secs: number | null): string {
	if (secs == null) return '—';
	if (secs < 60) return `${secs.toFixed(1)}s`;
	const m = Math.floor(secs / 60);
	const s = Math.round(secs - m * 60);
	return `${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------

export function statCard(label: string, value: string, accentCls = 'text-white'): string {
	return (
		`<div class="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">` +
		`<div class="text-[10px] uppercase tracking-widest text-white/40">${escapeHtml(label)}</div>` +
		`<div class="mt-1 text-2xl font-bold ${accentCls}">${escapeHtml(value)}</div>` +
		`</div>`
	);
}

export function renderAdminStatCards(stats: AdminStats): string {
	return (
		statCard('Total', String(stats.totalSessions)) +
		statCard('Completed', String(stats.completed), 'text-emerald-300') +
		statCard('Errored', String(stats.errored), 'text-red-300') +
		statCard('Avg pipeline', adminFmtAvg(stats.avgPipelineSec)) +
		statCard('Emails', String(stats.emailsCollected), 'text-cf-orange') +
		statCard('Printed', String(stats.postcardsPrinted), 'text-cf-orange')
	);
}

export function renderAdminSceneBreakdown(stats: AdminStats): string {
	if (stats.sceneBreakdown.length === 0) {
		return `<span class="text-xs text-white/40">No scenes used yet.</span>`;
	}
	return stats.sceneBreakdown
		.map(
			(s) =>
				`<span class="inline-flex items-center gap-2 rounded-full bg-white/[0.04] border border-white/10 px-3 py-1.5 text-xs">` +
				`<span class="text-white/80">${escapeHtml(s.sceneName)}</span>` +
				`<span class="text-white/40">·</span>` +
				`<span class="font-mono text-cf-orange">${s.count}</span>` +
				`</span>`,
		)
		.join('');
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

/**
 * Per-row action buttons for the admin sessions table.
 */
export function renderAdminRowActions(r: AdminSessionRow): string {
	const buttons: string[] = [];
	const isCompleted = r.status === 'completed' && !!r.postcardKey;
	if (isCompleted) {
		buttons.push(
			`<button type="button"
				data-action="retry-print"
				data-session="${escapeAttr(r.sessionId)}"
				class="inline-flex items-center rounded-full border border-cf-orange/40 bg-cf-orange/10 px-3 py-1 text-xs text-cf-orange hover:bg-cf-orange/20 hover:border-cf-orange/60 disabled:opacity-50 disabled:cursor-not-allowed transition">
				🖨️ Retry print
			</button>`,
		);
	}
	if (r.hasEmail && isCompleted) {
		buttons.push(
			`<button type="button"
				data-action="resend-email"
				data-session="${escapeAttr(r.sessionId)}"
				class="inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-white/80 hover:border-white/30 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition">
				📧 Resend email
			</button>`,
		);
	}
	buttons.push(
		`<button type="button"
			data-action="delete-session"
			data-session="${escapeAttr(r.sessionId)}"
			class="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-400 hover:bg-red-500/20 hover:border-red-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition">
			🗑️ Delete
		</button>`,
	);
	return `<div class="inline-flex items-center gap-1.5 justify-end">${buttons.join('')}</div>`;
}

export function renderAdminTableBody(rows: AdminSessionRow[]): string {
	if (rows.length === 0) {
		return `<tr><td colspan="9" class="px-4 py-8 text-center text-white/40">No sessions yet.</td></tr>`;
	}
	return rows
		.map((r) => {
			const shortId = r.sessionId.slice(0, 8);
			const status = r.status || 'pending';
			const printStatus = r.printStatus ?? '—';
			return (
				`<tr class="hover:bg-white/[0.03]">` +
				`<td class="px-4 py-3 font-mono text-xs text-white/80">${escapeHtml(shortId)}</td>` +
				`<td class="px-4 py-3 text-white/60 text-xs">${escapeHtml(r.eventId ?? '—')}</td>` +
				`<td class="px-4 py-3"><span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${adminStatusClass(status)}">${escapeHtml(status)}</span></td>` +
				`<td class="px-4 py-3 text-white/80">${escapeHtml(r.sceneName ?? '—')}</td>` +
				`<td class="px-4 py-3 text-white/60 whitespace-nowrap">${adminTimeTag(r.createdAt)}</td>` +
				`<td class="px-4 py-3 text-white/60 whitespace-nowrap">${escapeHtml(adminFmtDuration(r.pipelineDurationMs))}</td>` +
				`<td class="px-4 py-3 text-white/60">${escapeHtml(r.emailMasked ?? '—')}</td>` +
				`<td class="px-4 py-3"><span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${adminPrintClass(r.printStatus)}">${escapeHtml(printStatus)}</span></td>` +
				`<td class="px-4 py-3 text-right whitespace-nowrap">${renderAdminRowActions(r)}</td>` +
				`</tr>`
			);
		})
		.join('');
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Shared admin nav header for event management pages. */
export function adminEventNav(crumbs: string = ''): string {
	return `<header class="flex items-center justify-between mb-8">
		<div>
			<div class="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-white/50">
				Booth admin
			</div>
			${crumbs}
		</div>
		<div class="flex items-center gap-4 text-xs text-white/50">
			<a href="/admin" class="text-cf-orange hover:text-white underline underline-offset-4">Dashboard</a>
			<a href="/admin/events" class="text-cf-orange hover:text-white underline underline-offset-4">Events</a>
			<a href="/admin/logout" class="text-cf-orange hover:text-white underline underline-offset-4">Sign out</a>
		</div>
	</header>`;
}
