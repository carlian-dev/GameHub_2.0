// Super-admin routes — requireSuperAdmin.
// This role is intentionally limited to turning API integrations on and off.
// Credentials remain behind the administrator endpoints (/api/admin/...).
import { requireSuperAdmin } from "../middleware/auth.js";

export function registerSuperAdminRoutes(router, { settingsController }) {
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
}
