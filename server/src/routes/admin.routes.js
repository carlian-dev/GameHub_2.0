// Admin routes — requireAdmin (guarded in controllers).
// Routes 9–17:
//   POST /api/admin/invitations              (9)  invite_create
//   GET  /api/admin/invitations              (10) invite_list
//   POST /api/admin/invitations/{id}/revoke  (11) invite_revoke
//   GET  /api/admin/settings/integrations    (12) settings_list
//   PUT  /api/admin/settings/integrations/{key} (13) settings_update
//   GET  /api/admin/cashiers                 (14) cashiers_list
//   PUT  /api/admin/cashiers/{id}            (15) cashiers_update
//   POST /api/admin/cashiers/{id}/archive    (16) cashiers_archive
//   POST /api/admin/cashiers/{id}/unarchive  (17) cashiers_unarchive
export function registerAdminRoutes(router, { invitationController, settingsController, cashierController }) {
  // Invitations
  router.post("/admin/invitations", invitationController.create);
  router.get("/admin/invitations", invitationController.list);
  router.post("/admin/invitations/:id/revoke", invitationController.revoke);

  // Settings integrations
  router.get("/admin/settings/integrations", settingsController.adminIntegrations);
  router.put("/admin/settings/integrations/:key", settingsController.settingsUpdate);

  // Cashiers
  router.get("/admin/cashiers", cashierController.list);
  router.put("/admin/cashiers/:id", cashierController.update);
  router.post("/admin/cashiers/:id/archive", cashierController.archive);
  router.post("/admin/cashiers/:id/unarchive", cashierController.unarchive);
}
