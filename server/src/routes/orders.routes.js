// F&B order routes — Sprint 5 (CA-020/027/028).
// The bill summary is readable by any logged-in staff (admin read-only);
// add/update/remove are cashier-only, matching the permission matrix.
import { requireCashier, requireLogin } from "../middleware/auth.js";

export function registerOrderRoutes(router, { orderController }) {
  router.get(
    "/cashier/sessions/:id/bill",
    requireLogin,
    orderController.bill
  );
  router.post(
    "/cashier/sessions/:id/orders",
    requireCashier,
    orderController.add
  );
  router.put(
    "/cashier/sessions/:id/orders/:lineId",
    requireCashier,
    orderController.update
  );
  router.delete(
    "/cashier/sessions/:id/orders/:lineId",
    requireCashier,
    orderController.remove
  );
}
