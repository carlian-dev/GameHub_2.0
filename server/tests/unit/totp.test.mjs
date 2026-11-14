// RFC 6238 test vectors for the super-admin authenticator codes.
// Secret = ASCII "12345678901234567890" (the RFC reference secret).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUrl,
  generateTotp,
  verifyTotp,
} from "../../src/utils/totp.js";

const SECRET = base32Encode(Buffer.from("12345678901234567890"));
const STEP = 30;

describe("totp", () => {
  it("round-trips base32 secrets", () => {
    const raw = Buffer.from("GameHub 2FA secret");
    assert.deepEqual(base32Decode(base32Encode(raw)), raw);
    assert.deepEqual(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), Buffer.from("12345678901234567890"));
  });

  it("matches the RFC 6238 SHA-1 vectors", () => {
    const vectors = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [seconds, expected] of vectors) {
      assert.equal(
        generateTotp(SECRET, { time: seconds * 1000, digits: 8, stepSeconds: STEP }),
        expected,
        `T=${seconds}`
      );
    }
  });

  it("receives 6-digit codes and accepts one step of clock drift", () => {
    const now = 1_700_000_000_000;
    const code = generateTotp(SECRET, { time: now });
    assert.match(code, /^\d{6}$/);

    const previous = generateTotp(SECRET, { time: now - STEP * 1000 });
    const next = generateTotp(SECRET, { time: now + STEP * 1000 });
    assert.equal(verifyTotp(SECRET, code, { time: now }).valid, true);
    assert.equal(verifyTotp(SECRET, previous, { time: now }).valid, true);
    assert.equal(verifyTotp(SECRET, next, { time: now }).valid, true);
    assert.equal(verifyTotp(SECRET, code, { time: now + 5 * STEP * 1000 }).valid, false);
  });

  it("rejects malformed codes without throwing", () => {
    const now = 1_700_000_000_000;
    assert.equal(verifyTotp(SECRET, "", { time: now }).valid, false);
    assert.equal(verifyTotp(SECRET, "12345", { time: now }).valid, false);
    assert.equal(verifyTotp(SECRET, "abcdef", { time: now }).valid, false);
    assert.equal(verifyTotp(SECRET, null, { time: now }).valid, false);
  });

  it("reports the matched counter for replay protection", () => {
    const now = 1_700_000_000_000;
    const result = verifyTotp(SECRET, generateTotp(SECRET, { time: now }), { time: now });
    assert.equal(result.valid, true);
    assert.equal(result.counter, Math.floor(now / 1000 / STEP));
  });

  it("builds an otpauth URI authenticator apps understand", () => {
    const url = buildOtpAuthUrl({
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      account: "owner@example.com",
      issuer: "GameHub",
    });
    assert.match(url, /^otpauth:\/\/totp\//);
    assert.match(url, /secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ/);
    assert.match(url, /issuer=GameHub/);
    assert.match(url, /algorithm=SHA1/);
    assert.match(url, /digits=6/);
    assert.match(url, /period=30/);
    assert.match(url, /owner%40example\.com/);
  });
});
