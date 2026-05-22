/**
 * Postcard composition: builds a 4x6" @ 300 DPI JPEG with watermark + QR.
 *
 * Uses the Cloudflare Images binding (`env.IMAGES`) for resize/composite.
 * QR code is rasterized in pure JS (Workers can't use the qrcode package's
 * built-in Node Buffer path) via a minimal stored-deflate PNG encoder.
 *
 * Shared between the test endpoints in src/index.ts and the workflow's
 * composite step.
 */

import QRCode from "qrcode";
import type { EventRecord } from "./types";

// ----- Postcard dimensions (4x6 inches @ 300 DPI, landscape) -----
export const POSTCARD_W = 1800;
export const POSTCARD_H = 1200;
// Watermark sized as a fraction of the postcard width
export const POSTCARD_WATERMARK_W = 540; // ~30% of postcard width
export const POSTCARD_WATERMARK_MARGIN = 56;
// QR code sized for easy phone scanning at arm's length
export const POSTCARD_QR_W = 220;
export const POSTCARD_QR_MARGIN = 56;

/**
 * Generates a short, URL-safe ID for a postcard (digital pickup URL).
 * 10 chars of base32, ~50 bits of entropy.
 *
 * Used by the standalone /test-postcard form. The real workflow uses the
 * session UUID instead so postcard ID == session ID == R2 prefix.
 */
export function newPostcardId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"; // Crockford-ish, no 0/1/l/o
	let s = "";
	for (let i = 0; i < bytes.length; i++) {
		s += alphabet[bytes[i] % alphabet.length];
		if (s.length >= 10) break;
	}
	return s.slice(0, 10);
}

/**
 * Encodes a Uint8Array as a PNG file. Minimal "raw RGBA" encoder, no deflate
 * (uses zlib's stored/uncompressed blocks). Worker-safe — pure JS.
 */
export function encodePng(
	width: number,
	height: number,
	rgba: Uint8Array,
): Uint8Array {
	const crcTable = (() => {
		const t = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			t[n] = c >>> 0;
		}
		return t;
	})();
	function crc32(buf: Uint8Array): number {
		let c = 0xffffffff;
		for (let i = 0; i < buf.length; i++)
			c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	}
	function adler32(buf: Uint8Array): number {
		let a = 1;
		let b = 0;
		for (let i = 0; i < buf.length; i++) {
			a = (a + buf[i]) % 65521;
			b = (b + a) % 65521;
		}
		return ((b << 16) | a) >>> 0;
	}
	function chunk(type: string, data: Uint8Array): Uint8Array {
		const out = new Uint8Array(8 + data.length + 4);
		const dv = new DataView(out.buffer);
		dv.setUint32(0, data.length);
		for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
		out.set(data, 8);
		const crcInput = new Uint8Array(4 + data.length);
		for (let i = 0; i < 4; i++) crcInput[i] = type.charCodeAt(i);
		crcInput.set(data, 4);
		dv.setUint32(8 + data.length, crc32(crcInput));
		return out;
	}

	// Build raw scanlines: each row prefixed with filter byte 0x00
	const stride = width * 4;
	const raw = new Uint8Array((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[(stride + 1) * y] = 0;
		raw.set(
			rgba.subarray(y * stride, (y + 1) * stride),
			(stride + 1) * y + 1,
		);
	}

	// zlib container with one uncompressed deflate block per chunk of <=65535 bytes
	const blocks: number[] = [0x78, 0x01]; // zlib header (no compression, default window)
	let pos = 0;
	while (pos < raw.length) {
		const len = Math.min(65535, raw.length - pos);
		const last = pos + len === raw.length ? 1 : 0;
		blocks.push(last); // BFINAL only, BTYPE=00 (stored)
		blocks.push(len & 0xff, (len >> 8) & 0xff);
		const nlen = ~len & 0xffff;
		blocks.push(nlen & 0xff, (nlen >> 8) & 0xff);
		for (let i = 0; i < len; i++) blocks.push(raw[pos + i]);
		pos += len;
	}
	const adler = adler32(raw);
	blocks.push(
		(adler >>> 24) & 0xff,
		(adler >>> 16) & 0xff,
		(adler >>> 8) & 0xff,
		adler & 0xff,
	);
	const idat = new Uint8Array(blocks);

	const ihdr = new Uint8Array(13);
	const dv = new DataView(ihdr.buffer);
	dv.setUint32(0, width);
	dv.setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type RGBA
	ihdr[10] = 0; // compression
	ihdr[11] = 0; // filter
	ihdr[12] = 0; // interlace

	const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdrChunk = chunk("IHDR", ihdr);
	const idatChunk = chunk("IDAT", idat);
	const iendChunk = chunk("IEND", new Uint8Array(0));

	const total =
		sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
	const out = new Uint8Array(total);
	let o = 0;
	out.set(sig, o);
	o += sig.length;
	out.set(ihdrChunk, o);
	o += ihdrChunk.length;
	out.set(idatChunk, o);
	o += idatChunk.length;
	out.set(iendChunk, o);
	return out;
}

/**
 * Generates a QR code rasterized as a PNG of `sizePx` x `sizePx`.
 * Uses the qrcode package's matrix output (Worker-safe) and our pure-JS PNG
 * encoder above. Black on white, no quiet-zone margin (we add it via `margin`).
 */
export function qrPng(text: string, sizePx: number): Uint8Array {
	const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
	const modules = qr.modules;
	const moduleSide = modules.size;
	const quietMargin = 2; // modules of white border
	const grid = moduleSide + quietMargin * 2;
	const scale = Math.max(1, Math.floor(sizePx / grid));
	const finalSide = grid * scale;

	const rgba = new Uint8Array(finalSide * finalSide * 4);
	for (let i = 0; i < rgba.length; i += 4) {
		rgba[i] = 255;
		rgba[i + 1] = 255;
		rgba[i + 2] = 255;
		rgba[i + 3] = 255;
	}

	for (let y = 0; y < moduleSide; y++) {
		for (let x = 0; x < moduleSide; x++) {
			if (!modules.get(x, y)) continue;
			const px0 = (x + quietMargin) * scale;
			const py0 = (y + quietMargin) * scale;
			for (let dy = 0; dy < scale; dy++) {
				for (let dx = 0; dx < scale; dx++) {
					const off = ((py0 + dy) * finalSide + (px0 + dx)) * 4;
					rgba[off] = 0;
					rgba[off + 1] = 0;
					rgba[off + 2] = 0;
					rgba[off + 3] = 255;
				}
			}
		}
	}

	return encodePng(finalSide, finalSide, rgba);
}

/**
 * Builds a print-ready 1800x1200 postcard JPEG from any base image:
 *  - resizes/crops the base image to fill 1800x1200 (fit: cover)
 *  - composites the event-specific watermark in the bottom-right corner
 *    (event.watermark_image_key from R2, falling back to public/watermark.png)
 *  - optionally composites a QR code in the bottom-left corner
 *
 * Returns the Response from the Cloudflare Images binding directly.
 *
 * The `event` arg is optional for back-compat with test endpoints that don't
 * have a full EventRecord on hand. When omitted (or when the event has no
 * watermark_image_key), we fall back to the bundled public/watermark.png
 * asset — the original behavior before multi-event support.
 */
export async function buildPostcard(
	env: Env,
	baseStream: ReadableStream,
	opts: { qrUrl?: string; event?: EventRecord } = {},
): Promise<Response> {
	const watermarkBody = await loadWatermarkBody(env, opts.event);

	let pipeline = env.IMAGES.input(baseStream).transform({
		width: POSTCARD_W,
		height: POSTCARD_H,
		fit: "cover",
	});

	if (opts.qrUrl) {
		const png = qrPng(opts.qrUrl, POSTCARD_QR_W);
		const qrStream = new Response(png, {
			headers: { "content-type": "image/png" },
		}).body;
		if (qrStream) {
			pipeline = pipeline.draw(
				env.IMAGES.input(qrStream).transform({ width: POSTCARD_QR_W }),
				{
					bottom: POSTCARD_QR_MARGIN,
					left: POSTCARD_QR_MARGIN,
					opacity: 1,
				},
			);
		}
	}

	pipeline = pipeline.draw(
		env.IMAGES.input(watermarkBody).transform({ width: POSTCARD_WATERMARK_W }),
		{
			bottom: POSTCARD_WATERMARK_MARGIN,
			right: POSTCARD_WATERMARK_MARGIN,
			opacity: 0.95,
		},
	);

	const result = await pipeline.output({ format: "image/jpeg" });
	return result.response();
}

/**
 * Resolves the watermark image body to composite onto the postcard.
 *
 * Priority:
 *   1. event.watermark_image_key (R2) — uploaded via the admin UI
 *   2. public/watermark.png (ASSETS) — bundled default Cloudflare wordmark
 *
 * The R2 lookup is best-effort: if the key is set but the object is missing
 * (e.g. someone trashed it manually) we log and fall through to the bundled
 * asset rather than failing the whole postcard build.
 */
async function loadWatermarkBody(
	env: Env,
	event: EventRecord | undefined,
): Promise<ReadableStream> {
	if (event?.watermark_image_key) {
		const obj = await env.BUCKET.get(event.watermark_image_key);
		if (obj?.body) return obj.body;
		console.warn(
			`[postcard] event '${event.id}' references missing watermark R2 key '${event.watermark_image_key}', falling back to bundled asset`,
		);
	}

	const wmResp = await env.ASSETS.fetch(new Request("http://internal/watermark.png"));
	if (!wmResp.ok || !wmResp.body) {
		throw new Error("watermark asset not available");
	}
	return wmResp.body;
}
