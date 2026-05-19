// Augment the generated Env with secrets (not picked up by `wrangler types`).
// Set via: `npx wrangler secret put <SECRET_NAME>`

interface Env {
	/** Plaintext admin password — also used as the HMAC key for /admin cookie signing. */
	ADMIN_PASSWORD: string;
	/** API token with Account Analytics Read permission — used to query Analytics Engine SQL API from /admin/metrics. */
	AE_API_TOKEN?: string;
}
