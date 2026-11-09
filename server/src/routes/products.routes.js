// F&B product routes — Sprint 5 (AD-031/032/033, CA-026).
// Admin catalogue management + read-only cashier menu. Role guards run as
// route middleware so a cashier gets 403 on mutations and guests get 401.
import { requireAdmin, requireLogin } from "../middleware/auth.js";

export function registerProductRoutes(router, { productController }) {
  // Admin catalogue
  router.get("/admin/products", requireAdmin, productController.adminList);
  router.post("/admin/products", requireAdmin, productController.create);
  router.put("/admin/products/:id", requireAdmin, productController.update);
  router.post(
    "/admin/products/:id/archive",
    requireAdmin,
    productController.archive
  );
  router.post(
    "/admin/products/:id/unarchive",
    requireAdmin,
    productController.unarchive
  );

  // Cashier read-only menu (active products only)
  router.get("/cashier/products", requireLogin, productController.cashierList);
}
