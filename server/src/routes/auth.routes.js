// Auth routes — session based. Some are public (login, register, google,
// invite-check); logout/me require an active session (guarded in the controller).
// Routes 3–8:
//   POST /api/cashiers/register        (3)
//   GET  /api/invitations/{token}      (4)
//   POST /api/login                    (5)
//   POST /api/auth/google              (6)
//   POST /api/logout                   (7)   Auth
//   GET  /api/me                       (8)    Auth
export function registerAuthRoutes(router, { authController, invitationController }) {
  // Public (no login)
  router.post("/cashiers/register", authController.register);
  router.get("/invitations/:token", invitationController.check);
  router.post("/login", authController.login);
  router.post("/auth/google", authController.google);

  // Authenticated (session required — requireLogin applied inside controllers)
  router.post("/logout", authController.logout);
  router.get("/me", authController.me);
}
