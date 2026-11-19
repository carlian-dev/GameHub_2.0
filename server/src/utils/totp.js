// RFC 6238 TOTP + RFC 4648 base32 helpers (Node crypto only, no dependency).
// Used exclusively by super-admin two-factor authentication: the shared secret
// is generated on the server, shown once as a QR code, and only the encrypted
// form is stored. Codes are 6 digits, SHA-1, 30-second period (the defaults
// every authenticator app understands).
import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** RFC 4648 base32 (no padding) — the format authenticator apps expect. */
export function base32Encode(buffer) {
  const bytes = Buffer.from(buffer || []);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode a base32 secret. Throws on characters outside the alphabet. */
export function base32Decode(input) {
  const clean = String(input || "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/=+$/g, "");
  if (!clean) throw new Error("empty TOTP secret");

  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("invalid base32 TOTP secret");
    value = value * 32 + index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push(Math.floor(value / 2 ** bits) & 0xff);
      value %= 2 ** bits;
    }
  }
  return Buffer.from(out);
}

/** 160-bit random secret (the RFC 4226 recommendation). */
export function generateTotpSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

export function totpCounter(time = Date.now(), stepSeconds = TOTP_STEP_SECONDS) {
  return Math.floor(Math.floor(time / 1000) / stepSeconds);
}

/** HMAC-based one-time password for a counter (RFC 4226). */
export function generateHotp(secret, counter, digits = TOTP_DIGITS) {
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    (digest[offset] & 0x7f) * 0x1000000 +
    (digest[offset + 1] & 0xff) * 0x10000 +
    (digest[offset + 2] & 0xff) * 0x100 +
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** TOTP for a point in time (defaults to now). */
export function generateTotp(
  secret,
  { time = Date.now(), stepSeconds = TOTP_STEP_SECONDS, digits = TOTP_DIGITS } = {}
) {
  return generateHotp(secret, totpCounter(time, stepSeconds), digits);
}

/**
 * Verify a submitted code. `window` allows ±1 time step of clock drift.
 * Returns the matched counter so callers can reject replays.
 */
export function verifyTotp(
  secret,
  token,
  { time = Date.now(), stepSeconds = TOTP_STEP_SECONDS, digits = TOTP_DIGITS, window = 1 } = {}
) {
  const code = String(token || "").replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return { valid: false };

  const current = totpCounter(time, stepSeconds);
  const submitted = Buffer.from(code);
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = current + offset;
    if (counter < 0) continue;
    const expected = Buffer.from(
      generateHotp(secret, counter, digits)
    );
    if (
      expected.length === submitted.length &&
      crypto.timingSafeEqual(expected, submitted)
    ) {
      return { valid: true, counter };
    }
  }
  return { valid: false };
}

/** otpauth:// URI consumed by Google/Microsoft/1Password authenticators. */
export function buildOtpAuthUrl({
  secret,
  account,
  issuer = "GameHub",
  digits = TOTP_DIGITS,
  stepSeconds = TOTP_STEP_SECONDS,
}) {
  const label = `${issuer}:${account}`;
  const params = new URLSearchParams({
    secret: String(secret || "").replace(/\s+/g, "").toUpperCase(),
    issuer,
    algorithm: "SHA1",
    digits: String(digits),
    period: String(stepSeconds),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}
