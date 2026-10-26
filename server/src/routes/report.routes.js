// Report routes — admin only (guarded in controllers).
// Routes 39–40:
//   GET /api/admin/reports/daily   (39)  reports_daily
//   GET /api/admin/reports/export  (40)  reports_export
export function registerReportRoutes(router, { reportController }) {
  router.get("/admin/reports/daily", reportController.daily);
  router.get("/admin/reports/export", reportController.export);
}
