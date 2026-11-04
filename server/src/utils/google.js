// Google OAuth client-ID shape check, shared by the settings service (env
// default + admin validation) and the auth service (token verification).
// A real web client ID looks like "<identifier>.apps.googleusercontent.com".
// Anything else (placeholder "<your>...", stray env value, whitespace) must
// never be published by GET /api/config or used to verify a sign-in token.
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{5,}\.apps\.googleusercontent\.com$/;

export function isValidGoogleClientId(value) {
  const v = typeof value === "string" ? value.trim() : "";
  return v !== "" && CLIENT_ID_RE.test(v);
}
