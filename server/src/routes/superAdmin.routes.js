// Super-admin routes — requireSuperAdmin.
// This role is intentionally limited to turning API integrations on and off
// plus managing its own authenticator app (two-factor authentication).
// Credentials remain behind the administrator endpoints (/api/admin/...).
import { requireSuperAdmin } from "../middleware/auth.js";

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
    twoFactorController.enable
  );
  router.post(
    "/super-admin/2fa/disable",
    requireSuperAdmin,
    twoFactorController.disable
  );
}
