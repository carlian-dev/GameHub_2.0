// One-time idempotent seed of the `settings` collection documents
// (googleAuth, googleMaps, googleCalendar, recaptcha, paymongo, otp). DB is
// authoritative; env defaults only apply when a document is absent. Guards
// against gamehub_2_0.
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

const SETTINGS = [
  {
    key: "googleAuth",
    enabled: false,
    // Object keyed by credential name — the shape settings.service.js and the
    // PHP backend both read (`credentials.clientId.value`). An array here makes
    // `credentials.<name>` updates fail with "Cannot create field".
    credentials: { clientId: { value: "", last4: "", updatedAt: null } },
    updatedAt: null,
    updatedBy: null,
  },
  {
    key: "googleMaps",
    enabled: true,
    credentials: { apiKey: { value: "", last4: "", updatedAt: null } },
    updatedAt: null,
    updatedBy: null,
  },
  {
    key: "googleCalendar",
    enabled: false,
    credentials: {
      calendarId: { value: "", last4: "", updatedAt: null },
      clientEmail: { value: "", last4: "", updatedAt: null },
      privateKey: { value: "", last4: "", updatedAt: null },
    },
    updatedAt: null,
    updatedBy: null,
  },
  {
    key: "recaptcha",
    enabled: false,
    credentials: {
      siteKey: { value: "", last4: "", updatedAt: null },
      secretKey: { value: "", last4: "", updatedAt: null },
    },
    updatedAt: null,
    updatedBy: null,
  },
  {
    key: "paymongo",
    enabled: false,
    credentials: {
      secretKey: { value: "", last4: "", updatedAt: null },
      webhookSecret: { value: "", last4: "", updatedAt: null },
    },
    updatedAt: null,
    updatedBy: null,
  },
  {
    key: "otp",
    enabled: false,
    credentials: {},
    updatedAt: null,
    updatedBy: null,
  },
];

async function main() {
  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const db = client.db(env.MONGODB_DB);
  try {
    for (const doc of SETTINGS) {
      await db
        .collection("settings")
        .updateOne({ key: doc.key }, { $setOnInsert: doc }, { upsert: true });
    }
    // eslint-disable-next-line no-console
    console.log(`[setupSettings] ensured ${SETTINGS.length} settings docs in ${env.MONGODB_DB}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[setupSettings] failed:", err && err.message ? err.message : err);
  process.exit(1);
});
