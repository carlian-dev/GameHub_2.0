// One-time index creation for the migration test database only.
// Guards against gamehub_2_0. Creates the indexes the API relies on:
//   users.email partial unique, users.username partial unique,
//   tables.name unique, rates.type unique, invitations.tokenHash unique,
//   settings.key unique, transactions.ref unique, transactions.sessionId unique,
//   transactions {paidAt, method} compound,
//   sessions {tableId:1} unique partial {status:"active"} (optional, duplicate-checked).
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(serverRoot, ".env") });

import { validateEnv, env, assertTestDb } from "../src/config/env.js";

validateEnv();
assertTestDb(env.MONGODB_DB);

const OPTIONAL_SESSION_INDEX = {
  name: "uniq_active_session_per_table",
  keys: { tableId: 1 },
  options: {
    unique: true,
    partialFilterExpression: { status: "active" },
  },
};

async function main() {
  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const db = client.db(env.MONGODB_DB);
  try {
    // Required indexes.
    await db.collection("users").createIndex(
      { email: 1 },
      { unique: true, partialFilterExpression: { email: { $exists: true } }, name: "uniq_email" }
    );
    await db.collection("users").createIndex(
      { username: 1 },
      { unique: true, partialFilterExpression: { username: { $exists: true } }, name: "uniq_username" }
    );
    await db.collection("tables").createIndex({ name: 1 }, { unique: true, name: "uniq_table_name" });
    await db.collection("rates").createIndex({ type: 1 }, { unique: true, name: "uniq_rate_type" });
    await db.collection("invitations").createIndex(
      { tokenHash: 1 },
      { unique: true, name: "uniq_invitation_token" }
    );
    await db.collection("settings").createIndex({ key: 1 }, { unique: true, name: "uniq_settings_key" });
    await db.collection("transactions").createIndex({ ref: 1 }, { unique: true, name: "uniq_transaction_ref" });
    await db.collection("transactions").createIndex(
      { sessionId: 1 },
      { unique: true, name: "uniq_transaction_session" }
    );
    await db.collection("transactions").createIndex(
      { paidAt: 1, method: 1 },
      { name: "idx_transactions_paidAt_method" }
    );

    // Optional active-session index: only create if no duplicates already exist.
    const sessions = db.collection("sessions");
    const existing = await sessions
      .aggregate([
        { $match: { status: "active", tableId: { $exists: true } } },
        { $group: { _id: "$tableId", count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();
    if (existing.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `[setupIndexes] REFUSING optional index ${OPTIONAL_SESSION_INDEX.name}: duplicate active sessions per table found`,
        existing
      );
      process.exit(1);
    }
    await sessions.createIndex(OPTIONAL_SESSION_INDEX.keys, OPTIONAL_SESSION_INDEX.options);
    // eslint-disable-next-line no-console
    console.log(`[setupIndexes] indexes ensured in ${env.MONGODB_DB}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[setupIndexes] failed:", err && err.message ? err.message : err);
  process.exit(1);
});
