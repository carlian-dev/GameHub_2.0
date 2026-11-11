// Auth middleware: requireLogin, requireAdmin, requireSuperAdmin, superAdminScope.
// Role comes from the session only — never from request data.
// migration.md §13.1
import { HttpError } from "../utils/HttpError.js";

/** Ensure a user is logged in (session has a user id). */
export function requireLogin(req, res, next) {
  const user = req.session && req.session.user;
  if (!user || !user.id) {
    return next(new HttpError(401, "not logged in"));
  }
  return next();
}

/** Ensure the logged-in user is an admin. */
export function requireAdmin(req, res, next) {
  const user = req.session && req.session.user;
  if (!user || !user.id) {
    return next(new HttpError(401, "not logged in"));
  }
  if (user.role !== "admin") {
    return next(new HttpError(403, "admin only"));
  }
  return next();
}

/** Ensure the logged-in user is a super admin (integration on/off only). */
export function requireSuperAdmin(req, res, next) {
  const user = req.session && req.session.user;
  if (!user || !user.id) {
    return next(new HttpError(401, "not logged in"));
  }
  if (user.role !== "super_admin") {
    return next(new HttpError(403, "super admin only"));
  }
  return next();
}

/**
 * Least-privilege scope for super admins: their session may use the auth
 * basics and /super-admin/*, but not operational admin/cashier routes.
 * Mounted on /api before the route groups so endpoints that only check for
 * a login cannot be reached by this role.
 */
export function superAdminScope(req, res, next) {
  const user = req.session && req.session.user;
  if (!user || user.role !== "super_admin") return next();
  const path = req.path || "";
  const blocked =
    path.startsWith("/admin/") ||
    path.startsWith("/cashier/") ||
    (path === "/reservations" && req.method === "GET");
  if (blocked) {
    return next(new HttpError(403, "super admin can only manage integrations"));
  }
  return next();
}

/** Ensure the logged-in user is a cashier (admins are read-only on orders). */
export function requireCashier(req, res, next) {
  const user = req.session && req.session.user;
  if (!user || !user.id) {
    return next(new HttpError(401, "not logged in"));
  }
  if (user.role !== "cashier") {
    return next(new HttpError(403, "cashier only"));
  }
  return next();
}

/** Attach the logged-in user to req.authUser for handlers that need it. */
export function attachAuthUser(req, res, next) {
  req.authUser = req.session && req.session.user ? req.session.user : null;
  return next();
}
