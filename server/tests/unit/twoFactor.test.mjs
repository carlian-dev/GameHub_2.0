// Step-up verification used when the super administrator changes credentials.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { twoFactorService } from "../../src/services/twoFactor.service.js";
import { createSecretBox } from "../../src/utils/secretBox.js";
import { base32Encode, generateTotp } from "../../src/utils/totp.js";

const KEY = "c".repeat(64);
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

function serviceFor({ twoFactor, status = "active", modifiedCount = 1 } = {}) {
  const box = createSecretBox(KEY);
  const user = {
    _id: "super-1",
    role: "super_admin",
    status,
    twoFactor:
      twoFactor === null
        ? undefined
        : { enabled: true, secretEnc: box.encrypt(SECRET), ...(twoFactor || {}) },
  };
  return twoFactorService({
    userModel: { findById: async () => user },
    db: {
      collection: () => ({
        updateOne: async () => ({ modifiedCount }),
        insertOne: async () => {},
      }),
    },
    encryptionKey: KEY,
  });
}

describe("super-admin two-factor step-up", () => {
  it("accepts a current authenticator code", async () => {
    const svc = serviceFor();
    assert.equal(await svc.verifyStepUp("super-1", generateTotp(SECRET)), true);
  });

  it("rejects a malformed code", async () => {
    const svc = serviceFor();
    await assert.rejects(
      () => svc.verifyStepUp("super-1", "abcdef"),
      (err) => err.status === 422 && /invalid authenticator code/i.test(err.message)
    );
  });

  it("rejects a stale code that the database guard refuses", async () => {
    const svc = serviceFor({ modifiedCount: 0 });
    await assert.rejects(
      () => svc.verifyStepUp("super-1", generateTotp(SECRET)),
      (err) => err.status === 409 && /too old/i.test(err.message)
    );
  });

  it("rejects when no authenticator app is paired", async () => {
    const svc = serviceFor({ twoFactor: null });
    await assert.rejects(
      () => svc.verifyStepUp("super-1", generateTotp(SECRET)),
      (err) => err.status === 409 && /not enabled/i.test(err.message)
    );
  });

  it("rejects an inactive account", async () => {
    const svc = serviceFor({ status: "archived" });
    await assert.rejects(
      () => svc.verifyStepUp("super-1", generateTotp(SECRET)),
      (err) => err.status === 403
    );
  });
});
