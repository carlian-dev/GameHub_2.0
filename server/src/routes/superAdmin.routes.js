// Super-admin routes — requireSuperAdmin.
// This role owns API integration activation and credentials, plus managing its
// own authenticator app (two-factor authentication). Administrators can only
// read the on/off state; their write route was removed.
import { requireSuperAdmin } from "../middleware/auth.js";
import { rateLimiters } from "../middleware/rateLimit.js";

export function registerSuperAdminRoutes(
  router,
  { settingsController, twoFactorController }
) {
  router.get(
    "/super-admin/settings/integrations",
    requireSuperAdmin,
    settingsController.superAdminIntegrations
  );
  router.put(
    "/super-admin/settings/integrations/:key",
    requireSuperAdmin,
    settingsController.superAdminUpdate
  );

  // Two-factor authentication (TOTP) — super admin only.
  router.get("/super-admin/2fa", requireSuperAdmin, twoFactorController.status);
  router.post(
    "/super-admin/2fa/setup",
    requireSuperAdmin,
    twoFactorController.setup
  );
  router.post(
    "/super-admin/2fa/enable",
    requireSuperAdmin,
    // Failed codes count against the same strict auth budget as login, so a
    // hijacked session cannot brute-force the 6-digit authenticator code.
    rateLimiters.auth,
    twoFactorController.enable
  );
  router.post(
    "/super-admin/2fa/disable",
    requireSuperAdmin,
    rateLimiters.auth,
    twoFactorController.disable
  );
}
