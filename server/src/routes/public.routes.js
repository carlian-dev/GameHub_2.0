// Public routes — no login required.
// GET /api/health           (route 1)
// GET /api/config           (route 2)
// GET /api/tables/availability (route 33)
// POST/GET/POST /api/reservations* (guest); GET /api/reservations is the
// cashier dashboard list and requires a session (enforced in the controller).
import { Router } from "express";

export function registerPublicRoutes(router, { healthController, settingsController, tableController, rateController, reservationController }) {
  router.get("/health", healthController.get);
  router.get("/config", settingsController.publicConfig);
  router.get("/tables/availability", tableController.publicList);
  router.get("/rates", rateController.publicList);
  // Reservations (guest, no login).
  router.post("/reservations", reservationController.create);
  // Cashier dashboard reservation list (401 without a session).
  router.get("/reservations", reservationController.list);
  // Cashier decisions on pending requests (401 without a session).
  router.post("/cashier/reservations/:ref/accept", reservationController.accept);
  router.post("/cashier/reservations/:ref/reject", reservationController.reject);
  router.get("/reservations/:ref", reservationController.get);
  router.post("/reservations/:ref/cancel", reservationController.cancel);
}
