/**
 * Admin auth helpers — signed cookie for the /admin/* dashboard (Phase 10.1).
 *
 * Token format:   `<timestampMs>.<hex-hmac-sha256>`
 * Signed payload: `admin:<timestampMs>`
 * Key:            the ADMIN_PASSWORD secret (raw bytes of the UTF-8 string)
 *
 * The token expires 24h after `<timestampMs>`. We re-validate the HMAC on every
 * request, so rotating the secret instantly invalidates every existing cookie.
 *
 * Cookie name:    `admin_session`
 * Cookie flags:   HttpOnly, Secure, SameSite=Strict, Path=/, Max-Age=86400
 *
 * Trade-off vs. JWT/Iron-session libraries: this is intentionally small. We
 * never need to encode anything other than "this caller knew the password at
 * time T", and we don't want a third-party dep just for that.
 */

import type { Context, MiddlewareHandler } from "hono";

export const ADMIN_COOKIE = "admin_session";
const COOKIE_MAX_AGE_S = 60 * 60 * 24; // 24h
const COOKIE_MAX_AGE_MS = COOKIE_MAX_AGE_S * 1000;

const encoder = new TextEncoder();

async function hmacHex(key: string, payload: string): Promise<string> {
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		encoder.encode(key),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
	const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(payload));
	return [...new Uint8Array(sig)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Constant-time string compare (lengths must match — short-circuit allowed). */
export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

/** Mint a fresh admin token. */
export async function signAdminToken(password: string): Promise<string> {
	const ts = Date.now();
	const payload = `admin:${ts}`;
	const sig = await hmacHex(password, payload);
	return `${ts}.${sig}`;
}

/** Verify a cookie value. Returns true if signed and within 24h. */
export async function verifyAdminToken(
	token: string | undefined,
	password: string,
): Promise<boolean> {
	if (!token) return false;
	const dot = token.indexOf(".");
	if (dot <= 0) return false;
	const tsStr = token.slice(0, dot);
	const sig = token.slice(dot + 1);

	const ts = Number(tsStr);
	if (!Number.isFinite(ts) || ts <= 0) return false;
	if (Date.now() - ts > COOKIE_MAX_AGE_MS) return false;

	const expected = await hmacHex(password, `admin:${tsStr}`);
	return timingSafeEqual(sig, expected);
}

/**
 * Parse a single cookie name out of the `Cookie:` request header.
 * Hono has a cookie helper but we keep this dep-free since the rest of the
 * codebase doesn't import from `hono/cookie` yet.
 */
export function readCookie(c: Context, name: string): string | undefined {
	const header = c.req.header("cookie");
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		const k = part.slice(0, eq).trim();
		if (k === name) {
			return decodeURIComponent(part.slice(eq + 1).trim());
		}
	}
	return undefined;
}

/** Set the admin cookie on a response. */
export function setAdminCookie(c: Context, token: string): void {
	c.header(
		"set-cookie",
		`${ADMIN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_S}`,
		{ append: true },
	);
}

/** Clear the admin cookie (used by /admin/logout). */
export function clearAdminCookie(c: Context): void {
	c.header(
		"set-cookie",
		`${ADMIN_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
		{ append: true },
	);
}

/**
 * Hono middleware that gates all /admin/* and /api/admin/* routes.
 *
 * - For `/admin/*` (browser routes), missing/invalid cookie → 302 to /admin/login.
 * - For `/api/admin/*` (XHR routes), missing/invalid cookie → 401 JSON.
 *
 * The login + logout routes are exempt (they're registered before this
 * middleware applies, but we also exclude them defensively).
 */
export function adminAuthMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
	return async (c, next) => {
		const path = new URL(c.req.url).pathname;

		// Exempt the auth endpoints themselves.
		if (
			path === "/admin/login" ||
			path === "/admin/logout"
		) {
			return next();
		}

		const password = c.env.ADMIN_PASSWORD;
		if (!password) {
			// Fail closed if the secret isn't configured. Better to lock out
			// admins than to leave the dashboard open.
			return c.text("ADMIN_PASSWORD not configured", 500);
		}

		const token = readCookie(c, ADMIN_COOKIE);
		const ok = await verifyAdminToken(token, password);
		if (ok) {
			return next();
		}

		if (path.startsWith("/api/admin/")) {
			return c.json({ error: "unauthorized" }, 401);
		}
		return c.redirect("/admin/login", 302);
	};
}
