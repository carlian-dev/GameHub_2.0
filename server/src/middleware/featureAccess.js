// Route guard for the super-admin feature matrix (RBAC).
// Mounted on /api before the route groups: any request whose path belongs to a
// switched-off feature is rejected for the role that owns it. Public paths and
// other roles pass through untouched, so guest reservations and the super
// admin's own routes keep working.
import { HttpError } from "../utils/HttpError.js";
import { featureForRequest } from "../services/featureAccess.service.js";

export function featureAccessScope(featureAccess) {
  return async function featureAccessScopeMiddleware(req, res, next) {
    const user = req.authUser;
    if (!user || !user.role || !featureAccess) return next();
    const feature = featureForRequest(user.role, req.method, req.path || "");
    if (!feature) return next();
    try {
      if (!(await featureAccess.isEnabled(feature, user.role))) {
        return next(
          new HttpError(
            403,
            "this feature is turned off by the super administrator"
          )
        );
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
