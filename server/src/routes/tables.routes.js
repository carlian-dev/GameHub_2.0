// Table routes — admin only (guarded in controllers).
// Routes 18–25:
//   GET    /api/admin/tables              (18) tables_list
//   POST   /api/admin/tables              (19) tables_add
//   PUT    /api/admin/tables/{id}         (20) tables_rename
//   PUT    /api/admin/tables/{id}/status  (21) tables_status
//   POST   /api/admin/tables/{id}/archive (22) tables_archive
//   POST   /api/admin/tables/{id}/unarchive (23) tables_unarchive
//   GET    /api/admin/rates               (24) rates_list
//   PUT    /api/admin/rates               (25) rates_set
// Route 32:
//   GET /api/cashier/tables (auth) - cashier read-only table list
export function registerTableRoutes(router, { tableController, rateController }) {
  router.get("/admin/tables", tableController.list);
  router.post("/admin/tables", tableController.add);
  router.put("/admin/tables/:id", tableController.rename);
  router.put("/admin/tables/:id/status", tableController.status);
  router.post("/admin/tables/:id/archive", tableController.archive);
  router.post("/admin/tables/:id/unarchive", tableController.unarchive);

  // Rates (routes 24–25).
  router.get("/admin/rates", rateController.list);
  router.put("/admin/rates", rateController.set);

  // Cashier table list (route 32).
  router.get("/cashier/tables", tableController.cashierList);
}
