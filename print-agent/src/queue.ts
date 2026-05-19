import type { AgentConfig, PrintJob } from "./types.js";

/** Fetch pending print jobs from the Worker. */
export async function fetchJobs(config: AgentConfig): Promise<PrintJob[]> {
	const url = `${config.workerUrl}/api/print-agent/jobs?limit=${config.batchSize}`;
	const res = await fetch(url);

	if (!res.ok) {
		throw new Error(`Failed to fetch jobs: HTTP ${res.status} ${await res.text()}`);
	}

	const data = (await res.json()) as { jobs: PrintJob[] };
	return data.jobs;
}

/** Acknowledge a print job as printed or failed. */
export async function ackJob(
	config: AgentConfig,
	jobId: string,
	status: "printed" | "failed",
	error?: string,
): Promise<void> {
	const url = `${config.workerUrl}/api/print-agent/jobs/${jobId}/ack`;
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ status, error }),
	});

	if (!res.ok) {
		throw new Error(`Failed to ack job ${jobId}: HTTP ${res.status} ${await res.text()}`);
	}
}
