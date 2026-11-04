// Report routes — admin only (guarded in controllers).
// Routes 39–42:
//   GET /api/admin/reports/daily   (39)  reports_daily
//   GET /api/admin/reports/monthly (40)  reports_monthly
//   GET /api/admin/reports/export  (41)  reports_export
//   GET /api/admin/reports/income  (42)  reports_income (from/to range)
export function registerReportRoutes(router, { reportController }) {
  router.get("/admin/reports/daily", reportController.daily);
  router.get("/admin/reports/monthly", reportController.monthly);
  router.get("/admin/reports/export", reportController.export);
  router.get("/admin/reports/income", reportController.income);
}
