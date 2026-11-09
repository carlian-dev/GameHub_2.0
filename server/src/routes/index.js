// Route groups mounted under /api.
// One route group file per area (auth, admin, cashier, public).
// migration.md §9 layout: routes → controllers → services → models + views.
// Routes register directly on the main router (no sub-router mounting,
// which caused issues with Express 5).
import { Router } from "express";
import { registerPublicRoutes } from "./public.routes.js";
import { registerAuthRoutes } from "./auth.routes.js";
import { registerAdminRoutes } from "./admin.routes.js";
import { registerTableRoutes } from "./tables.routes.js";
import { registerSessionRoutes } from "./session.routes.js";
import { registerTransactionRoutes } from "./transaction.routes.js";
import { registerReportRoutes } from "./report.routes.js";
import { registerProductRoutes } from "./products.routes.js";
import { registerOrderRoutes } from "./orders.routes.js";
import { registerPaymongoRoutes } from "./paymongo.routes.js";

export default function apiRoutes({ controllers }) {
  const router = Router();

  // Public routes (no login required): health, config, register, invite check,
  // public table availability, rates, reservations.
  registerPublicRoutes(router, {
    healthController: controllers.health,
    settingsController: controllers.settings,
    tableController: controllers.table,
    rateController: controllers.rate,
    reservationController: controllers.reservation,
  });

  // Auth routes (session-based): login, logout, me, google, register, invite token.
  registerAuthRoutes(router, {
    authController: controllers.auth,
    invitationController: controllers.invitation,
  });

  // Admin routes (requireAdmin).
  registerAdminRoutes(router, {
    invitationController: controllers.invitation,
    settingsController: controllers.settings,
    cashierController: controllers.cashier,
    activityController: controllers.activity,
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

  // PayMongo hosted checkout + signed webhook.
  registerPaymongoRoutes(router, { transactionController: controllers.transaction });

  // Report routes (admin only).
  registerReportRoutes(router, { reportController: controllers.report });

  return router;
}
