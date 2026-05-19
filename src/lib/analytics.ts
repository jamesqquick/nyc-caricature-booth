/**
 * Analytics Engine helpers (Phase 11.4).
 *
 * Thin wrappers around env.ANALYTICS.writeDataPoint() so every call site
 * uses a consistent schema. Writes are fire-and-forget (non-blocking) so
 * they never add latency to user-facing requests.
 *
 * Schema convention:
 *   blob1  = event name (e.g. "session.created", "workflow.step", "print.requested")
 *   blob2  = session id  (or empty string for non-session events)
 *   blob3  = detail      (scene id, step name, error message, etc.)
 *   double1 = 1           (count — always 1 per event, use SUM for aggregation)
 *   double2 = elapsed ms  (optional, for timing events)
 *   index1 = event name   (same as blob1 — used as the sampling key)
 */

type EventName =
	| "session.created"
	| "workflow.moderating"
	| "workflow.generating"
	| "workflow.compositing"
	| "workflow.done"
	| "workflow.errored"
	| "print.requested"
	| "print.completed"
	| "print.failed"
	| "email.captured"
	| "session.deleted";

export function trackEvent(
	analytics: AnalyticsEngineDataset | undefined,
	event: EventName,
	sessionId = "",
	detail = "",
	elapsedMs?: number,
): void {
	if (!analytics) return;
	try {
		analytics.writeDataPoint({
			blobs: [event, sessionId, detail],
			doubles: [1, elapsedMs ?? 0],
			indexes: [event],
		});
	} catch (err) {
		// Never let analytics break the request path.
		console.warn(`[analytics] writeDataPoint failed event=${event}: ${err}`);
	}
}

/**
 * Query the Analytics Engine SQL API. Returns the parsed JSON response
 * or null on failure. Requires AE_API_TOKEN secret + account_id from
 * wrangler.jsonc.
 */
export async function queryAE(
	accountId: string,
	apiToken: string,
	sql: string,
): Promise<{ data: Record<string, unknown>[]; rows: number } | null> {
	try {
		const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;
		const res = await fetch(url, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiToken}` },
			body: sql,
		});
		if (!res.ok) {
			console.error(`[analytics] AE query failed HTTP ${res.status}: ${await res.text()}`);
			return null;
		}
		const json = await res.json() as { data: Record<string, unknown>[]; rows: number };
		return json;
	} catch (err) {
		console.error(`[analytics] AE query error: ${err}`);
		return null;
	}
}
