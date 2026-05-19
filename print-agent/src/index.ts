import { fetchJobs, ackJob } from "./queue.js";
import type { AgentConfig, PrintJob } from "./types.js";

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

function loadConfig(): AgentConfig {
	const workerUrl = process.env.WORKER_URL;

	if (!workerUrl) {
		console.error("Missing required env var: WORKER_URL");
		console.error("Copy print-agent/.env.example to print-agent/.env and fill in the value.");
		console.error("Example: WORKER_URL=https://nyc-caricature-booth.examples.workers.dev");
		process.exit(1);
	}

	return {
		workerUrl: workerUrl.replace(/\/$/, ""),
		pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 5000,
		batchSize: Number(process.env.BATCH_SIZE) || 5,
	};
}

// ---------------------------------------------------------------------------
// Job handler (stub — real logic added in steps 8.4–8.6)
// ---------------------------------------------------------------------------

async function handleJob(config: AgentConfig, job: PrintJob): Promise<void> {
	console.log(
		`  [job] id=${job.id} session=${job.session_id} scene="${job.scene_name}" postcard=${job.postcard_key}`,
	);
	// TODO (8.4): download postcard image from Worker
	// TODO (8.4): convert to print-ready PDF
	// TODO (8.5): send to mock printer driver
	// TODO (8.6): send to real printer
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

async function poll(config: AgentConfig): Promise<void> {
	try {
		const jobs = await fetchJobs(config);
		if (jobs.length === 0) return;

		console.log(`[poll] fetched ${jobs.length} pending job(s)`);

		for (const job of jobs) {
			try {
				await handleJob(config, job);
				await ackJob(config, job.id, "printed");
				console.log(`  [ack] job=${job.id} status=printed`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`  [fail] job=${job.id}: ${msg}`);
				await ackJob(config, job.id, "failed", msg).catch(() => {});
			}
		}
	} catch (err) {
		console.error(`[poll] error: ${err instanceof Error ? err.message : String(err)}`);
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const config = loadConfig();

	console.log("=== NYC Caricature Booth — Print Agent ===");
	console.log(`  worker:     ${config.workerUrl}`);
	console.log(`  poll every: ${config.pollIntervalMs}ms`);
	console.log(`  batch size: ${config.batchSize}`);
	console.log("");

	// Initial poll immediately, then on interval
	await poll(config);
	setInterval(() => poll(config), config.pollIntervalMs);

	console.log("[agent] polling started — press Ctrl+C to stop");
}

main();
