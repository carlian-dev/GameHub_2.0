// Auth service — business rules for login/logout/me/register/google.
// migration.md §13.1 (auth & sessions), §13.2 (invitations).
// Authentication is stateless: a successful login returns a signed JWT whose
// claims are backed by the live user document on every request. Role comes
// from that document — never from request data.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { toObjectId } from "../models/bson.js";
import { isValidGoogleClientId } from "../utils/google.js";
import { signAuthToken } from "../utils/authToken.js";
import { evaluatePassword, validateUsername } from "../utils/passwordStrength.js";
import {
  parseUserVersion,
  userVersion,
  versionConflict,
} from "../utils/concurrency.js";

export function authService({
  userModel,
  settingsModel,
  invitationModel,
  db,
  googleClientIdFromEnv = "",
  googleAuthConfigProvider = null,
  recaptchaService = null,
  mailer = null,
  frontendUrl = "",
  mailerDryRun = false,
}) {
  const usersColl = db.collection("users");
  const activityLogsColl = db.collection("activityLogs");

  // Status gates in order (migration.md §13.1).
  const STATUS_GATES = [
    ["pending", "awaiting admin approval"],
    ["archived", "account archived"],
    ["declined", "application was declined"],
  ];

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

  /**
   * Issue the stateless credential after password/Google passes. The caller
   * puts `token` in the HttpOnly cookie; `user` is what the API returns.
   */
  async function completeLogin(user, provider) {
    const token = signAuthToken(user);
    await logAuth("login", user, provider);
    return {
      token,
      user: {
        username: user.username ?? null,
        email: user.email ?? null,
        role: user.role,
      },
    };
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
      return completeLogin(user, "password");
    },

    /**
     * Stateless logout. There is no server-side session to destroy, so the
     * caller's cookie is cleared and `tokenVersion` is bumped: every token
     * issued before this moment (this request's included) then fails the
     * version check in the auth middleware.
     */
    async logout(user) {
      const id = user && (user.id ?? user._id);
      if (!id) return { ok: true };
      await usersColl.updateOne(
        { _id: toObjectId(id) },
        { $inc: { tokenVersion: 1 } }
      );
      await logAuth("logout", user);
      return { ok: true };
    },

    /** GET /api/me — re-read Atlas, status re-check (divergence #3). */
    async me(userId) {
      const user = await userModel.findById(userId);
      if (!user) {
        throw statusError(401, "not logged in");
      }
      // A token stays valid until it expires, so every guarded read re-checks
      // the live status: an archived account is logged out immediately.
      if (user.status !== "active") {
        throw statusError(401, "not logged in");
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
        avatarUrl: user.avatarUrl ?? null,
        authProvider: provider,
        createdAt: createdAtIso,
        googleLinked: googleSub !== "",
        twoFactorEnabled:
          user.role === "super_admin" && user.twoFactor?.enabled === true,
        // Optimistic-concurrency revision for the profile edit form.
        version: userVersion(user),
      };
    },

    /**
     * PUT /api/me/profile — self-service display name and profile picture.
     * Allowed for all active roles (cashier, admin, super_admin).
     * Email, username, role and password are never accepted here.
     *
     * `version` is the revision the caller last read (`GET /api/me`). The write
     * succeeds only while the stored value still matches; otherwise it is a 409
     * so two tabs cannot silently overwrite each other.
     */
    async updateProfile(userId, { displayName, avatarUrl, version } = {}) {
      const user = await userModel.findById(userId);
      if (!user) {
        throw statusError(401, "not logged in");
      }
      if (user.status !== "active") {
        throw statusError(403, "account is not active");
      }

      if (displayName === undefined && avatarUrl === undefined) {
        throw statusError(422, "display name must be 2-60 characters");
      }

      const setFields = {};
      let nameChanged = false;
      let avatarChanged = false;

      const beforeName = String(user.displayName ?? "").trim();
      const beforeAvatar = user.avatarUrl ?? null;

      let finalName = user.displayName ?? "";
      let finalAvatar = user.avatarUrl ?? null;

      if (displayName !== undefined) {
        const name = typeof displayName === "string" ? displayName.trim() : "";
        if (name.length < 2 || name.length > 60) {
          throw statusError(422, "display name must be 2-60 characters");
        }
        finalName = name;
        if (name !== beforeName) {
          setFields.displayName = name;
          nameChanged = true;
        }
      }

      if (avatarUrl !== undefined) {
        let avatarVal = null;
        if (avatarUrl !== null && avatarUrl !== "") {
          if (typeof avatarUrl !== "string") {
            throw statusError(422, "invalid avatar image");
          }
          const trimmed = avatarUrl.trim();
          if (trimmed !== "") {
            if (trimmed.length > 2 * 1024 * 1024) {
              throw statusError(422, "avatar image is too large (max 2MB)");
            }
            if (
              !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(trimmed) &&
              !/^https?:\/\//i.test(trimmed)
            ) {
              throw statusError(422, "invalid image format");
            }
            avatarVal = trimmed;
          }
        }
        finalAvatar = avatarVal;
        if (avatarVal !== beforeAvatar) {
          setFields.avatarUrl = avatarVal;
          avatarChanged = true;
        }
      }

      if (!nameChanged && !avatarChanged) {
        // Nothing to write, so there is nothing to conflict over. Return the
        // current revision so the client can catch up.
        return {
          displayName: finalName,
          avatarUrl: finalAvatar,
          version: userVersion(user),
        };
      }

      // Validate the precondition only when an actual write is needed.
      const expectedVersion = parseUserVersion(version);
      const updateResult = await userModel.updateWithVersion(
        user._id,
        expectedVersion,
        setFields
      );
      if (!updateResult || updateResult.matchedCount === 0) {
        const fresh = await userModel.findById(user._id);
        if (!fresh) {
          throw statusError(401, "not logged in");
        }
        throw versionConflict(userVersion(fresh));
      }

      try {
        const meta = {};
        if (nameChanged && !avatarChanged) {
          meta.field = "displayName";
          meta.oldValue = beforeName || null;
          meta.newValue = finalName;
        } else if (avatarChanged && !nameChanged) {
          meta.field = "avatarUrl";
          meta.oldValue = beforeAvatar ? "configured" : null;
          meta.newValue = finalAvatar ? "configured" : null;
        } else {
          meta.field = "profile";
          meta.oldValue = beforeName || null;
          meta.newValue = finalName;
          meta.avatarChanged = true;
        }
        await activityLogsColl.insertOne({
          actorId: String(user._id),
          action: "profile_update",
          target: String(user._id),
          meta,
          at: new Date(),
        });
      } catch {
        // Audit is best-effort, like sign-in/sign-out logging.
      }

      return {
        displayName: finalName,
        avatarUrl: finalAvatar,
        version: expectedVersion + 1,
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

      const usernameLower = String(username).toLowerCase().trim();
      const usernameCheck = validateUsername(usernameLower);
      if (!usernameCheck.valid) {
        const err = new Error(usernameCheck.error);
        err.status = 422;
        throw err;
      }

      if (!password || password.length < 8) {
        const err = new Error("password must be at least 8 characters");
        err.status = 422;
        throw err;
      }
      const pwEval = evaluatePassword(password, {
        username: usernameLower,
        firstName,
        lastName,
      });
      if (pwEval.level === "weak") {
        const err = new Error(pwEval.message || "password is too weak — must be at least moderate with a mix of uppercase, lowercase, numbers, or symbols");
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
      const targetRole = invitation.role === "admin" ? "admin" : "cashier";

      const res = await usersColl.insertOne({
        version: 1,
        username: usernameLower,
        email: lowerEmail,
        passwordHash,
        authProvider: "password",
        firstName,
        lastName,
        displayName,
        role: targetRole,
        status: "active",
        emailVerified: true,
        createdAt: now,
      });

      // Mark invite used atomically (single-use).
      await invitationModel.markUsed(String(invitation._id), now);

      // Invite IS the approval: log with inviter as actor.
      await activityLogsColl.insertOne({
        actorId: String(invitation.createdBy || "invite"),
        action: targetRole === "admin" ? "approve_admin" : "approve_cashier",
        target: String(res.insertedId),
        at: now,
      });

      return {
        username: usernameLower,
        email: lowerEmail,
        role: targetRole,
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

      return completeLogin(user, "google");
    },

    /**
     * Request a password reset link.
     * Generates a single-use token with 1-hour TTL, saves SHA-256 hash to user,
     * and sends the reset link via mailer.
     * Returns a generic message to avoid leaking whether the email exists.
     */
    async forgotPassword({ email, recaptchaToken }, req) {
      const lowerEmail = String(email || "").toLowerCase().trim();
      if (!lowerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lowerEmail)) {
        const err = new Error("valid email is required");
        err.status = 422;
        throw err;
      }

      if (recaptchaService && typeof recaptchaService.verify === "function") {
        await recaptchaService.verify(recaptchaToken, req && req.ip);
      }

      const genericResponse = {
        ok: true,
        message: "If an account with that email exists, a password reset link has been sent.",
      };

      const user = await userModel.findByEmail(lowerEmail);
      if (!user || user.status !== "active") {
        return genericResponse;
      }

      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await usersColl.updateOne(
        { _id: user._id },
        {
          $set: {
            resetPassword: {
              tokenHash,
              expiresAt,
              requestedAt: new Date(),
            },
          },
        }
      );

      const base = String(frontendUrl || "").replace(/\/$/, "");
      const link = `${base}/src/function/auth/reset-password.html?token=${token}`;

      try {
        if (mailerDryRun) {
          // eslint-disable-next-line no-console
          console.log(`[forgot-password] DRY-RUN reset mail to ${lowerEmail}: ${link}`);
        } else if (mailer && typeof mailer.sendPasswordReset === "function") {
          await mailer.sendPasswordReset(lowerEmail, link);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[forgot-password] failed to send email to ${lowerEmail}:`, err);
        const error = new Error("failed to send password reset email. Please try again later.");
        error.status = 500;
        throw error;
      }

      try {
        await activityLogsColl.insertOne({
          actorId: String(user._id),
          action: "password_reset_request",
          target: String(user._id),
          meta: { email: lowerEmail, role: user.role },
          at: new Date(),
        });
      } catch {
        // Audit log is best-effort
      }

      return genericResponse;
    },

    /** Check whether a password reset token is valid and unexpired. */
    async verifyResetToken(token) {
      if (!token) {
        const err = new Error("reset token is required");
        err.status = 400;
        throw err;
      }
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const user = await userModel.findByResetTokenHash(tokenHash);
      if (!user || !user.resetPassword) {
        const err = new Error("invalid or expired password reset link");
        err.status = 404;
        throw err;
      }
      const now = new Date();
      if (user.resetPassword.expiresAt && now > user.resetPassword.expiresAt) {
        const err = new Error("password reset link has expired");
        err.status = 410;
        throw err;
      }
      if (user.status !== "active") {
        const err = new Error("account is not active");
        err.status = 403;
        throw err;
      }
      return { valid: true, email: user.email };
    },

    /**
     * Complete password reset with a valid token.
     * Sets new password, clears the reset token, bumps tokenVersion to revoke
     * all active sessions, and logs the event in activityLogs.
     */
    async resetPassword({ token, password, recaptchaToken }, req) {
      if (!token) {
        const err = new Error("reset token is required");
        err.status = 400;
        throw err;
      }
      if (!password || password.length < 8) {
        const err = new Error("password must be at least 8 characters");
        err.status = 422;
        throw err;
      }
      if (recaptchaService && typeof recaptchaService.verify === "function") {
        await recaptchaService.verify(recaptchaToken, req && req.ip);
      }

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const user = await userModel.findByResetTokenHash(tokenHash);
      if (!user || !user.resetPassword) {
        const err = new Error("invalid or expired password reset link");
        err.status = 404;
        throw err;
      }
      const now = new Date();
      if (user.resetPassword.expiresAt && now > user.resetPassword.expiresAt) {
        const err = new Error("password reset link has expired");
        err.status = 410;
        throw err;
      }
      if (user.status !== "active") {
        const err = new Error("account is not active");
        err.status = 403;
        throw err;
      }

      const pwEval = evaluatePassword(password, {
        username: user.username || "",
        firstName: user.firstName || "",
        lastName: user.lastName || "",
      });
      if (pwEval.level === "weak") {
        const err = new Error(pwEval.message || "password is too weak — must be at least moderate with a mix of uppercase, lowercase, numbers, or symbols");
        err.status = 422;
        throw err;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      await usersColl.updateOne(
        { _id: user._id },
        {
          $set: { passwordHash },
          $unset: { resetPassword: "" },
          $inc: { tokenVersion: 1 },
        }
      );

      try {
        await activityLogsColl.insertOne({
          actorId: String(user._id),
          action: "password_reset",
          target: String(user._id),
          meta: { email: user.email, role: user.role },
          at: new Date(),
        });
      } catch {
        // Audit log is best-effort
      }

      return {
        ok: true,
        message: "Password has been reset successfully. You can now log in.",
      };
    },
  };
}
