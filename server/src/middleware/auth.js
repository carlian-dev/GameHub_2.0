// Auth middleware: requireLogin, requireAdmin.
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

/** Attach the logged-in user to req.authUser for handlers that need it. */
export function attachAuthUser(req, res, next) {
  req.authUser = req.session && req.session.user ? req.session.user : null;
  return next();
}
