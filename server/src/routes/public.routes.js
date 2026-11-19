// Public routes — no login required.
// GET /api/health           (route 1)
// GET /api/config           (route 2)
// GET /api/tables/availability (route 33)
// POST/GET/POST /api/reservations* (guest); GET /api/reservations is the
// cashier dashboard list and requires a session (enforced in the controller).
import { Router } from "express";
import { rateLimiters } from "../middleware/rateLimit.js";

export function registerPublicRoutes(router, { healthController, settingsController, tableController, rateController, reservationController }) {
  router.get("/health", rateLimiters.health, healthController.get);
  router.get("/config", settingsController.publicConfig);
  router.get("/tables/availability", tableController.publicList);
  router.get("/rates", rateController.publicList);
  // Reservations (guest, no login). The `reservations` limiter also slows
  // guessing of the reference + contact pair; it is per IP, so it must NOT be
  // mounted on the cashier list below.
  router.post("/reservations", rateLimiters.reservations, reservationController.create);
  // Cashier dashboard reservation list (401 without a session). This is a
  // full reservations read, so it has its own per-user budget.
  router.get("/reservations", rateLimiters.staffLists, reservationController.list);
  // Cashier decisions on pending requests (401 without a session). Accepting
  // creates a calendar event and sends mail, so it has its own budget.
  router.post(
    "/cashier/reservations/:ref/accept",
    rateLimiters.notifications,
    reservationController.accept
  );
  router.post("/cashier/reservations/:ref/reject", reservationController.reject);
  // Cashier check-in: accepted request -> session starts, table occupied.
  router.post("/cashier/reservations/:ref/check-in", reservationController.checkIn);
  router.get("/reservations/:ref", rateLimiters.reservations, reservationController.get);
  router.post(
    "/reservations/:ref/cancel",
    rateLimiters.reservations,
    reservationController.cancel
  );
}
