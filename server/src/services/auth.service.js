// Auth service — business rules for login/logout/me/register/google.
// migration.md §13.1 (auth & sessions), §13.2 (invitations).
// Role comes from the session only — never from request data.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { invitationModel } from "../models/invitation.model.js";

export function authService({ userModel, db }) {
  const usersColl = db.collection("users");
  const activityLogsColl = db.collection("activityLogs");

  // Status gates in order (migration.md §13.1).
  const STATUS_GATES = [
    ["pending", "awaiting admin approval"],
    ["archived", "account archived"],
    ["declined", "application was declined"],
  ];

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

  return {
    /** Dual identifier login: email if contains @, else username (cashier only). */
    async login({ identifier, password }, req) {
      if (!identifier || !password) {
        const err = new Error("login and password are required");
        err.status = 422;
        throw err;
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

      // Session payload exactly (migration.md §13.1).
      const payload = {
        id: String(user._id),
        username: user.username ?? null,
        email: user.email ?? null,
        role: user.role,
      };

      // Regenerate + save to prevent session fixation (divergence #1).
      if (req.session.regenerate) {
        await new Promise((resolve, reject) => {
          req.session.regenerate((err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      }
      req.session.user = payload;
      await req.session.save();

      return { username: user.username ?? null, email: user.email ?? null, role: user.role };
    },

    async logout(req) {
      if (req.session.destroy) {
        await new Promise((resolve, reject) => {
          req.session.destroy((err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      }
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
      };
    },

    /** Invitation-only registration. Role forced to cashier, status active. */
    async register({ token, firstName, lastName, email, password, username }) {
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
      // Read googleAuth settings; DB authoritative; read failure → 503.
      let authDoc;
      try {
        authDoc = await settingsModel.findOne("googleAuth");
      } catch {
        const err = new Error("Google sign-in is temporarily unavailable");
        err.status = 503;
        throw err;
      }
      if (!authDoc || !authDoc.enabled) {
        const err = new Error("Google sign-in is not configured");
        err.status = 503;
        throw err;
      }
      const clientId = authDoc.credentials?.clientId?.value || "";
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

      // Check email_verified is the string "true".
      if (tokeninfo.email_verified !== "true") {
        const err = new Error("invalid Google sign-in");
        err.status = 401;
        throw err;
      }

      const tokenEmail = String(tokeninfo.email || "").toLowerCase();
      if (tokenEmail !== email.toLowerCase()) {
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

      // Only admin can use Google login.
      if (user.role !== "admin") {
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

      // Session payload exactly (migration.md §13.1).
      const payload = {
        id: String(user._id),
        username: user.username ?? null,
        email: user.email ?? null,
        role: user.role,
      };

      // Regenerate + save to prevent session fixation (divergence #1).
      if (req.session.regenerate) {
        await new Promise((resolve, reject) => {
          req.session.regenerate((err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      }
      req.session.user = payload;
      await req.session.save();

      return { username: user.username ?? null, email: user.email ?? null, role: user.role };
    },
  };
}
