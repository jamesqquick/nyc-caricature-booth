/**
 * Email helper for sending postcard digital copies.
 *
 * Currently **stubbed** — logs the email to console instead of sending.
 * To enable real sending:
 *   1. Onboard a domain to Cloudflare Email Service and add SPF/DKIM DNS records.
 *   2. Update FROM_ADDRESS below to use that domain.
 *   3. Uncomment the `env.EMAIL.send(...)` call and remove the stub log.
 *   4. Optionally set `"remote": true` on the send_email binding in
 *      wrangler.jsonc so `wrangler dev` sends real emails.
 */

// TODO: Replace with a real verified domain once Email Service is set up.
const FROM_ADDRESS = "booth@nyc-booth.example.com";
const FROM_NAME = "I 🧡 NY — Caricature Booth";

export interface PostcardEmailParams {
	to: string;
	sessionId: string;
	sceneName: string;
	/** Full public URL to the digital pickup page, e.g. https://…/p/<uuid> */
	pickupUrl: string;
	/** Full public URL to the postcard image, e.g. https://…/api/run-img?key=… */
	postcardImageUrl: string;
	/** Full public URL to the downloadable postcard, e.g. https://…/api/run-img?key=…&download=1 */
	downloadUrl: string;
}

/**
 * Sends (or stubs) the postcard digital copy email.
 *
 * Returns `{ sent: true, messageId }` on success, or `{ sent: false, error }`
 * if sending failed. The caller should treat failures as non-fatal — the email
 * address is already persisted in D1 and can be retried later.
 */
export async function sendPostcardEmail(
	env: Env,
	params: PostcardEmailParams,
): Promise<{ sent: boolean; messageId?: string; error?: string }> {
	const { to, sceneName, pickupUrl, postcardImageUrl, downloadUrl, sessionId } = params;

	const subject = `Your ${sceneName} postcard — I 🧡 NY`;

	const html = buildHtmlEmail({
		sceneName,
		pickupUrl,
		postcardImageUrl,
		downloadUrl,
	});

	const text = buildTextEmail({
		sceneName,
		pickupUrl,
		downloadUrl,
	});

	// ---- STUB: log instead of sending ----
	// Remove this block and uncomment the real send below once a domain is configured.
	console.log(
		`[email-stub] would send to=${to} subject="${subject}" session=${sessionId} pickup=${pickupUrl}`,
	);
	return { sent: true, messageId: `stub-${sessionId}` };

	// ---- REAL SEND (uncomment when domain is ready) ----
	// try {
	// 	const result = await env.EMAIL.send({
	// 		from: { name: FROM_NAME, address: FROM_ADDRESS },
	// 		to,
	// 		subject,
	// 		html,
	// 		text,
	// 	});
	// 	console.log(`[email] sent to=${to} session=${sessionId} messageId=${result.messageId}`);
	// 	return { sent: true, messageId: result.messageId };
	// } catch (err) {
	// 	const message = err instanceof Error ? err.message : String(err);
	// 	console.error(`[email] failed to=${to} session=${sessionId} error=${message}`);
	// 	return { sent: false, error: message };
	// }
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function buildHtmlEmail(params: {
	sceneName: string;
	pickupUrl: string;
	postcardImageUrl: string;
	downloadUrl: string;
}): string {
	const { sceneName, pickupUrl, postcardImageUrl, downloadUrl } = params;

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your ${sceneName} postcard</title>
  <style>
    body { margin: 0; padding: 0; background: #1a1a2e; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; padding: 32px 24px; }
    .header { text-align: center; margin-bottom: 24px; }
    .header h1 { font-size: 28px; font-weight: 800; margin: 0 0 4px; }
    .header p { color: #999; font-size: 14px; margin: 0; }
    .postcard-img { width: 100%; border-radius: 12px; display: block; }
    .cta { display: inline-block; background: #f6821f; color: #000000; font-weight: 700; font-size: 16px; padding: 14px 32px; border-radius: 999px; text-decoration: none; margin-top: 24px; }
    .cta:hover { background: #e0741a; }
    .secondary { display: inline-block; color: #f6821f; font-size: 14px; text-decoration: underline; margin-top: 12px; }
    .footer { margin-top: 40px; text-align: center; color: #666; font-size: 12px; }
    .footer img { height: 16px; vertical-align: middle; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Your ${sceneName} postcard</h1>
      <p>AI caricature generated at Cloudflare NY Tech Week 2026</p>
    </div>

    <a href="${pickupUrl}">
      <img src="${postcardImageUrl}" alt="Your ${sceneName} postcard" class="postcard-img" />
    </a>

    <div style="text-align: center;">
      <a href="${downloadUrl}" class="cta">Download high-res postcard</a>
      <br />
      <a href="${pickupUrl}" class="secondary">View online</a>
    </div>

    <div class="footer">
      <p>Built end-to-end on Cloudflare</p>
      <p style="color: #444; font-size: 11px;">
        You received this because you opted in at the I 🧡 NY booth.<br />
        This is a one-time email — we won't send anything else.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function buildTextEmail(params: {
	sceneName: string;
	pickupUrl: string;
	downloadUrl: string;
}): string {
	return `Your ${params.sceneName} postcard — I 🧡 NY

AI caricature generated at Cloudflare NY Tech Week 2026.

View your postcard online:
${params.pickupUrl}

Download high-res:
${params.downloadUrl}

---
Built end-to-end on Cloudflare.
You received this because you opted in at the I 🧡 NY booth.
This is a one-time email — we won't send anything else.`;
}
