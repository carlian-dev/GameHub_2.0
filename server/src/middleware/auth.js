// Auth middleware: authenticate, requireLogin, requireAdmin, requireSuperAdmin,
// superAdminScope. Role comes from the verified JWT plus the live user document
// — never from request data.
import { HttpError } from "../utils/HttpError.js";
import {
  clearAuthCookie,
  readAuthToken,
  verifyAuthToken,
} from "../utils/authToken.js";

/**
 * Resolve the JWT (Authorization: Bearer or HttpOnly cookie) into req.authUser.
 *
 * The signature and expiry are checked first, then the user is re-read from
 * Atlas so an archived account or a logout (tokenVersion bump) invalidates a
 * token immediately instead of waiting for it to expire. A bad/expired token
 * is treated as a guest and its cookie is cleared; route guards decide whether
 * the request needs a login, so public routes keep working.
 */
export function authenticate({ userModel }) {
  return async function authenticateRequest(req, res, next) {
    req.authUser = null;
    const token = readAuthToken(req);
    if (!token) return next();

    let claims;
    try {
      claims = verifyAuthToken(token);
    } catch {
      clearAuthCookie(res);
      return next();
    }

    try {
      const user = await userModel.findById(claims.sub);
      const active = Boolean(user) && user.status === "active";
      const versionMatches =
        active && Number(user.tokenVersion || 0) === Number(claims.ver || 0);
      if (!active || !versionMatches) {
        clearAuthCookie(res);
        return next();
      }
      req.authUser = {
        id: String(user._id),
        username: user.username ?? null,
        email: user.email ?? null,
        role: user.role,
      };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Ensure a user is logged in (a verified token + active account). */
export function requireLogin(req, res, next) {
  if (!req.authUser || !req.authUser.id) {
    return next(new HttpError(401, "not logged in"));
  }
  return next();
}

/** Ensure the logged-in user is an admin. */
export function requireAdmin(req, res, next) {
  if (!req.authUser || !req.authUser.id) {
    return next(new HttpError(401, "not logged in"));
  }
  if (req.authUser.role !== "admin") {
    return next(new HttpError(403, "admin only"));
  }
  return next();
}

/** Ensure the logged-in user is a super admin (integration on/off only). */
export function requireSuperAdmin(req, res, next) {
  if (!req.authUser || !req.authUser.id) {
    return next(new HttpError(401, "not logged in"));
  }
  if (req.authUser.role !== "super_admin") {
    return next(new HttpError(403, "super admin only"));
  }
  return next();
}

/**
 * Least-privilege scope for super admins: their token may use the auth basics
 * and /super-admin/*, but not operational admin/cashier routes. Mounted on
 * /api before the route groups so endpoints that only check for a login cannot
 * be reached by this role.
 */
export function superAdminScope(req, res, next) {
  const user = req.authUser;
  if (!user || user.role !== "super_admin") return next();
  const path = req.path || "";
  const blocked =
    path.startsWith("/admin/") ||
    path.startsWith("/cashier/") ||
    (path === "/reservations" && req.method === "GET");
  if (blocked) {
    return next(new HttpError(403, "super admin can only manage integrations and security"));
  }
  return next();
}

/** Ensure the logged-in user is a cashier (admins are read-only on orders). */
export function requireCashier(req, res, next) {
  if (!req.authUser || !req.authUser.id) {
    return next(new HttpError(401, "not logged in"));
  }
  if (req.authUser.role !== "cashier") {
    return next(new HttpError(403, "cashier only"));
  }
  return next();
}

/** Attach the verified user to req.authUser for handlers that need it. */
export function attachAuthUser(req, res, next) {
  req.authUser = req.authUser || null;
  return next();
}
