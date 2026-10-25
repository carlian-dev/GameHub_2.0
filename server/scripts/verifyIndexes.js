// Read-only index verification. Reports which expected indexes exist / are missing.
// Does NOT create anything. Safe against gamehub_2_0 for reads only, but still
// guarded so operators never run it unintentionally against production data.
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

const EXPECTED = [
  { coll: "users", name: "uniq_email" },
  { coll: "users", name: "uniq_username" },
  { coll: "tables", name: "uniq_table_name" },
  { coll: "rates", name: "uniq_rate_type" },
  { coll: "invitations", name: "uniq_invitation_token" },
  { coll: "settings", name: "uniq_settings_key" },
  { coll: "transactions", name: "uniq_transaction_ref" },
  { coll: "transactions", name: "uniq_transaction_session" },
  { coll: "transactions", name: "idx_transactions_paidAt_method" },
  { coll: "sessions", name: "uniq_active_session_per_table" },
];

async function main() {
  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const db = client.db(env.MONGODB_DB);
  try {
    let missing = 0;
    // eslint-disable-next-line no-console
    console.log(`[verifyIndexes] ${env.MONGODB_DB}`);
    for (const { coll, name } of EXPECTED) {
      const indexes = await db.collection(coll).indexes();
      const found = indexes.some((idx) => idx.name === name);
      // eslint-disable-next-line no-console
      console.log(`  ${found ? "[ok] " : "[missing] "}${coll}.${name}`);
      if (!found) missing += 1;
    }
    // eslint-disable-next-line no-console
    console.log(missing === 0 ? "[verifyIndexes] all expected indexes present" : `[verifyIndexes] ${missing} index(es) missing`);
    process.exit(missing === 0 ? 0 : 1);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[verifyIndexes] failed:", err && err.message ? err.message : err);
  process.exit(1);
});
