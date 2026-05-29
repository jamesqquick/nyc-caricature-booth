/**
 * Print-agent auth — bearer token for the /api/print-agent/* endpoints.
 *
 * The print agent is a trusted machine client (a Node process running at the
 * venue), so instead of the signed-cookie scheme used for the browser-facing
 * admin dashboard, it presents a shared secret on every request:
 *
 *   Authorization: Bearer <token>
 *
 * The token is the `ADMIN_PASSWORD` secret — we deliberately reuse it rather
 * than introduce a second secret to manage. We compare in constant time and
 * fail closed if the secret isn't configured.
 */

import type { MiddlewareHandler } from "hono";
import { timingSafeEqual } from "./admin-auth";

/** Extract the token from an `Authorization: Bearer <token>` header. */
function readBearerToken(header: string | undefined): string | undefined {
	if (!header) return undefined;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match ? match[1].trim() : undefined;
}

/**
 * Hono middleware that gates all /api/print-agent/* routes.
 *
 * - Missing `ADMIN_PASSWORD` → 500 (fail closed).
 * - Missing/invalid bearer token → 401 JSON.
 */
export function printAgentAuthMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
	return async (c, next) => {
		const password = c.env.ADMIN_PASSWORD;
		if (!password) {
			// Fail closed if the secret isn't configured. Better to reject the
			// agent than to leave the print queue open.
			return c.text("ADMIN_PASSWORD not configured", 500);
		}

		const token = readBearerToken(c.req.header("authorization"));
		if (!token || !timingSafeEqual(token, password)) {
			return c.json({ error: "unauthorized" }, 401);
		}

		return next();
	};
}
