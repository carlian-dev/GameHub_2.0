// Transaction routes — auth required (guarded in controllers).
// Routes 34–38:
//   POST   /api/cashier/transactions              (34)  transactions_create (auth)
//   GET    /api/cashier/transactions              (35)  transactions_cashier_list (auth)
//   GET    /api/cashier/transactions/{ref}        (36)  transactions_cashier_get (auth)
//   GET    /api/admin/transactions                (37)  transactions_admin_list (admin)
//   GET    /api/admin/transactions/{ref}          (38)  transactions_admin_get (admin)
import { rateLimiters } from "../middleware/rateLimit.js";

export function registerTransactionRoutes(router, { transactionController }) {
  router.post("/cashier/transactions", transactionController.create);
  // The list endpoints return up to 200 full transaction documents and the
  // cashier dashboard polls them every 30s.
  router.get(
    "/cashier/transactions",
    rateLimiters.staffLists,
    transactionController.list
  );
  router.get("/cashier/transactions/:ref", transactionController.get);
  router.get(
    "/admin/transactions",
    rateLimiters.staffLists,
    transactionController.list
  );
  router.get("/admin/transactions/:ref", transactionController.get);
}
