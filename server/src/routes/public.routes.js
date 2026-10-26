// Public routes — no login required.
// GET /api/health           (route 1)
// GET /api/config           (route 2)
// GET /api/tables/availability (route 33)
import { Router } from "express";

export function registerPublicRoutes(router, { healthController, settingsController, tableController }) {
  router.get("/health", healthController.get);
  router.get("/config", settingsController.publicConfig);
  router.get("/tables/availability", tableController.publicList);
}
