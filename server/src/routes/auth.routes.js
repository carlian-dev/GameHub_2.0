// Auth routes — session based. Some are public (login, register, google,
// invite-check); logout/me require an active session (guarded in the controller).
// Routes 3–8:
//   POST /api/cashiers/register        (3)
//   GET  /api/invitations/{token}      (4)
//   POST /api/login                    (5)
//   POST /api/auth/google              (6)
//   POST /api/logout                   (7)   Auth
//   GET  /api/me                       (8)    Auth
//   PUT  /api/me/profile                      Self-service display name & avatar (any role; requires `version`)
//   GET  /api/me/activity-logs                Self activity audit (any role)
import { requireLogin } from "../middleware/auth.js";
import { rateLimiters } from "../middleware/rateLimit.js";

export function registerAuthRoutes(router, { authController, invitationController, activityController }) {
  // Public (no login). These are the only password/token-guessing surfaces, so
  // they get the strict `auth` limiter (successful attempts are not counted).
  router.post("/cashiers/register", rateLimiters.auth, authController.register);
  router.post("/auth/register", rateLimiters.auth, authController.register);
  router.get("/invitations/:token", rateLimiters.auth, invitationController.check);
  router.post("/login", rateLimiters.auth, authController.login);
  router.post("/auth/google", rateLimiters.auth, authController.google);
  router.post(
    "/forgot-password",
    // Mail budget first: it counts every request, so a known address cannot
    // be mail-bombed even though the auth limiter refunds successful requests.
    rateLimiters.notifications,
    rateLimiters.auth,
    authController.forgotPassword
  );
  router.get("/reset-password/:token", rateLimiters.auth, authController.verifyResetToken);
  router.post("/reset-password", rateLimiters.auth, authController.resetPassword);
  router.post(
    "/auth/forgot-password",
    rateLimiters.notifications,
    rateLimiters.auth,
    authController.forgotPassword
  );
  router.post("/auth/reset-password", rateLimiters.auth, authController.resetPassword);

  // Authenticated (session required — requireLogin applied inside controllers)
  router.post("/logout", authController.logout);
  router.get("/me", authController.me);
  // A profile save can carry a 2MB base64 avatar, so keep the budget small.
  router.put(
    "/me/profile",
    requireLogin,
    rateLimiters.profileEdits,
    authController.updateProfile
  );
  if (activityController && activityController.myList) {
    router.get(
      "/me/activity-logs",
      rateLimiters.audit,
      activityController.myList
    );
  }
}
