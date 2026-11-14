// Auth service — business rules for login/logout/me/register/google.
// migration.md §13.1 (auth & sessions), §13.2 (invitations).
// Role comes from the session only — never from request data.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { invitationModel } from "../models/invitation.model.js";
import { isValidGoogleClientId } from "../utils/google.js";

export function authService({
  userModel,
  settingsModel,
  db,
  googleClientIdFromEnv = "",
  googleAuthConfigProvider = null,
  recaptchaService = null,
  twoFactorService = null,
}) {
  const usersColl = db.collection("users");
  const activityLogsColl = db.collection("activityLogs");

  // Status gates in order (migration.md §13.1).
  const STATUS_GATES = [
    ["pending", "awaiting admin approval"],
    ["archived", "account archived"],
    ["declined", "application was declined"],
  ];

  // Super-admin 2FA: the challenge lives in the session until a code is
  // verified, so no authenticated `user` exists in the meantime.
  const TWO_FACTOR_KEY = "twoFactorChallenge";
  const CHALLENGE_TTL_MS = 5 * 60 * 1000;
  const ENROLLMENT_TTL_MS = 10 * 60 * 1000;
  const MAX_2FA_ATTEMPTS = 5;

  function statusError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
  }

  async function checkStatus(user) {
    for (const [status, message] of STATUS_GATES) {
      if (user.status === status) {
        const err = new Error(message);
        err.status = 403;
        throw err;
      }
    }
    if (user.status !== "active") {
      const err = new Error("account is not active");
      err.status = 403;
      throw err;
    }
  }

  /** Audit sign-in/sign-out events for the admin activity viewer. */
  async function logAuth(action, user, provider = "") {
    const id = user && (user._id ?? user.id);
    if (!id) return;
    try {
      await activityLogsColl.insertOne({
        actorId: String(id),
        action,
        target: String(id),
        meta: {
          role: user.role ?? null,
          ...(provider ? { provider } : {}),
          username: user.username ?? null,
          email: user.email ?? null,
        },
        at: new Date(),
      });
    } catch {
      // Audit is best-effort: a log write must never block sign-in/sign-out.
    }
  }

  function sessionPayload(user) {
    return {
      id: String(user._id),
      username: user.username ?? null,
      email: user.email ?? null,
      role: user.role,
    };
  }

  async function regenerateSession(req) {
    if (req.session && typeof req.session.regenerate === "function") {
      await new Promise((resolve, reject) => {
        req.session.regenerate((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  }

  async function destroySession(req) {
    if (req.session && typeof req.session.destroy === "function") {
      await new Promise((resolve, reject) => {
        req.session.destroy((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  }

  /**
   * Start a super-admin 2FA challenge. The session is regenerated first
   * (fixation defence) and holds only a pending challenge — never `user` —
   * until the authenticator code is verified.
   */
  async function startTwoFactor(req, user, mode, provider) {
    await regenerateSession(req);
    const now = Date.now();
    req.session[TWO_FACTOR_KEY] = {
      userId: String(user._id),
      mode,
      provider,
      attempts: 0,
      issuedAt: now,
      expiresAt: now + (mode === "enroll" ? ENROLLMENT_TTL_MS : CHALLENGE_TTL_MS),
    };
    if (typeof req.session.save === "function") await req.session.save();
  }

  /** Create the real logged-in session after password/Google (+2FA) passes. */
  async function completeLogin(req, user, provider) {
    const payload = sessionPayload(user);
    await regenerateSession(req);
    req.session.user = payload;
    if (typeof req.session.save === "function") await req.session.save();
    await logAuth("login", user, provider);
    return { username: user.username ?? null, email: user.email ?? null, role: user.role };
  }

  return {
    /** Dual identifier login: email if contains @, else username (cashier only). */
    async login({ identifier, password, recaptchaToken }, req) {
      if (!identifier || !password) {
        const err = new Error("login and password are required");
        err.status = 422;
        throw err;
      }

      // Bot protection (no-op unless the admin enabled reCAPTCHA).
      if (recaptchaService && typeof recaptchaService.verify === "function") {
        await recaptchaService.verify(recaptchaToken, req && req.ip);
      }

      let user;
      if (String(identifier).includes("@")) {
        user = await userModel.findByEmail(identifier);
      } else {
        user = await userModel.findByUsername(identifier);
      }

      if (!user) {
        const err = new Error("invalid credentials");
        err.status = 401;
        throw err;
      }

      const passwordHash = user.passwordHash || "";
      const valid = await bcrypt.compare(password, passwordHash);
      if (!valid) {
        const err = new Error("invalid credentials");
        err.status = 401;
        throw err;
      }

      await checkStatus(user);

      // Super admins always go through the authenticator app. No 2FA enrolled
      // means the login session stays pending until setup is confirmed.
      if (twoFactorService) {
        const challenge = await twoFactorService.challengeState(user);
        if (challenge.required) {
          await startTwoFactor(req, user, challenge.mode, "password");
          return {
            twoFactorRequired: true,
            enrollmentRequired: challenge.mode === "enroll",
          };
        }
      }

      return completeLogin(req, user, "password");
    },

    /** Finish a super-admin login with a 6-digit authenticator code. */
    async verifyTwoFactor({ code } = {}, req) {
      const pending = req.session && req.session[TWO_FACTOR_KEY];
      if (!pending || !pending.userId) {
        throw statusError(401, "sign in first");
      }
      if (!twoFactorService) {
        throw statusError(503, "two-factor authentication is unavailable");
      }
      if (!pending.expiresAt || Date.now() > pending.expiresAt) {
        await destroySession(req);
        throw statusError(401, "two-factor verification expired — sign in again");
      }
      if ((pending.attempts || 0) >= MAX_2FA_ATTEMPTS) {
        await destroySession(req);
        throw statusError(429, "too many incorrect codes — sign in again");
      }

      const user = await userModel.findById(pending.userId);
      if (!user || user.role !== "super_admin") {
        await destroySession(req);
        throw statusError(401, "sign in first");
      }
      if (user.status !== "active") {
        await destroySession(req);
        throw statusError(403, "account is not active");
      }

      // Never let a stale enrollment challenge replace an app that was paired
      // in another tab/session after this login started.
      if (pending.mode === "enroll" && user.twoFactor?.enabled === true) {
        pending.mode = "challenge";
        if (typeof req.session.save === "function") await req.session.save();
        throw statusError(
          409,
          "two-factor authentication is already enabled — enter a code from your app"
        );
      }

      try {
        if (pending.mode === "enroll") {
          await twoFactorService.completeEnrollment(pending.userId, code);
        } else {
          await twoFactorService.verifyLogin(pending.userId, code);
        }
      } catch (err) {
        if (err && err.status === 422) {
          pending.attempts = (pending.attempts || 0) + 1;
          if (pending.attempts >= MAX_2FA_ATTEMPTS) {
            await destroySession(req);
            throw statusError(429, "too many incorrect codes — sign in again");
          }
          if (typeof req.session.save === "function") await req.session.save();
          const left = MAX_2FA_ATTEMPTS - pending.attempts;
          throw statusError(
            422,
            `invalid authenticator code — ${left} ${left === 1 ? "attempt" : "attempts"} left`
          );
        }
        throw err;
      }

      const provider = pending.provider || "password";
      return await completeLogin(req, user, `${provider}+totp`);
    },

    /** Pending-enrollment only: return the QR/manual key for the app. */
    async setupPendingEnrollment(req) {
      const pending = req.session && req.session[TWO_FACTOR_KEY];
      if (!pending || !pending.userId) {
        throw statusError(401, "sign in first");
      }
      if (pending.mode !== "enroll") {
        throw statusError(409, "an authenticator is already paired — enter its 6-digit code");
      }
      if (!pending.expiresAt || Date.now() > pending.expiresAt) {
        await destroySession(req);
        throw statusError(401, "two-factor verification expired — sign in again");
      }
      if (!twoFactorService) {
        throw statusError(503, "two-factor authentication is unavailable");
      }

      const user = await userModel.findById(pending.userId);
      if (!user || user.role !== "super_admin") {
        await destroySession(req);
        throw statusError(401, "sign in first");
      }
      if (user.twoFactor?.enabled === true) {
        // Another tab finished enrollment: require the existing app's code.
        pending.mode = "challenge";
        if (typeof req.session.save === "function") await req.session.save();
        throw statusError(409, "two-factor authentication is already enabled — enter a code from your app");
      }
      return await twoFactorService.beginEnrollment(pending.userId);
    },

    /** Abandon a pending 2FA login and drop the pre-auth session. */
    async cancelTwoFactor(req) {
      await destroySession(req);
      return { ok: true };
    },

    async logout(req) {
      // Capture before destroy: the session store is gone afterwards.
      const user = req.session && req.session.user;
      if (req.session.destroy) {
        await new Promise((resolve, reject) => {
          req.session.destroy((err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      }
      await logAuth("logout", user);
      return { ok: true };
    },

    /** GET /api/me — re-read Atlas, status re-check (divergence #3). */
    async me(userId, req) {
      const user = await userModel.findById(userId);
      if (!user) {
        const err = new Error("not logged in");
        err.status = 401;
        throw err;
      }
      if (user.status !== "active") {
        if (req.session.destroy) {
          await new Promise((resolve, reject) => {
            req.session.destroy((err) => {
              if (err) return reject(err);
              resolve();
            });
          });
        }
        const err = new Error("not logged in");
        err.status = 401;
        throw err;
      }

      // A super-admin session is only valid with an authenticator paired.
      // This also invalidates sessions that pre-date the 2FA rollout and
      // forces re-enrollment after the app is turned off.
      if (user.role === "super_admin" && user.twoFactor?.enabled !== true) {
        await destroySession(req);
        throw statusError(401, "two-factor enrollment required — sign in again");
      }

      const googleSub = String(user.googleSub || "");
      const createdAt = user.createdAt;
      const createdAtIso = createdAt instanceof Date ? createdAt.toISOString() : null;
      const provider = user.authProvider || (googleSub !== "" ? "google" : "local");

      return {
        username: user.username ?? null,
        email: user.email ?? null,
        role: user.role,
        status: user.status,
        displayName: user.displayName ?? "",
        authProvider: provider,
        createdAt: createdAtIso,
        googleLinked: googleSub !== "",
        twoFactorEnabled:
          user.role === "super_admin" && user.twoFactor?.enabled === true,
      };
    },

    /** Invitation-only registration. Role forced to cashier, status active. */
    async register({
      token,
      firstName,
      lastName,
      email,
      password,
      username,
      recaptchaToken,
      remoteIp,
    }) {
      // Bot protection (no-op unless the admin enabled reCAPTCHA).
      if (recaptchaService && typeof recaptchaService.verify === "function") {
        await recaptchaService.verify(recaptchaToken, remoteIp);
      }

      if (firstName.length < 2 || lastName.length < 2) {
        const err = new Error("first name and last name are required");
        err.status = 422;
        throw err;
      }
      if (password.length < 8) {
        const err = new Error("password must be at least 8 characters");
        err.status = 422;
        throw err;
      }
      const lowerEmail = String(email).toLowerCase().trim();

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const invitation = await invitationModel.findByTokenHashAny(tokenHash);
      if (!invitation) {
        const err = new Error("invitation invalid — ask your administrator for a new link");
        err.status = 404;
        throw err;
      }
      const expired = invitation.expiresAt && Date.now() > invitation.expiresAt.getTime();
      if (invitation.used) {
        const err = new Error("invitation used — ask your administrator for a new link");
        err.status = 410;
        throw err;
      }
      if (expired) {
        const err = new Error("invitation expired — ask your administrator for a new link");
        err.status = 410;
        throw err;
      }
      if (lowerEmail !== String(invitation.email || "").toLowerCase()) {
        const err = new Error("registering email must match the invited email");
        err.status = 422;
        throw err;
      }

      const usernameLower = String(username).toLowerCase().trim();
      if (!/^[a-z0-9._-]{3,30}$/.test(usernameLower)) {
        const err = new Error("username must be 3-30 chars: letters, numbers, . _ -");
        err.status = 422;
        throw err;
      }

      if (await userModel.findByUsername(usernameLower)) {
        const err = new Error("username already used");
        err.status = 409;
        throw err;
      }
      if (await userModel.findByEmail(lowerEmail)) {
        const err = new Error("email already used");
        err.status = 409;
        throw err;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const displayName = `${firstName} ${lastName}`;
      const now = new Date();

      const res = await usersColl.insertOne({
        username: usernameLower,
        email: lowerEmail,
        passwordHash,
        authProvider: "password",
        firstName,
        lastName,
        displayName,
        role: "cashier",
        status: "active",
        emailVerified: true,
        createdAt: now,
      });

      // Mark invite used atomically (single-use).
      await invitationModel.markUsed(String(invitation._id), now);

      // Invite IS the approval: log with inviter as actor.
      await activityLogsColl.insertOne({
        actorId: String(invitation.createdBy || "invite"),
        action: "approve_cashier",
        target: String(res.insertedId),
        at: now,
      });

      return {
        username: usernameLower,
        email: lowerEmail,
        role: "cashier",
      };
    },

    /** Google admin-only login. */
    async google({ idToken, email }, req) {
      // Resolve the same effective client ID GET /api/config publishes:
      // Settings > API override (.env) -> settings document -> env default.
      // A read failure must fail closed.
      let clientId = "";
      try {
        if (typeof googleAuthConfigProvider === "function") {
          const cfg = await googleAuthConfigProvider();
          if (cfg && cfg.enabled) {
            clientId = String(cfg.clientId || "").trim();
          }
        } else {
          // Fallback for callers that only provide the settings model.
          const authDoc = await settingsModel.findOne("googleAuth");
          if (authDoc) {
            if (authDoc.enabled) {
              clientId = String(authDoc.credentials?.clientId?.value || "").trim();
            }
          } else {
            clientId = String(googleClientIdFromEnv || "").trim();
          }
        }
      } catch {
        const err = new Error("Google sign-in is temporarily unavailable");
        err.status = 503;
        throw err;
      }
      if (!isValidGoogleClientId(clientId)) clientId = "";
      if (!clientId) {
        const err = new Error("Google sign-in is not configured");
        err.status = 503;
        throw err;
      }

      // Verify the ID token with Google tokeninfo, 10s timeout.
      let tokeninfo;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
          { signal: controller.signal }
        );
        clearTimeout(timeout);
        if (!response.ok) {
          const err = new Error("invalid Google sign-in");
          err.status = 401;
          throw err;
        }
        tokeninfo = await response.json();
      } catch (err) {
        if (err.status === 401) throw err;
        const err2 = new Error("Google sign-in is temporarily unavailable");
        err2.status = 503;
        throw err2;
      }

      // Check the audience: a token minted for some other Google app is never
      // accepted (migration.md §13.1: bad `aud` → 401). The button is rendered
      // with the same client ID GET /api/config publishes, so a legitimate
      // sign-in always matches.
      if (tokeninfo.aud !== clientId) {
        const err = new Error("invalid Google sign-in");
        err.status = 401;
        throw err;
      }

      // Check email_verified is the string "true".
      if (tokeninfo.email_verified !== "true") {
        const err = new Error("invalid Google sign-in");
        err.status = 401;
        throw err;
      }

      const tokenEmail = String(tokeninfo.email || "").toLowerCase();
      if (email && tokenEmail !== String(email).toLowerCase()) {
        const err = new Error("invalid Google sign-in");
        err.status = 401;
        throw err;
      }

      // Find user by email.
      const user = await userModel.findByEmail(tokenEmail);
      if (!user) {
        const err = new Error("invalid Google sign-in");
        err.status = 404;
        throw err;
      }

      // Only staff administrators (admin or super admin) can use Google login.
      if (user.role !== "admin" && user.role !== "super_admin") {
        const err = new Error("invalid Google sign-in");
        err.status = 403;
        throw err;
      }

      // Status gates (same as login).
      for (const [status, message] of STATUS_GATES) {
        if (user.status === status) {
          const err = new Error(message);
          err.status = 403;
          throw err;
        }
      }
      if (user.status !== "active") {
        const err = new Error("account is not active");
        err.status = 403;
        throw err;
      }

      // Link googleSub only when empty.
      const googleSub = String(tokeninfo.sub || "");
      if (googleSub && !user.googleSub) {
        await usersColl.updateOne(
          { _id: user._id },
          { $set: { googleSub, authProvider: "google" } }
        );
      }

      // Super admins always go through the authenticator app, including
      // Google sign-in. No 2FA enrolled means pending enrollment.
      if (twoFactorService) {
        const challenge = await twoFactorService.challengeState(user);
        if (challenge.required) {
          await startTwoFactor(req, user, challenge.mode, "google");
          return {
            twoFactorRequired: true,
            enrollmentRequired: challenge.mode === "enroll",
          };
        }
      }

      return completeLogin(req, user, "google");
    },
  };
}
