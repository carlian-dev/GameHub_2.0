// Report routes — admin only (guarded in controllers).
// Routes 39–42:
//   GET /api/admin/reports/daily   (39)  reports_daily
//   GET /api/admin/reports/monthly (40)  reports_monthly
//   GET /api/admin/reports/export  (41)  reports_export
//   GET /api/admin/reports/income  (42)  reports_income (from/to range)
import { rateLimiters } from "../middleware/rateLimit.js";

export function registerReportRoutes(router, { reportController }) {
  // Each report loads transaction rows into memory; CSV export is the largest.
  router.get("/admin/reports/daily", rateLimiters.reports, reportController.daily);
  router.get(
    "/admin/reports/monthly",
    rateLimiters.reports,
    reportController.monthly
  );
  router.get(
    "/admin/reports/export",
    rateLimiters.exports,
    reportController.export
  );
  router.get("/admin/reports/income", rateLimiters.reports, reportController.income);
}
