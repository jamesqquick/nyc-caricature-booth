/**
 * FLUX.2 klein 4B image generation helper.
 * Shared between the test endpoints in src/index.ts and the workflow steps.
 *
 * Notes:
 * - FLUX.2 returns base64 in `image`, but the actual bytes are usually JPEG
 *   despite the docs implying PNG. We sniff magic bytes for content-type.
 * - When `selfieBytes` is provided, the call becomes image-to-image; the
 *   selfie is sent as the `input_image_0` part of a multipart body.
 */

export type FluxContentType =
	| "image/jpeg"
	| "image/png"
	| "application/octet-stream";

export type FluxResult = {
	bytes: Uint8Array;
	contentType: FluxContentType;
	elapsedMs: number;
};

export type FluxOpts = {
	prompt: string;
	selfieBytes?: ArrayBuffer;
	selfieType?: string;
	width?: number;
	height?: number;
};

export async function runFlux(ai: Ai, opts: FluxOpts): Promise<FluxResult> {
	const form = new FormData();
	form.append("prompt", opts.prompt);
	form.append("width", String(opts.width ?? 1024));
	form.append("height", String(opts.height ?? 1024));
	if (opts.selfieBytes) {
		const blob = new Blob([opts.selfieBytes], {
			type: opts.selfieType || "image/jpeg",
		});
		form.append("input_image_0", blob, "selfie.jpg");
	}

	const formResponse = new Response(form);
	const formStream = formResponse.body;
	const formContentType =
		formResponse.headers.get("content-type") ?? "multipart/form-data";

	const started = Date.now();
	const resp = (await ai.run("@cf/black-forest-labs/flux-2-klein-4b", {
		multipart: {
			body: formStream as ReadableStream,
			contentType: formContentType,
		},
	})) as { image?: string } | unknown;
	const elapsedMs = Date.now() - started;

	if (
		!resp ||
		typeof resp !== "object" ||
		!("image" in resp) ||
		typeof resp.image !== "string"
	) {
		throw new Error(
			`Unexpected AI response: ${JSON.stringify(resp).slice(0, 200)}`,
		);
	}

	const bytes = Uint8Array.from(atob(resp.image), (ch) => ch.charCodeAt(0));
	const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
	const isPng =
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47;
	const contentType: FluxContentType = isJpeg
		? "image/jpeg"
		: isPng
			? "image/png"
			: "application/octet-stream";

	return { bytes, contentType, elapsedMs };
}
