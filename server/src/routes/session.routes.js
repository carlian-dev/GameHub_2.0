// Session routes — auth required (guarded in controllers).
// Routes 26–31:
//   GET    /api/admin/sessions                  (26)  sessions_list (admin)
//   GET    /api/cashier/sessions                (27)  sessions_cashier_list (auth)
//   POST   /api/cashier/sessions                (28)  sessions_start (auth)
//   POST   /api/cashier/sessions/{id}/extend    (29)  sessions_extend (auth)
//   POST   /api/cashier/sessions/{id}/end       (30)  sessions_end (auth)
//   POST   /api/cashier/sessions/{id}/cancel    (31)  sessions_cancel (auth)
import { rateLimiters } from "../middleware/rateLimit.js";

export function registerSessionRoutes(router, { sessionController }) {
  // Both lists run the expiry sweep and join table/cashier names, and
  // dashboards poll them every 30s: give them the staff-list budget.
  router.get("/admin/sessions", rateLimiters.staffLists, sessionController.list);
  router.get("/cashier/sessions", rateLimiters.staffLists, sessionController.list);
  router.post("/cashier/sessions", sessionController.start);
  router.post("/cashier/sessions/:id/extend", sessionController.extend);
  router.post("/cashier/sessions/:id/end", sessionController.end);
  router.post("/cashier/sessions/:id/cancel", sessionController.cancel);
}
