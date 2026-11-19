// Route groups mounted under /api.
// One route group file per area (auth, admin, cashier, public).
// migration.md §9 layout: routes → controllers → services → models + views.
// Routes register directly on the main router (no sub-router mounting,
// which caused issues with Express 5).
import { Router } from "express";
import { superAdminScope } from "../middleware/auth.js";
import { featureAccessScope } from "../middleware/featureAccess.js";
import { rateLimiters } from "../middleware/rateLimit.js";
import { registerPublicRoutes } from "./public.routes.js";
import { registerAuthRoutes } from "./auth.routes.js";
import { registerAdminRoutes } from "./admin.routes.js";
import { registerSuperAdminRoutes } from "./superAdmin.routes.js";
import { registerTableRoutes } from "./tables.routes.js";
import { registerSessionRoutes } from "./session.routes.js";
import { registerTransactionRoutes } from "./transaction.routes.js";
import { registerReportRoutes } from "./report.routes.js";
import { registerProductRoutes } from "./products.routes.js";
import { registerOrderRoutes } from "./orders.routes.js";

export default function apiRoutes({ controllers, authenticate, featureAccess }) {
  const router = Router();

  // Resolve the JWT cookie into req.authUser before any limiter or route sees
  // it. Verification also re-checks the user's status and tokenVersion, so a
  // logout or archived account cannot keep using an old token.
  router.use(authenticate);

  // Signed-in writes are keyed by user id so one cafe IP with several cashiers
  // does not share a bucket; anonymous traffic falls back to IP keying.
  router.use(rateLimiters.writes);

  // Per-action cooldown (double-click/mash guard): the same user/IP may repeat
  // one method+path+payload only after ACTION_RATE_LIMIT_WINDOW_MS. Every
  // mutation route inherits it, so a page that forgets to disable its button is
  // still protected. Reads keep their own budgets below.
  router.use(rateLimiters.actions);

  // Least privilege for super admins: their token only unlocks /me, /logout,
  // and the super-admin integration routes. Public routes ignore the session,
  // so landing-page config keeps working. Operational /admin and /cashier
  // endpoints (sessions, billing, reservations, reports) are off limits even
  // when a controller otherwise checks only for a login.
  router.use(superAdminScope);

  // Super-admin feature matrix (RBAC): a switched-off admin/cashier feature is
  // rejected here, before any controller runs. Public paths and other roles
  // pass through; hiding the nav link alone would not be enforcement.
  router.use(featureAccessScope(featureAccess));

  // Public routes (no login required): health, config, register, invite check,
  // public table availability, rates, reservations.
  registerPublicRoutes(router, {
    healthController: controllers.health,
    settingsController: controllers.settings,
    tableController: controllers.table,
    rateController: controllers.rate,
    reservationController: controllers.reservation,
  });

  // Auth routes (session-based): login, logout, me, google, register, invite token, own activity logs.
  registerAuthRoutes(router, {
    authController: controllers.auth,
    invitationController: controllers.invitation,
    activityController: controllers.activity,
  });

  // Admin routes (requireAdmin).
  registerAdminRoutes(router, {
    invitationController: controllers.invitation,
    settingsController: controllers.settings,
    cashierController: controllers.cashier,
    activityController: controllers.activity,
  });

  // Super-admin routes (requireSuperAdmin): integration on/off + own 2FA.
  registerSuperAdminRoutes(router, {
    settingsController: controllers.settings,
    twoFactorController: controllers.twoFactor,
  });

  // Table routes (admin + public availability).
  registerTableRoutes(router, { tableController: controllers.table, rateController: controllers.rate });

  // Session routes (auth required).
  registerSessionRoutes(router, { sessionController: controllers.session });

  // F&B products (Sprint 5): admin catalogue + cashier read-only menu.
  registerProductRoutes(router, { productController: controllers.product });

  // F&B order lines (Sprint 5): bill summary + cashier mutations.
  registerOrderRoutes(router, { orderController: controllers.order });

  // Transaction routes (auth required).
  registerTransactionRoutes(router, { transactionController: controllers.transaction });

  // Report routes (admin only).
  registerReportRoutes(router, { reportController: controllers.report });

  return router;
}
