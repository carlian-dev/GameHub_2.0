// Reset + seed the migration test database (gamehub_2_0_migtest).
// One-time setup script. Guards against writing to gamehub_2_0.
// Never run against production. Credentials come from env; never printed.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(serverRoot, ".env") });

import { validateEnv, env, assertTestDb } from "../src/config/env.js";

validateEnv();
assertTestDb(env.MONGODB_DB);

// Test-only fixtures. Override via SEED_ADMIN_PASSWORD / SEED_CASHIER_PASSWORD.
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@gamehub.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "AdminPass123!";
const CASHIER_EMAIL = process.env.SEED_CASHIER_EMAIL || "cashier@gamehub.local";
const CASHIER_PASSWORD =
  process.env.SEED_CASHIER_PASSWORD || "CashierPass123!";
const CASHIER_USERNAME = process.env.SEED_CASHIER_USERNAME || "cashier1";

async function main() {
  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const db = client.db(env.MONGODB_DB);
  try {
    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const cashierHash = await bcrypt.hash(CASHIER_PASSWORD, 10);
    const now = new Date();

    // Clear seedable collections. Safe here because assertTestDb already refused gamehub_2_0.
    await Promise.all([
      db.collection("users").deleteMany({}),
      db.collection("tables").deleteMany({}),
      db.collection("rates").deleteMany({}),
      db.collection("settings").deleteMany({}),
      db.collection("invitations").deleteMany({}),
      db.collection("activityLogs").deleteMany({}),
      db.collection("sessions").deleteMany({}),
      db.collection("transactions").deleteMany({}),
      db.collection("authSessions").deleteMany({}),
    ]);

    // healthcheck doc so GET /api/health returns healthcheck_count >= 1.
    await db.collection("healthcheck").deleteMany({});
    await db.collection("healthcheck").insertOne({ createdAt: now });

    // Users: single admin + one active cashier.
    const adminRes = await db.collection("users").insertOne({
      email: ADMIN_EMAIL,
      passwordHash: adminHash,
      role: "admin",
      status: "active",
      createdAt: now,
    });
    const adminId = adminRes.insertedId;

    const cashierRes = await db.collection("users").insertOne({
      username: CASHIER_USERNAME,
      email: CASHIER_EMAIL,
      passwordHash: cashierHash,
      authProvider: "password",
      firstName: "Cashier",
      lastName: "One",
      displayName: "Cashier One",
      role: "cashier",
      status: "active",
      emailVerified: true,
      createdAt: now,
    });
    const cashierId = cashierRes.insertedId;

    // Tables: available / occupied / archived.
    await db.collection("tables").insertMany([
      { name: "Table 1", status: "available", archived: false, createdAt: now },
      { name: "Table 2", status: "occupied", archived: false, createdAt: now },
      { name: "Table 3", status: "available", archived: true, createdAt: now },
    ]);

    // Rates: one-time seed defaults (regular 140, special 180).
    await db.collection("rates").insertMany([
      { type: "regular", pricePerHour: 140, active: true, updatedAt: now },
      { type: "special", pricePerHour: 180, active: true, updatedAt: now },
    ]);

    // Settings documents (DB authoritative). Credentials are empty/masked.
    await db.collection("settings").insertMany([
      {
        key: "googleAuth",
        enabled: false,
        credentials: [{ name: "clientId", value: "", last4: "", updatedAt: null }],
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "googleMaps",
        enabled: true,
        credentials: [{ name: "apiKey", value: "", last4: "", updatedAt: null }],
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "recaptcha",
        enabled: false,
        credentials: [],
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "otp",
        enabled: false,
        credentials: [],
        updatedAt: null,
        updatedBy: null,
      },
    ]);

    // eslint-disable-next-line no-console
    console.log(
      `[resetDb] seeded ${env.MONGODB_DB}: adminId=${adminId} cashierId=${cashierId}`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[resetDb] failed:", err && err.message ? err.message : err);
  process.exit(1);
});
