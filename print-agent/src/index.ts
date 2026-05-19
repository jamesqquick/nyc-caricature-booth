import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJobs, ackJob } from "./queue.js";
import { buildPrintPdf } from "./pdf.js";
import { MockPrinter, type Printer } from "./printer.js";
import type { AgentConfig, PrintJob } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");

// Swap this for a real printer driver when hardware is decided (step 8.6)
const printer: Printer = new MockPrinter();

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
// Job handler
// ---------------------------------------------------------------------------

/** Download the postcard JPEG from the Worker's R2 proxy. */
async function downloadPostcard(config: AgentConfig, postcardKey: string): Promise<Uint8Array> {
	const url = `${config.workerUrl}/api/run-img?key=${encodeURIComponent(postcardKey)}`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Failed to download postcard: HTTP ${res.status}`);
	}
	return new Uint8Array(await res.arrayBuffer());
}

async function handleJob(config: AgentConfig, job: PrintJob): Promise<void> {
	console.log(
		`  [job] id=${job.id} session=${job.session_id} scene="${job.scene_name}" postcard=${job.postcard_key}`,
	);

	// 1. Download postcard JPEG
	const jpegBytes = await downloadPostcard(config, job.postcard_key);
	console.log(`  [download] ${jpegBytes.byteLength} bytes`);

	// 2. Wrap in print-ready 4×6" PDF
	const pdfBytes = await buildPrintPdf(jpegBytes);

	// 3. Save PDF to output directory (archive copy)
	await mkdir(OUTPUT_DIR, { recursive: true });
	const pdfPath = join(OUTPUT_DIR, `${job.session_id}.pdf`);
	await writeFile(pdfPath, pdfBytes);
	console.log(`  [pdf] written to ${pdfPath} (${pdfBytes.byteLength} bytes)`);

	// 4. Send to printer
	const result = await printer.print(new Uint8Array(pdfBytes), job.id);
	if (!result.success) {
		throw new Error(`Printer failed: ${result.message}`);
	}
	console.log(`  [print] ${result.message} (${result.durationMs}ms)`);
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
	console.log(`  printer:    ${printer.name}`);
	console.log(`  poll every: ${config.pollIntervalMs}ms`);
	console.log(`  batch size: ${config.batchSize}`);
	console.log("");

	// Initial poll immediately, then on interval
	await poll(config);
	setInterval(() => poll(config), config.pollIntervalMs);

	console.log("[agent] polling started — press Ctrl+C to stop");
}

main();
