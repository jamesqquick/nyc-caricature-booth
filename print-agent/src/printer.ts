import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { tmpdir } from "node:os";

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

// ---------------------------------------------------------------------------
// DNP DS620A — dye-sublimation photo printer via CUPS/lp
// ---------------------------------------------------------------------------

/**
 * Prints to a DNP DS620A (or any CUPS printer) using the `lp` command.
 * Requires the DNP macOS driver to be installed and the printer to be
 * set up in System Settings > Printers & Scanners.
 *
 * The CUPS printer name can be found with: `lpstat -p -d`
 */
export class DnpDs620Printer implements Printer {
	name: string;
	private cupsName: string;

	constructor(cupsName = "DNP_DS620") {
		this.cupsName = cupsName;
		this.name = `DnpDs620(${cupsName})`;
	}

	async print(pdfBytes: Uint8Array, jobId: string): Promise<PrintResult> {
		const started = Date.now();

		// Write PDF to a temp file (lp needs a file path)
		const tmpPath = join(tmpdir(), `print-${jobId}.pdf`);
		await writeFile(tmpPath, pdfBytes);

		try {
			const output = await execAsync(
				`lp -d ${shellEscape(this.cupsName)} -o media=4x6 -o fit-to-page ${shellEscape(tmpPath)}`,
			);
			const durationMs = Date.now() - started;
			return {
				success: true,
				message: `${this.name}: sent to CUPS (${output.trim()})`,
				durationMs,
			};
		} catch (err) {
			const durationMs = Date.now() - started;
			return {
				success: false,
				message: `${this.name}: lp failed — ${err instanceof Error ? err.message : String(err)}`,
				durationMs,
			};
		} finally {
			// Clean up temp file (best-effort)
			await unlink(tmpPath).catch(() => {});
		}
	}
}

// ---------------------------------------------------------------------------
// Factory — select printer driver by name
// ---------------------------------------------------------------------------

export function createPrinter(driver?: string, cupsName?: string): Printer {
	switch (driver?.toLowerCase()) {
		case "dnp":
		case "dnp-ds620":
			return new DnpDs620Printer(cupsName);
		case "mock":
		default:
			return new MockPrinter();
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execAsync(cmd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(cmd, { timeout: 30_000 }, (err, stdout, stderr) => {
			if (err) {
				reject(new Error(`${err.message}${stderr ? `\nstderr: ${stderr}` : ""}`));
			} else {
				resolve(stdout);
			}
		});
	});
}

/** Basic shell argument escaping. */
function shellEscape(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}
