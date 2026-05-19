// Augment the generated Env with secrets (not picked up by `wrangler types`).
// Set via: `npx wrangler secret put ADMIN_PASSWORD`

interface Env {
	/** Plaintext admin password — also used as the HMAC key for /admin cookie signing. */
	ADMIN_PASSWORD: string;
}
