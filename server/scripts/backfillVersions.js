// One-time backfill for the sync version counters.
// Documents written before versioning existed have no `version` field, and
// $inc on a missing field creates it as 1 — the same value clients assume for
// "never modified", so their first real change would go unseen. Set version: 1
// on every legacy row of the versioned collections before switching clients to
// compare versions.
//
// Dry run (counts only):  node scripts/backfillVersions.js
// Apply:                  node scripts/backfillVersions.js --yes
// Safe to re-run: only rows without the field are touched.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(serverRoot, ".env") });

import { validateEnv, env } from "../src/config/env.js";

const COLLECTIONS = ["tables", "sessions", "reservations"];

async function main() {
  validateEnv();
  const apply = process.argv.includes("--yes");
  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const db = client.db(env.MONGODB_DB);
  try {
    for (const name of COLLECTIONS) {
      const coll = db.collection(name);
      const filter = { version: { $exists: false } };
      const missing = await coll.countDocuments(filter);
      // eslint-disable-next-line no-console
      console.log(
        `[backfillVersions] ${name}: ${missing} document(s) without version` +
          (apply ? "" : " (dry run)")
      );
      if (!apply || missing === 0) continue;
      const res = await coll.updateMany(filter, { $set: { version: 1 } });
      // eslint-disable-next-line no-console
      console.log(
        `[backfillVersions] ${name}: set version=1 on ${res.modifiedCount} document(s)`
      );
    }
    if (!apply) {
      // eslint-disable-next-line no-console
      console.log("[backfillVersions] dry run only — re-run with --yes to write");
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    "[backfillVersions] failed:",
    err && err.message ? err.message : err
  );
  process.exit(1);
});
