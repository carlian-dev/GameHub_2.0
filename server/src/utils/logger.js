// Small structured logger — redacted (no secrets). migration.md §10.
// Never log cookie, authorization, password, passwordHash, idToken, credentials,
// token, link, MONGODB_URI, MAIL_PASS, SESSION_SECRET.
const REDACTED = "[redacted]";
const SECRET_KEYS = new Set([
  "password", "passwordhash", "idtoken", "credentials", "token", "link",
  "authorization", "cookie", "mongodb_uri", "mail_pass", "session_secret",
]);

function redact(value) {
  if (typeof value === "string" && value.length > 0) return REDACTED;
  return value;
}

function redactObj(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactObj);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SECRET_KEYS.has(String(k).toLowerCase()) ? REDACTED : redactObj(v);
  }
  return out;
}

export function logger(level, message, meta) {
  const entry = { level, message, timestamp: new Date().toISOString() };
  if (meta != null) entry.meta = redactObj(meta);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

export function info(message, meta) {
  logger("info", message, meta);
}

export function error(message, meta) {
  logger("error", message, meta);
}
