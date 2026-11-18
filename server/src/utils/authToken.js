// Stateless auth tokens: sign/verify a JWT and manage its HttpOnly cookie.
// The token is the only client-side credential — there is no server-side
// session store. `ver` carries the user's tokenVersion so a logout (which
// increments it) invalidates every token issued before that moment.
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const ALGORITHM = "HS256";

/** Sign a short-lived token for a user document. */
export function signAuthToken(user) {
  const id = String((user && (user._id ?? user.id)) || "");
  if (!id) throw new Error("cannot sign a token without a user id");
  return jwt.sign(
    {
      role: user.role,
      username: user.username ?? null,
      email: user.email ?? null,
      ver: Number(user.tokenVersion || 0),
    },
    env.JWT_SECRET,
    {
      algorithm: ALGORITHM,
      subject: id,
      expiresIn: env.JWT_TTL_SECONDS,
    }
  );
}

/** Verify signature + expiry. Throws on any invalid token. */
export function verifyAuthToken(token) {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
}

function cookieAttributes() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
  };
}

/** Attach the token as an HttpOnly cookie (not readable by JavaScript). */
export function setAuthCookie(res, token) {
  res.cookie(env.AUTH_COOKIE_NAME, token, {
    ...cookieAttributes(),
    maxAge: env.JWT_TTL_SECONDS * 1000,
  });
}

/** Remove the JWT cookie and any cookie left by the old session deployment. */
export function clearAuthCookie(res) {
  const attrs = cookieAttributes();
  res.clearCookie(env.AUTH_COOKIE_NAME, attrs);
  if (env.AUTH_COOKIE_NAME !== "gh_session") {
    res.clearCookie("gh_session", attrs);
  }
}

/**
 * Read the raw token: `Authorization: Bearer <jwt>` first (API clients), then
 * the HttpOnly cookie (the browser sends it automatically).
 */
export function readAuthToken(req) {
  const header = req && req.headers ? req.headers.authorization : "";
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
    if (match) return match[1].trim();
  }
  return readAuthCookie(req);
}

/** Read the raw token from the Cookie header (no cookie-parser dependency). */
export function readAuthCookie(req) {
  const header = req && req.headers ? req.headers.cookie : "";
  if (!header) return null;
  for (const part of String(header).split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== env.AUTH_COOKIE_NAME) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}
