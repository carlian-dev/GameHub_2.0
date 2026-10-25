// Session routes — auth required (guarded in controllers).
// Routes 26–31:
//   GET    /api/admin/sessions                  (26)  sessions_list (admin)
//   GET    /api/cashier/sessions                (27)  sessions_cashier_list (auth)
//   POST   /api/cashier/sessions                (28)  sessions_start (auth)
//   POST   /api/cashier/sessions/{id}/extend    (29)  sessions_extend (auth)
//   POST   /api/cashier/sessions/{id}/end       (30)  sessions_end (auth)
//   POST   /api/cashier/sessions/{id}/cancel    (31)  sessions_cancel (auth)
export function registerSessionRoutes(router, { sessionController }) {
  router.get("/admin/sessions", sessionController.list);
  router.get("/cashier/sessions", sessionController.list);
  router.post("/cashier/sessions", sessionController.start);
  router.post("/cashier/sessions/:id/extend", sessionController.extend);
  router.post("/cashier/sessions/:id/end", sessionController.end);
  router.post("/cashier/sessions/:id/cancel", sessionController.cancel);
}
