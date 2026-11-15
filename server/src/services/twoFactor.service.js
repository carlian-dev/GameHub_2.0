// Super-admin two-factor authentication (TOTP / authenticator app).
//
// Scope: ONLY `super_admin` accounts. Login is challenged after the password
// (or Google) check passes; a super admin with no authenticator enrolled must
// enroll before the session is created (enforced in auth.service.js).
//
// The shared secret is encrypted at rest with AES-256-GCM (utils/secretBox).
// The plaintext secret leaves the server exactly once, inside the setup
// response, so the frontend can render the QR code. It is never returned by
// status/list endpoints and never written to activity logs.
import crypto from "node:crypto";
import QRCode from "qrcode";
import { createSecretBox } from "../utils/secretBox.js";
import {
  TOTP_DIGITS,
  TOTP_STEP_SECONDS,
  base32Decode,
  buildOtpAuthUrl,
  generateTotpSecret,
  verifyTotp,
} from "../utils/totp.js";

const ISSUER = "GameHub";
const ENROLLMENT_TTL_MS = 10 * 60 * 1000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : null;
}

export function twoFactorService({ userModel, db, encryptionKey }) {
  const secretBox = createSecretBox(encryptionKey);
  const usersColl = db.collection("users");
  const activityLogsColl = db.collection("activityLogs");

  async function findSuperAdmin(userId) {
    const user = await userModel.findById(userId);
    if (!user || user.role !== "super_admin") {
      throw httpError(404, "super admin account not found");
    }
    return user;
  }

  function decryptSecret(payload, missingMessage) {
    const secret = secretBox.decrypt(payload);
    if (!secret) throw httpError(503, missingMessage);
    try {
      base32Decode(secret);
    } catch {
      throw httpError(503, missingMessage);
    }
    return secret;
  }

  /** Best-effort audit entry: never block a security action on a log write. */
  async function log(userId, action, meta = {}) {
    try {
      await activityLogsColl.insertOne({
        actorId: String(userId),
        action,
        target: String(userId),
        meta: { method: "totp", ...meta },
        at: new Date(),
      });
    } catch {
      // Audit failures are non-fatal.
    }
  }

  return {
    /**
     * What the login flow must do next for this account:
     *   { required: false }                     — not a super admin
     *   { required: true, mode: "enroll" }      — no authenticator yet
     *   { required: true, mode: "challenge" }   — verify a 6-digit code
     * Fails closed when an enrolled secret cannot be decrypted.
     */
    async challengeState(user) {
      if (!user || user.role !== "super_admin") return { required: false };
      const twoFactor = user.twoFactor || {};
      if (twoFactor.enabled === true) {
        decryptSecret(
          twoFactor.secretEnc,
          "two-factor authentication is misconfigured; an operator must reset the authenticator for this account"
        );
        return { required: true, mode: "challenge" };
      }
      return { required: true, mode: "enroll" };
    },

    /**
     * Generate a new secret and keep it pending until the user proves their
     * app works. Re-enrollment is allowed while 2FA is already enabled: the
     * old secret stays active until the new one is confirmed.
     */
    async beginEnrollment(userId) {
      if (!secretBox.configured) {
        throw httpError(
          503,
          "two-factor setup is unavailable: set SETTINGS_ENCRYPTION_KEY (or SESSION_SECRET) in server/.env"
        );
      }
      const user = await findSuperAdmin(userId);
      const secret = generateTotpSecret();
      const account = user.email || user.username || String(user._id);
      const setupId = crypto.randomUUID();
      const now = new Date();

      await usersColl.updateOne(
        { _id: user._id },
        {
          $set: {
            twoFactorPending: {
              id: setupId,
              secretEnc: secretBox.encrypt(secret),
              createdAt: now,
            },
          },
        }
      );

      const otpauthUrl = buildOtpAuthUrl({ secret, account, issuer: ISSUER });
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 240,
        color: { dark: "#08111F", light: "#FFFFFF" },
      });

      return {
        secret,
        otpauthUrl,
        qrDataUrl,
        issuer: ISSUER,
        account,
        digits: TOTP_DIGITS,
        period: TOTP_STEP_SECONDS,
      };
    },

    /** Verify the pending secret and activate it. */
    async completeEnrollment(userId, code) {
      const user = await findSuperAdmin(userId);
      const pending = user.twoFactorPending;
      if (!pending || !pending.secretEnc || !pending.id) {
        throw httpError(422, "two-factor setup was not started — request a new QR code");
      }
      const createdAt = pending.createdAt instanceof Date ? pending.createdAt.getTime() : 0;
      if (!createdAt || Date.now() - createdAt > ENROLLMENT_TTL_MS) {
        await usersColl.updateOne({ _id: user._id }, { $unset: { twoFactorPending: "" } });
        throw httpError(410, "two-factor setup expired — request a new QR code");
      }

      const secret = decryptSecret(
        pending.secretEnc,
        "two-factor setup cannot be completed; the pending secret cannot be read"
      );
      const result = verifyTotp(secret, code);
      if (!result.valid) throw httpError(422, "invalid authenticator code");

      const now = new Date();
      const reenrolled = user.twoFactor?.enabled === true;
      const res = await usersColl.updateOne(
        { _id: user._id, "twoFactorPending.id": pending.id },
        {
          $set: {
            twoFactor: {
              enabled: true,
              secretEnc: pending.secretEnc,
              enabledAt: now,
              lastUsedCounter: result.counter,
              lastUsedAt: now,
            },
          },
          $unset: { twoFactorPending: "" },
        }
      );
      if (res.modifiedCount === 0) {
        throw httpError(409, "two-factor setup changed — scan the latest QR code and try again");
      }

      await log(user._id, "two_factor_enabled", { reenrolled });
      return {
        enabled: true,
        method: "totp",
        enrolledAt: iso(now),
        lastUsedAt: iso(now),
      };
    },

    /**
     * Check a login challenge code. The replay guard is atomic: a code can
     * complete only one sign-in (within the 30-second step and its ±1 drift).
     */
    async verifyLogin(userId, code) {
      const user = await findSuperAdmin(userId);
      if (user.status !== "active") throw httpError(403, "account is not active");
      const twoFactor = user.twoFactor || {};
      if (twoFactor.enabled !== true) {
        throw httpError(409, "two-factor authentication is not enabled");
      }
      const secret = decryptSecret(
        twoFactor.secretEnc,
        "two-factor authentication is misconfigured; an operator must reset the authenticator for this account"
      );
      const result = verifyTotp(secret, code);
      if (!result.valid) throw httpError(422, "invalid authenticator code");

      const now = new Date();
      const res = await usersColl.updateOne(
        {
          _id: user._id,
          $or: [
            { "twoFactor.lastUsedCounter": { $exists: false } },
            { "twoFactor.lastUsedCounter": { $lt: result.counter } },
          ],
        },
        {
          $set: {
            "twoFactor.lastUsedCounter": result.counter,
            "twoFactor.lastUsedAt": now,
          },
        }
      );
      if (res.modifiedCount === 0) {
        throw httpError(409, "this code was already used — wait for the next code");
      }
      return true;
    },

    /**
     * Step-up check for a sensitive in-session action (credential changes).
     * Accepts any still-valid code — including the one used to sign in during
     * the same 30-second window — but rejects a code older than the last one
     * used, so a code captured from an earlier sign-in cannot be replayed.
     */
    async verifyStepUp(userId, code) {
      const user = await findSuperAdmin(userId);
      if (user.status !== "active") throw httpError(403, "account is not active");
      const twoFactor = user.twoFactor || {};
      if (twoFactor.enabled !== true) {
        throw httpError(
          409,
          "two-factor authentication is not enabled — pair an authenticator app before changing credentials"
        );
      }
      const secret = decryptSecret(
        twoFactor.secretEnc,
        "two-factor authentication is misconfigured; an operator must reset the authenticator for this account"
      );
      const result = verifyTotp(secret, code);
      if (!result.valid) throw httpError(422, "invalid authenticator code");

      const now = new Date();
      const res = await usersColl.updateOne(
        {
          _id: user._id,
          $or: [
            { "twoFactor.lastUsedCounter": { $exists: false } },
            { "twoFactor.lastUsedCounter": { $lte: result.counter } },
          ],
        },
        {
          $set: {
            "twoFactor.lastUsedCounter": result.counter,
            "twoFactor.lastUsedAt": now,
          },
        }
      );
      if (res.modifiedCount === 0) {
        throw httpError(409, "this code is too old — wait for the next code and try again");
      }
      return true;
    },

    /** Turn 2FA off. Requires a valid current code; the next login re-enrolls. */
    async disable(userId, code) {
      const user = await findSuperAdmin(userId);
      const twoFactor = user.twoFactor || {};
      if (twoFactor.enabled !== true) {
        throw httpError(409, "two-factor authentication is not enabled");
      }
      const secret = decryptSecret(
        twoFactor.secretEnc,
        "two-factor authentication is misconfigured; an operator must reset the authenticator for this account"
      );
      if (!verifyTotp(secret, code).valid) {
        throw httpError(422, "invalid authenticator code");
      }
      await usersColl.updateOne(
        { _id: user._id },
        { $unset: { twoFactor: "", twoFactorPending: "" } }
      );
      await log(user._id, "two_factor_disabled");
      return { enabled: false, method: "totp", enrolledAt: null, lastUsedAt: null };
    },

    /** Safe status for the super-admin security panel (no secret material). */
    async status(userId) {
      const user = await findSuperAdmin(userId);
      const twoFactor = user.twoFactor || {};
      return {
        enabled: twoFactor.enabled === true,
        method: "totp",
        enrolledAt: iso(twoFactor.enabledAt),
        lastUsedAt: iso(twoFactor.lastUsedAt),
        pending: Boolean(user.twoFactorPending && user.twoFactorPending.id),
      };
    },
  };
}
