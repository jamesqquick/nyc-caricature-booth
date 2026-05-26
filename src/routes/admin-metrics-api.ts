import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

const ACCOUNT_ID = 'e9bc21da719562a3e45d77de7dd042de';

/**
 * Metrics JSON feed — queries Analytics Engine SQL API.
 * GET /api/admin/metrics
 *
 * Returns { counts: { eventName: number }, timeline: [{ hour, count }] }
 */
app.get('/api/admin/metrics', async (c) => {
	const apiToken = c.env.AE_API_TOKEN;
	if (!apiToken) {
		return c.json({ error: 'AE_API_TOKEN not configured' }, 503);
	}

	const aeUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`;

	async function aeQuery(sql: string) {
		const res = await fetch(aeUrl, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiToken}` },
			body: sql,
		});
		if (!res.ok) {
			const text = await res.text();
			console.error(`[metrics] AE query failed HTTP ${res.status}: ${text}`);
			return null;
		}
		return (await res.json()) as { data: Record<string, unknown>[]; rows: number };
	}

	const countsResult = await aeQuery(`
		SELECT blob1 AS event_name, SUM(_sample_interval) AS count
		FROM nyc_booth_events
		WHERE timestamp > NOW() - INTERVAL '1' DAY
		GROUP BY event_name
		ORDER BY count DESC
	`);

	const timelineResult = await aeQuery(`
		SELECT
			toStartOfInterval(timestamp, INTERVAL '1' HOUR) AS hour,
			SUM(_sample_interval) AS count
		FROM nyc_booth_events
		WHERE timestamp > NOW() - INTERVAL '1' DAY
		GROUP BY hour
		ORDER BY hour ASC
	`);

	const counts: Record<string, number> = {};
	if (countsResult?.data) {
		for (const row of countsResult.data) {
			counts[String(row.event_name)] = Number(row.count) || 0;
		}
	}

	const timeline: { hour: string; count: number }[] = [];
	if (timelineResult?.data) {
		for (const row of timelineResult.data) {
			timeline.push({
				hour: String(row.hour),
				count: Number(row.count) || 0,
			});
		}
	}

	return c.json({ counts, timeline });
});

export { app as adminMetricsApiRoutes };
