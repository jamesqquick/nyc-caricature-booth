import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Result of a print attempt. */
export type PrintResult = {
	success: boolean;
	message: string;
	durationMs: number;
};

/** Interface for printer drivers. Implement this for real hardware. */
export interface Printer {
	name: string;
	print(pdfBytes: Uint8Array, jobId: string): Promise<PrintResult>;
}

// ---------------------------------------------------------------------------
// Mock printer — simulates printing by writing to a spool directory
// ---------------------------------------------------------------------------

const SPOOL_DIR = join(__dirname, "..", "spool");

/** Simulated print delay range (ms). */
const MIN_DELAY = 500;
const MAX_DELAY = 2000;

export class MockPrinter implements Printer {
	name = "MockPrinter";

	async print(pdfBytes: Uint8Array, jobId: string): Promise<PrintResult> {
		const started = Date.now();

		// Simulate variable print time
		const delay = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
		await new Promise((r) => setTimeout(r, delay));

		// Write to spool directory so you can visually inspect
		await mkdir(SPOOL_DIR, { recursive: true });
		const spoolPath = join(SPOOL_DIR, `${jobId}.pdf`);
		await writeFile(spoolPath, pdfBytes);

		const durationMs = Date.now() - started;
		return {
			success: true,
			message: `MockPrinter: wrote ${pdfBytes.byteLength} bytes to ${spoolPath}`,
			durationMs,
		};
	}
}
