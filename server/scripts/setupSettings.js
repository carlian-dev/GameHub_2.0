// One-time idempotent seed of the `settings` collection documents
// (googleAuth, googleMaps, recaptcha, otp). DB is authoritative; env defaults
// only apply when a document is absent. Guards against gamehub_2_0.
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
