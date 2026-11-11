// Environment loading + validation. Fail fast on missing required values.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureDns } from "./dns.js";
import { createEnvFileStore } from "./envFile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..", "..");
const envPath = path.join(serverRoot, ".env");

dotenv.config({ path: envPath });

// Settings > API writes admin credentials to the matching *_OVERRIDE keys.
// Keeping this here means the HTTP server, scripts and tests all resolve the
// same file.
const envFile = createEnvFileStore({ filePath: envPath });

export function persistEnvValue(key, value) {
  return envFile.set(key, value);
}

/** Add a missing key without touching an existing value (used by setup). */
export function ensureEnvValue(key, value = "") {
  return envFile.ensure(key, value);
}

// Applied here so every entry point (server, scripts, tests) resolves Atlas SRV
// records the same way before a MongoClient is created.
configureDns(process.env.MONGODB_DNS_SERVERS);

const REQUIRED = ["MONGODB_URI", "MONGODB_DB", "FRONTEND_URL", "SESSION_SECRET", "NODE_ENV"];

export const env = {
  NODE_ENV: process.env.NODE_ENV || "",
  PORT: Number(process.env.PORT || 8000),
  MONGODB_URI: process.env.MONGODB_URI || "",
  MONGODB_DB: process.env.MONGODB_DB || "",
  // Optional: resolver(s) Node uses for Atlas SRV lookups, e.g. "8.8.8.8,1.1.1.1".
  MONGODB_DNS_SERVERS: process.env.MONGODB_DNS_SERVERS || "",
  FRONTEND_URL: process.env.FRONTEND_URL || "",
  SESSION_SECRET: process.env.SESSION_SECRET || "",
  SESSION_TTL_SECONDS: Number(process.env.SESSION_TTL_SECONDS || 43200),
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME || "gh_session",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  // Admin overrides written by Settings > API. Empty = use the default above.
  GOOGLE_AUTH_CLIENT_ID_OVERRIDE: process.env.GOOGLE_AUTH_CLIENT_ID_OVERRIDE || "",
  // Optional: location map on the public landing page.
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || "",
  GOOGLE_MAPS_API_KEY_OVERRIDE: process.env.GOOGLE_MAPS_API_KEY_OVERRIDE || "",
  // Optional: accepted reservations become events on this shared calendar.
  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || "",
  GOOGLE_CALENDAR_ID_OVERRIDE: process.env.GOOGLE_CALENDAR_ID_OVERRIDE || "",
  GOOGLE_CALENDAR_CLIENT_EMAIL: process.env.GOOGLE_CALENDAR_CLIENT_EMAIL || "",
  GOOGLE_CALENDAR_CLIENT_EMAIL_OVERRIDE:
    process.env.GOOGLE_CALENDAR_CLIENT_EMAIL_OVERRIDE || "",
  GOOGLE_CALENDAR_PRIVATE_KEY: process.env.GOOGLE_CALENDAR_PRIVATE_KEY || "",
  GOOGLE_CALENDAR_PRIVATE_KEY_OVERRIDE:
    process.env.GOOGLE_CALENDAR_PRIVATE_KEY_OVERRIDE || "",
  MAIL_USER: process.env.MAIL_USER || "",
  MAIL_PASS: process.env.MAIL_PASS || "",
  MAIL_FROM: process.env.MAIL_FROM || "GameHub",
  MAIL_DRY_RUN: process.env.MAIL_DRY_RUN === "1",
  // Optional reCAPTCHA defaults. Used whenever the matching admin value is
  // empty, even when a `settings.recaptcha` document exists.
  RECAPTCHA_SITE_KEY: process.env.RECAPTCHA_SITE_KEY || "",
  RECAPTCHA_SITE_KEY_OVERRIDE: process.env.RECAPTCHA_SITE_KEY_OVERRIDE || "",
  RECAPTCHA_SECRET_KEY: process.env.RECAPTCHA_SECRET_KEY || "",
  RECAPTCHA_SECRET_KEY_OVERRIDE: process.env.RECAPTCHA_SECRET_KEY_OVERRIDE || "",
  // Optional PayMongo defaults; the *_OVERRIDE keys are filled by Settings > API.
  PAYMONGO_SECRET_KEY: process.env.PAYMONGO_SECRET_KEY || "",
  PAYMONGO_SECRET_KEY_OVERRIDE: process.env.PAYMONGO_SECRET_KEY_OVERRIDE || "",
  PAYMONGO_WEBHOOK_SECRET: process.env.PAYMONGO_WEBHOOK_SECRET || "",
  PAYMONGO_WEBHOOK_SECRET_OVERRIDE:
    process.env.PAYMONGO_WEBHOOK_SECRET_OVERRIDE || "",
  // Optional Google Gemini AI API key; the *_OVERRIDE key is filled by Settings > API.
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  GEMINI_API_KEY_OVERRIDE: process.env.GEMINI_API_KEY_OVERRIDE || "",
  // Optional: encrypts `secret: true` settings credentials at rest (AES-256-GCM).
  // Required before an admin can save a reCAPTCHA secret key or Calendar key.
  SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY || "",
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
