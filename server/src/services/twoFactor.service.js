// Super-admin two-factor authentication (TOTP / authenticator app).
//
// Scope: ONLY `super_admin` accounts. Sign-in does not ask for a code; the
// authenticator is step-up verification for adding, replacing or clearing an
// integration credential in Settings > API (enforced in settings.service.js).
//
// Multiple devices: every paired device keeps its own secret, so the original
// phone and a backup tablet can both approve a credential change. Adding a
// device never invalidates the existing ones, and removing one leaves the rest
// working. Older documents that still hold a single top-level `secretEnc` are
// read as one device and converted the next time a device is added.
//
// Secrets are encrypted at rest with AES-256-GCM (utils/secretBox). A plaintext
// secret leaves the server exactly once, inside the setup response, so the
// frontend can render the QR code. It is never returned by status/list
// endpoints and never written to activity logs.
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
const MAX_DEVICES = 5;
const LEGACY_DEVICE_ID = "legacy-primary";
const MISCONFIGURED_MESSAGE =
  "two-factor authentication is misconfigured; an operator must reset the authenticator for this account";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : null;
}

function cleanLabel(value, fallback) {
  const label = String(value || "").replace(/\s+/g, " ").trim().slice(0, 40);
  return label || fallback;
}

function defaultLabel(deviceCount) {
  return deviceCount === 0 ? "Primary device" : `Backup device ${deviceCount}`;
}

/**
 * Normalise the stored document to a device list. The pre-multi-device shape
 * (`twoFactor.secretEnc` + top-level counters) becomes one synthetic device.
 */
function storedDevices(twoFactor) {
  if (!twoFactor) return [];
  if (Array.isArray(twoFactor.devices) && twoFactor.devices.length > 0) {
    return twoFactor.devices
      .filter((device) => device && device.id && device.secretEnc)
      .map((device) => ({
        id: String(device.id),
        label: cleanLabel(device.label, "Authenticator device"),
        secretEnc: device.secretEnc,
        createdAt: device.createdAt || null,
        lastUsedCounter: Number.isFinite(device.lastUsedCounter)
          ? device.lastUsedCounter
          : -1,
        lastUsedAt: device.lastUsedAt || null,
      }));
  }
  if (twoFactor.secretEnc) {
    return [
      {
        id: LEGACY_DEVICE_ID,
        label: "Original device",
        secretEnc: twoFactor.secretEnc,
        createdAt: twoFactor.enabledAt || null,
        lastUsedCounter: Number.isFinite(twoFactor.lastUsedCounter)
          ? twoFactor.lastUsedCounter
          : -1,
        lastUsedAt: twoFactor.lastUsedAt || null,
        legacy: true,
      },
    ];
  }
  return [];
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

  /** Decrypt the devices that can actually be read; corrupt entries are skipped. */
  function readableDevices(devices) {
    const readable = [];
    for (const device of devices) {
      const secret = secretBox.decrypt(device.secretEnc);
      if (!secret) continue;
      try {
        base32Decode(secret);
      } catch {
        continue;
      }
      readable.push({ ...device, secret });
    }
    return readable;
  }

  /** Match a submitted code against any readable device. */
  function matchingDevice(devices, code) {
    for (const device of devices) {
      const result = verifyTotp(device.secret, code);
      if (result.valid) return { device, counter: result.counter };
    }
    return null;
  }

  function statusPayload(user) {
    const twoFactor = (user && user.twoFactor) || {};
    const devices = storedDevices(twoFactor);
    return {
      enabled: twoFactor.enabled === true && devices.length > 0,
      method: "totp",
      devices: devices.map((device) => ({
        id: device.id,
        label: device.label,
        createdAt: iso(device.createdAt),
        lastUsedAt: iso(device.lastUsedAt),
      })),
      deviceLimit: MAX_DEVICES,
      enrolledAt: iso(twoFactor.enabledAt) || iso(devices[0] && devices[0].createdAt),
      lastUsedAt: iso(twoFactor.lastUsedAt),
      pending: Boolean(user && user.twoFactorPending && user.twoFactorPending.id),
    };
  }

  /**
   * Step-up check for a sensitive in-session action (credential changes).
   * A code from any paired device is accepted. It also accepts a code already
   * used for an earlier step-up in the same 30-second window, but rejects one
   * older than that device's last used counter so a captured code cannot be
   * replayed.
   */
  async function verifyStepUp(userId, code) {
    const user = await findSuperAdmin(userId);
    if (user.status !== "active") throw httpError(403, "account is not active");
    const devices = storedDevices(user.twoFactor);
    if (user.twoFactor?.enabled !== true || devices.length === 0) {
      throw httpError(
        409,
        "two-factor authentication is not enabled — pair an authenticator app before changing credentials"
      );
    }
    const readable = readableDevices(devices);
    if (readable.length === 0) throw httpError(503, MISCONFIGURED_MESSAGE);
    const match = matchingDevice(readable, code);
    if (!match) throw httpError(422, "invalid authenticator code");

    const now = new Date();
    let res;
    if (match.device.legacy) {
      // Pre-multi-device document: keep the original counter field until the
      // next enrollment converts it into a `devices` entry.
      res = await usersColl.updateOne(
        {
          _id: user._id,
          $or: [
            { "twoFactor.lastUsedCounter": { $exists: false } },
            { "twoFactor.lastUsedCounter": { $lte: match.counter } },
          ],
        },
        {
          $set: {
            "twoFactor.lastUsedCounter": match.counter,
            "twoFactor.lastUsedAt": now,
          },
        }
      );
    } else {
      res = await usersColl.updateOne(
        {
          _id: user._id,
          "twoFactor.devices": {
            $elemMatch: {
              id: match.device.id,
              lastUsedCounter: { $lte: match.counter },
            },
          },
        },
        {
          $set: {
            "twoFactor.devices.$.lastUsedCounter": match.counter,
            "twoFactor.devices.$.lastUsedAt": now,
            "twoFactor.lastUsedAt": now,
          },
        }
      );
    }
    if (res.modifiedCount === 0) {
      throw httpError(409, "this code is too old — wait for the next code and try again");
    }
    return true;
  }

  return {
    /**
     * Generate a new secret for another device and keep it pending until the
     * user proves the app works. Once any device is paired, a current code
     * from one of the existing devices is required — a stolen password must not
     * be able to add the attacker's device. Existing devices stay active.
     */
    async beginEnrollment(userId, code = "", label = "") {
      if (!secretBox.configured) {
        throw httpError(
          503,
          "two-factor setup is unavailable: set SETTINGS_ENCRYPTION_KEY (or SESSION_SECRET) in server/.env"
        );
      }
      const user = await findSuperAdmin(userId);
      const devices = storedDevices(user.twoFactor);
      const enabled = user.twoFactor?.enabled === true;
      if (enabled || devices.length > 0) {
        const readable = readableDevices(devices);
        if (readable.length === 0) throw httpError(503, MISCONFIGURED_MESSAGE);
        if (!/^\d{6}$/.test(String(code || "").trim())) {
          throw httpError(
            422,
            "enter the current 6-digit code from an already-paired device to add another device"
          );
        }
        if (!matchingDevice(readable, String(code).trim())) {
          throw httpError(422, "invalid authenticator code");
        }
      }
      if (devices.length >= MAX_DEVICES) {
        throw httpError(
          409,
          `you can pair up to ${MAX_DEVICES} authenticator devices; remove one before adding another`
        );
      }

      const secret = generateTotpSecret();
      const account = user.email || user.username || String(user._id);
      const deviceLabel = cleanLabel(label, defaultLabel(devices.length));
      const setupId = crypto.randomUUID();
      const now = new Date();

      await usersColl.updateOne(
        { _id: user._id },
        {
          $set: {
            twoFactorPending: {
              id: setupId,
              secretEnc: secretBox.encrypt(secret),
              label: deviceLabel,
              createdAt: now,
            },
          },
        }
      );

      const otpAccount = `${account} (${deviceLabel})`;
      const otpauthUrl = buildOtpAuthUrl({
        secret,
        account: otpAccount,
        issuer: ISSUER,
      });
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
        account: otpAccount,
        label: deviceLabel,
        deviceCount: devices.length + 1,
        deviceLimit: MAX_DEVICES,
        digits: TOTP_DIGITS,
        period: TOTP_STEP_SECONDS,
      };
    },

    /**
     * Verify the pending secret and append it as a new device. The previous
     * devices are left untouched, so a backup phone never locks out the first.
     */
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

      const secret = secretBox.decrypt(pending.secretEnc);
      if (!secret) {
        throw httpError(
          503,
          "two-factor setup cannot be completed; the pending secret cannot be read"
        );
      }
      try {
        base32Decode(secret);
      } catch {
        throw httpError(
          503,
          "two-factor setup cannot be completed; the pending secret cannot be read"
        );
      }
      const result = verifyTotp(secret, code);
      if (!result.valid) throw httpError(422, "invalid authenticator code");

      // Drop the legacy synthetic marker, but keep every real device.
      const existing = storedDevices(user.twoFactor).map((device) => {
        const { legacy, ...rest } = device;
        return rest;
      });
      if (existing.length >= MAX_DEVICES) {
        await usersColl.updateOne({ _id: user._id }, { $unset: { twoFactorPending: "" } });
        throw httpError(
          409,
          `you can pair up to ${MAX_DEVICES} authenticator devices; remove one before adding another`
        );
      }

      const now = new Date();
      const device = {
        id: crypto.randomUUID(),
        label: cleanLabel(pending.label, defaultLabel(existing.length)),
        secretEnc: pending.secretEnc,
        createdAt: now,
        lastUsedCounter: result.counter,
        lastUsedAt: null,
      };
      const firstDevice = existing.length === 0;
      const twoFactor = {
        enabled: true,
        devices: [...existing, device],
        enabledAt:
          user.twoFactor?.enabledAt instanceof Date ? user.twoFactor.enabledAt : now,
        lastUsedAt:
          user.twoFactor?.lastUsedAt instanceof Date ? user.twoFactor.lastUsedAt : null,
      };

      const res = await usersColl.updateOne(
        { _id: user._id, "twoFactorPending.id": pending.id },
        { $set: { twoFactor }, $unset: { twoFactorPending: "" } }
      );
      if (res.modifiedCount === 0) {
        throw httpError(409, "two-factor setup changed — scan the latest QR code and try again");
      }

      await log(
        user._id,
        firstDevice ? "two_factor_enabled" : "two_factor_device_added",
        {
          deviceId: device.id,
          label: device.label,
          deviceCount: twoFactor.devices.length,
        }
      );
      return statusPayload({ ...user, twoFactor, twoFactorPending: null });
    },

    verifyStepUp,

    /** Remove one device. It needs a current code from any remaining device. */
    async removeDevice(userId, deviceId, code) {
      const user = await findSuperAdmin(userId);
      const devices = storedDevices(user.twoFactor);
      const device = devices.find((entry) => entry.id === String(deviceId || ""));
      if (!device) throw httpError(404, "authenticator device not found");
      if (devices.length <= 1) {
        throw httpError(
          409,
          "this is the only paired device — turn off two-factor authentication instead of removing it"
        );
      }

      await verifyStepUp(userId, code);

      const res = await usersColl.updateOne(
        {
          _id: user._id,
          "twoFactor.devices.id": device.id,
          // Require at least two devices at write time, so two concurrent
          // removals can never leave 2FA enabled with no device.
          "twoFactor.devices.1": { $exists: true },
        },
        { $pull: { "twoFactor.devices": { id: device.id } } }
      );
      if (res.modifiedCount === 0) {
        throw httpError(409, "authenticator devices changed — refresh and try again");
      }

      await log(user._id, "two_factor_device_removed", {
        deviceId: device.id,
        label: device.label,
        deviceCount: devices.length - 1,
      });
      const updated = await findSuperAdmin(userId);
      return statusPayload(updated);
    },

    /** Turn 2FA off for every device. Requires a valid current code. */
    async disable(userId, code) {
      const user = await findSuperAdmin(userId);
      const devices = storedDevices(user.twoFactor);
      if (user.twoFactor?.enabled !== true || devices.length === 0) {
        throw httpError(409, "two-factor authentication is not enabled");
      }
      const readable = readableDevices(devices);
      if (readable.length === 0) throw httpError(503, MISCONFIGURED_MESSAGE);
      if (!matchingDevice(readable, code)) {
        throw httpError(422, "invalid authenticator code");
      }
      await usersColl.updateOne(
        { _id: user._id },
        { $unset: { twoFactor: "", twoFactorPending: "" } }
      );
      await log(user._id, "two_factor_disabled", { deviceCount: devices.length });
      return statusPayload({ twoFactor: undefined, twoFactorPending: undefined });
    },

    /** Safe status for the super-admin security panel (no secret material). */
    async status(userId) {
      return statusPayload(await findSuperAdmin(userId));
    },
  };
}
