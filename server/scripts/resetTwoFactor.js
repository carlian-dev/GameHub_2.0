// Operator recovery for a lost super-admin authenticator device.
//
// There is deliberately no in-app bypass: adding an authenticator requires a
// code from a device that is already paired, otherwise a stolen password could
// enroll the attacker's phone. When every device is lost, an operator with
// server/.env access clears the account's 2FA fields and pairs a new app.
//
// Run from server/:
//   npm run reset:2fa -- --email superadmin@example.com          (dry run)
//   npm run reset:2fa -- --email superadmin@example.com --yes    (apply)
//
// Afterwards reload Settings > API > Security and pair a new device. Existing
// API credentials are untouched; they simply need the new device's code for the
// next change.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(serverRoot, ".env") });

import { validateEnv, env } from "../src/config/env.js";

validateEnv();

function argValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? String(process.argv[index + 1] || "") : "";
}

function usage() {
  console.error(
    "[reset2fa] usage: npm run reset:2fa -- --email <super-admin email> [--yes]"
  );
  console.error("[reset2fa] without --yes it only prints what would be cleared.");
}

async function main() {
  const email = argValue("email").trim().toLowerCase();
  if (!email) {
    usage();
    process.exitCode = 1;
    return;
  }
  const apply = process.argv.includes("--yes");

  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(env.MONGODB_DB);
    const users = db.collection("users");
    const user = await users.findOne({ email, role: "super_admin" });
    if (!user) {
      throw new Error(`no super-admin account found with email ${email}`);
    }

    const deviceCount = Array.isArray(user.twoFactor?.devices)
      ? user.twoFactor.devices.length
      : user.twoFactor?.secretEnc
        ? 1
        : 0;
    const hasPending = Boolean(user.twoFactorPending?.id);

    console.log(`[reset2fa] database: ${env.MONGODB_DB}`);
    console.log(`[reset2fa] account: ${email} (${String(user._id)})`);
    console.log(
      `[reset2fa] paired devices: ${deviceCount}; pending setup: ${hasPending ? "yes" : "no"}`
    );

    if (deviceCount === 0 && !hasPending) {
      console.log(
        "[reset2fa] nothing to clear — pair a device in Settings > API > Security."
      );
      return;
    }
    if (!apply) {
      console.log(
        "[reset2fa] dry run — re-run with --yes to clear twoFactor and twoFactorPending."
      );
      return;
    }

    const res = await users.updateOne(
      { _id: user._id },
      { $unset: { twoFactor: "", twoFactorPending: "" } }
    );
    try {
      await db.collection("activityLogs").insertOne({
        actorId: "system",
        action: "two_factor_reset",
        target: String(user._id),
        meta: {
          method: "operator-script",
          devicesRemoved: deviceCount,
          pendingRemoved: hasPending,
        },
        at: new Date(),
      });
    } catch {
      // The recovery itself already succeeded; a failed audit write is not fatal.
    }

    console.log(
      `[reset2fa] cleared 2FA (${res.modifiedCount ? "updated" : "no change"}).`
    );
    console.log(
      "[reset2fa] reload Settings > API > Security, then pair the new device. No old code is required."
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    "[reset2fa] failed:",
    err && err.message ? err.message : err
  );
  process.exitCode = 1;
});
