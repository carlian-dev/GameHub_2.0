// PayMongo routes.
//   POST /api/paymongo/webhook                         (public, signed)
//   POST /api/cashier/sessions/{id}/paymongo           (cashier)
//   GET  /api/cashier/paymongo/checkouts/{id}          (cashier)
//   POST /api/cashier/sessions/{id}/paymongo/cancel    (cashier)
import { requireCashier } from "../middleware/auth.js";

export function registerPaymongoRoutes(router, { transactionController }) {
  router.post("/paymongo/webhook", transactionController.paymongoWebhook);

  router.post(
    "/cashier/sessions/:id/paymongo",
    requireCashier,
    transactionController.paymongoCheckout
  );
  router.get(
    "/cashier/paymongo/checkouts/:id",
    requireCashier,
    transactionController.paymongoStatus
  );
  router.post(
    "/cashier/sessions/:id/paymongo/cancel",
    requireCashier,
    transactionController.paymongoCancel
  );
}
