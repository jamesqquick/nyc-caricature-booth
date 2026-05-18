/**
 * Image content moderation using Workers AI (Llama 3.2 11B Vision Instruct).
 * Shared between the test endpoints in src/index.ts and the workflow steps.
 */

export type ModerationVerdict = {
	safe: boolean;
	reasons: string[];
	raw: string;
	elapsedMs: number;
};

const MODERATION_SYSTEM_PROMPT = `You are a strict content moderation system for a public photo booth at a corporate event.
Examine the provided image and decide whether it is SAFE to use as the input photo for an AI caricature generator that will be printed as a postcard and displayed on a public screen.

Flag the image as UNSAFE if it contains any of:
- nudity, sexual content, or sexualized minors
- explicit violence, gore, or weapons aimed at people
- hate symbols or extremist imagery
- illegal drug use
- offensive gestures or profanity visible in the image
- celebrity impersonation or copyrighted characters as the primary subject
- text overtly promoting violence, hate, or harassment

A normal selfie of one or more adults (smiling, neutral, silly faces, casual clothes) is SAFE.
Slightly blurry photos, group photos, hats/sunglasses, and unusual angles are SAFE.

Respond with ONLY a single line of JSON, no markdown fences, no commentary, in this exact shape:
{"safe": true} or {"safe": false, "reasons": ["short reason 1", "short reason 2"]}`;

/**
 * Llama 3.2 Vision requires a one-time per-account license-acceptance prompt
 * ("agree") before it can be used. This sends that handshake.
 * The model paradoxically returns the success message as an AiError; we
 * swallow it because the side effect (license accepted) is what we want.
 */
async function acceptLlamaVisionLicense(ai: Ai): Promise<void> {
	try {
		await ai.run("@cf/meta/llama-3.2-11b-vision-instruct", {
			prompt: "agree",
		});
	} catch (err) {
		const msg = String(err);
		if (msg.includes("Thank you for agreeing")) return;
		throw err;
	}
}

export async function moderateImage(
	ai: Ai,
	imageBytes: Uint8Array,
): Promise<ModerationVerdict> {
	const started = Date.now();
	const imageArray = Array.from(imageBytes);

	async function callModel() {
		return (await ai.run("@cf/meta/llama-3.2-11b-vision-instruct", {
			messages: [
				{ role: "system", content: MODERATION_SYSTEM_PROMPT },
				{
					role: "user",
					content: "Is this image safe? Reply with the JSON verdict.",
				},
			],
			image: imageArray,
			max_tokens: 256,
		})) as { response?: string } | unknown;
	}

	let resp: unknown;
	try {
		resp = await callModel();
	} catch (err) {
		const msg = String(err);
		if (msg.includes("5016") && msg.toLowerCase().includes("agree")) {
			await acceptLlamaVisionLicense(ai);
			resp = await callModel();
		} else {
			throw err;
		}
	}
	const elapsedMs = Date.now() - started;

	const raw = JSON.stringify(resp);
	let safe = false;
	let reasons: string[] = [];
	let parsed = false;

	if (resp && typeof resp === "object" && "response" in resp) {
		const r = (resp as { response: unknown }).response;
		if (r && typeof r === "object") {
			const obj = r as { safe?: unknown; reasons?: unknown };
			safe = obj.safe === true;
			if (Array.isArray(obj.reasons)) reasons = obj.reasons.map(String);
			parsed = true;
		} else if (typeof r === "string") {
			const match = r.match(/\{[\s\S]*?\}/);
			if (match) {
				try {
					const obj = JSON.parse(match[0]) as { safe?: unknown; reasons?: unknown };
					safe = obj.safe === true;
					if (Array.isArray(obj.reasons)) reasons = obj.reasons.map(String);
					parsed = true;
				} catch {
					// fall through
				}
			}
		}
	}

	if (!parsed) {
		reasons = ["could not parse verdict — failing closed"];
	} else if (!safe && reasons.length === 0) {
		reasons = ["model returned safe=false with no reasons"];
	}

	return { safe, reasons, raw, elapsedMs };
}
