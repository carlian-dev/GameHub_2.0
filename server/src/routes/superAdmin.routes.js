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
  router.get(
    "/super-admin/settings/login-protection",
    requireSuperAdmin,
    settingsController.superAdminGetAuthRateLimit
  );
  router.put(
    "/super-admin/settings/login-protection",
    requireSuperAdmin,
    settingsController.superAdminUpdateAuthRateLimit
  );
  // Restore every integration to its base .env values (clears the *_OVERRIDE
  // fields and saved credentials). It verifies an authenticator code, so failed
  // attempts count against the strict auth budget.
  router.post(
    "/super-admin/settings/integrations/reset",
    requireSuperAdmin,
    rateLimiters.auth,
    settingsController.superAdminReset
  );
  router.put(
    "/super-admin/settings/integrations/:key",
    requireSuperAdmin,
    settingsController.superAdminUpdate
  );

  // Two-factor authentication (TOTP) — super admin only. A setup adds another
  // device; the existing devices keep working.
  router.get("/super-admin/2fa", requireSuperAdmin, twoFactorController.status);
  router.post(
    "/super-admin/2fa/setup",
    requireSuperAdmin,
    // Adding a device verifies a code from an already-paired device, so failed
    // attempts must share the strict login/auth budget.
    rateLimiters.auth,
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
    "/super-admin/2fa/devices/:id/remove",
    requireSuperAdmin,
    rateLimiters.auth,
    twoFactorController.removeDevice
  );
  router.post(
    "/super-admin/2fa/disable",
    requireSuperAdmin,
    rateLimiters.auth,
    twoFactorController.disable
  );
}
