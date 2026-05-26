import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJobs, ackJob } from "./queue.js";
import { buildPrintPdf } from "./pdf.js";
import { createPrinter } from "./printer.js";
import type { AgentConfig, PrintJob } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");

// PRINTER_DRIVER: "mock" (default) or "dnp" / "dnp-ds620"
// PRINTER_NAME: CUPS printer name (default: "DNP_DS620")
const printer = createPrinter(process.env.PRINTER_DRIVER, process.env.PRINTER_NAME);

// ---------------------------------------------------------------------------
// CLI flag parsing
// ---------------------------------------------------------------------------

function parseCliFlags(): { eventId?: string } {
	const args = process.argv.slice(2);
	const flags: { eventId?: string } = {};

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--event-id" && args[i + 1]) {
			flags.eventId = args[++i];
		}
	}

	return flags;
}

// ---------------------------------------------------------------------------
// Config from environment + CLI flags
// ---------------------------------------------------------------------------

function loadConfig(): AgentConfig {
	const flags = parseCliFlags();

	const workerUrl = process.env.WORKER_URL;
	if (!workerUrl) {
		console.error("Missing required env var: WORKER_URL");
		console.error("Copy print-agent/.env.example to print-agent/.env and fill in the value.");
		console.error("Example: WORKER_URL=https://nyc-caricature-booth.examples.workers.dev");
		process.exit(1);
	}

	// --event-id flag takes precedence over EVENT_ID env var
	const eventId = flags.eventId || process.env.EVENT_ID;
	if (!eventId) {
		console.error("Missing required --event-id flag or EVENT_ID env var.");
		console.error("Usage: npm start -- --event-id <event-slug>");
		console.error("Example: npm start -- --event-id nyc-2025");
		process.exit(1);
	}

	return {
		workerUrl: workerUrl.replace(/\/$/, ""),
		eventId,
		pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 5000,
		batchSize: Number(process.env.BATCH_SIZE) || 5,
	};
}

// ---------------------------------------------------------------------------
// Job handler
// ---------------------------------------------------------------------------

/**
 * Download the postcard JPEG from the Worker's R2 proxy.
 *
 * Retries with exponential backoff to ride out transient venue WiFi blips.
 * A single network hiccup must not mark the job permanently `failed` — only
 * a genuine failure (postcard missing, R2 outage, etc.) should surface here.
 */
async function downloadPostcard(config: AgentConfig, postcardKey: string): Promise<Uint8Array> {
	const url = `${config.workerUrl}/e/${config.eventId}/api/run-img?key=${encodeURIComponent(postcardKey)}`;
	const delays = [500, 1500, 4000];
	let lastErr: unknown;

	for (let attempt = 0; attempt < delays.length; attempt++) {
		try {
			const res = await fetch(url);
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			return new Uint8Array(await res.arrayBuffer());
		} catch (err) {
			lastErr = err;
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`  [download] attempt ${attempt + 1}/${delays.length} failed: ${msg}`);
			if (attempt < delays.length - 1) {
				await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
			}
		}
	}

	const finalMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
	throw new Error(`Failed to download postcard after ${delays.length} attempts: ${finalMsg}`);
}

async function handleJob(config: AgentConfig, job: PrintJob): Promise<void> {
	console.log(
		`  [job] id=${job.id} session=${job.session_id} event=${job.event_id} scene="${job.scene_name}" postcard=${job.postcard_key}`,
	);

	// Defense in depth: even though the server filters by event_id,
	// reject jobs that don't match this agent's configured event.
	if (job.event_id !== config.eventId) {
		throw new Error(
			`Event mismatch: job event_id="${job.event_id}" but agent configured for "${config.eventId}"`,
		);
	}

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

// Threshold for the "we appear to be offline" warning, in consecutive failed
// polls. At the default 5s poll interval this is ~15s of total downtime —
// enough to ignore brief blips, short enough that staff get a fast signal
// when the venue WiFi drops or a captive portal needs re-auth.
const OFFLINE_WARNING_THRESHOLD = 3;

let consecutiveFailures = 0;

async function poll(config: AgentConfig): Promise<void> {
	let jobs: PrintJob[];
	try {
		jobs = await fetchJobs(config);
	} catch (err) {
		consecutiveFailures++;
		const msg = err instanceof Error ? err.message : String(err);
		if (consecutiveFailures === OFFLINE_WARNING_THRESHOLD) {
			console.error(
				`[poll] ⚠️  OFFLINE — ${OFFLINE_WARNING_THRESHOLD} consecutive failed polls. Check WiFi / captive portal.`,
			);
		}
		console.error(`[poll] error (#${consecutiveFailures}): ${msg}`);
		return;
	}

	if (consecutiveFailures >= OFFLINE_WARNING_THRESHOLD) {
		console.log(`[poll] ✅ recovered after ${consecutiveFailures} failed polls`);
	}
	consecutiveFailures = 0;

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
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const config = loadConfig();

	console.log("=== Caricature Booth — Print Agent ===");
	console.log(`  worker:     ${config.workerUrl}`);
	console.log(`  event:      ${config.eventId}`);
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
