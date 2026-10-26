// Environment loading + validation. Fail fast on missing required values.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..", "..");

dotenv.config({ path: path.join(serverRoot, ".env") });

const REQUIRED = ["MONGODB_URI", "MONGODB_DB", "FRONTEND_URL", "SESSION_SECRET", "NODE_ENV"];

export const env = {
  NODE_ENV: process.env.NODE_ENV || "",
  PORT: Number(process.env.PORT || 8000),
  MONGODB_URI: process.env.MONGODB_URI || "",
  MONGODB_DB: process.env.MONGODB_DB || "",
  FRONTEND_URL: process.env.FRONTEND_URL || "",
  SESSION_SECRET: process.env.SESSION_SECRET || "",
  SESSION_TTL_SECONDS: Number(process.env.SESSION_TTL_SECONDS || 43200),
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME || "gh_session",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  MAIL_USER: process.env.MAIL_USER || "",
  MAIL_PASS: process.env.MAIL_PASS || "",
  MAIL_FROM: process.env.MAIL_FROM || "GameHub",
  MAIL_DRY_RUN: process.env.MAIL_DRY_RUN === "1",
  TRUST_PROXY: process.env.TRUST_PROXY || "0",
};

export function validateEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`missing required env: ${missing.join(", ")}`);
  }
}

// Guard used by any script/test that writes to Mongo. Never run writes against gamehub_2_0.
export function assertTestDb(dbName = env.MONGODB_DB) {
  if (!/(^|_)migtest$/.test(dbName)) {
    throw new Error(`refusing to write: "${dbName}" is not a migration test database`);
  }
  return true;
}
