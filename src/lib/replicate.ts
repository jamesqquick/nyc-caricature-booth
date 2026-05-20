/**
 * Replicate image generation helper using google/nano-banana
 * (Gemini 2.5 Flash Image).
 *
 * Replicate's API is async: POST /predictions starts the job and returns a
 * prediction ID. We poll GET /predictions/{id} until status is "succeeded"
 * or "failed", then fetch the output URL and return raw bytes — the same
 * shape as runFlux so the workflow needs minimal changes.
 *
 * The selfie is sent as a base64 data URL in image_input[0], avoiding any
 * need for signed R2 URLs or public bucket access.
 *
 * Notes:
 * - nano-banana always returns JPEG output.
 * - Polling interval starts at 2s and backs off to 5s after the first few
 *   attempts to avoid hammering the API.
 * - Total timeout is capped at 120s; the workflow step has its own 2-minute
 *   timeout which aligns.
 */

export type ReplicateResult = {
	bytes: Uint8Array;
	contentType: "image/jpeg" | "image/png" | "application/octet-stream";
	elapsedMs: number;
};

export type ReplicateOpts = {
	prompt: string;
	selfieBytes: ArrayBuffer;
	selfieType?: string;
};

const MODEL = "google/nano-banana";
const POLL_INTERVAL_INITIAL_MS = 2_000;
const POLL_INTERVAL_MAX_MS = 5_000;
const TIMEOUT_MS = 120_000;

export async function runReplicate(
	token: string,
	opts: ReplicateOpts,
): Promise<ReplicateResult> {
	const started = Date.now();

	// Encode selfie as base64 data URL so Replicate can accept it inline
	// without needing a publicly accessible URL.
	const mimeType = opts.selfieType || "image/jpeg";
	const base64 = btoa(
		String.fromCharCode(...new Uint8Array(opts.selfieBytes)),
	);
	const selfieDataUrl = `data:${mimeType};base64,${base64}`;

	// 1. Start the prediction
	const createResp = await fetch(
		`https://api.replicate.com/v1/models/${MODEL}/predictions`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				Prefer: "wait", // ask Replicate to wait up to 60s before returning
			},
			body: JSON.stringify({
				input: {
					prompt: opts.prompt,
					image_input: [selfieDataUrl],
					aspect_ratio: "3:4",
					output_format: "jpg",
				},
			}),
		},
	);

	if (!createResp.ok) {
		const body = await createResp.text();
		throw new Error(
			`Replicate create prediction failed: HTTP ${createResp.status} — ${body.slice(0, 300)}`,
		);
	}

	let prediction = (await createResp.json()) as ReplicatePrediction;

	// 2. Poll until terminal state
	let pollInterval = POLL_INTERVAL_INITIAL_MS;
	let attempts = 0;

	while (prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
		const elapsed = Date.now() - started;
		if (elapsed > TIMEOUT_MS) {
			throw new Error(
				`Replicate prediction timed out after ${elapsed}ms (id=${prediction.id})`,
			);
		}

		await sleep(pollInterval);
		attempts++;
		if (attempts > 3) pollInterval = POLL_INTERVAL_MAX_MS;

		const pollResp = await fetch(
			`https://api.replicate.com/v1/predictions/${prediction.id}`,
			{
				headers: { Authorization: `Bearer ${token}` },
			},
		);

		if (!pollResp.ok) {
			throw new Error(
				`Replicate poll failed: HTTP ${pollResp.status} (id=${prediction.id})`,
			);
		}

		prediction = (await pollResp.json()) as ReplicatePrediction;
	}

	if (prediction.status !== "succeeded") {
		throw new Error(
			`Replicate prediction ${prediction.status}: ${prediction.error ?? "unknown error"} (id=${prediction.id})`,
		);
	}

	// 3. Fetch the output image bytes
	const outputUrl = Array.isArray(prediction.output)
		? prediction.output[0]
		: prediction.output;

	if (!outputUrl || typeof outputUrl !== "string") {
		throw new Error(
			`Replicate prediction succeeded but output URL is missing (id=${prediction.id})`,
		);
	}

	const imgResp = await fetch(outputUrl);
	if (!imgResp.ok) {
		throw new Error(
			`Failed to fetch Replicate output image: HTTP ${imgResp.status} — ${outputUrl}`,
		);
	}

	const buffer = await imgResp.arrayBuffer();
	const bytes = new Uint8Array(buffer);

	// Sniff content type from magic bytes (nano-banana outputs JPEG)
	const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
	const isPng =
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47;
	const contentType = isJpeg
		? "image/jpeg"
		: isPng
			? "image/png"
			: "application/octet-stream";

	const elapsedMs = Date.now() - started;
	return { bytes, contentType, elapsedMs };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

type ReplicatePrediction = {
	id: string;
	status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
	output?: string | string[];
	error?: string;
};
