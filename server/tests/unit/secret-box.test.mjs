// AES-256-GCM settings-secret storage.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSecretBox } from "../../src/utils/secretBox.js";

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

describe("createSecretBox", () => {
  it("is disabled when no key is configured", () => {
    const box = createSecretBox("");
    assert.equal(box.configured, false);
    assert.equal(box.decrypt({ alg: "aes-256-gcm", iv: "", tag: "", ciphertext: "" }), "");
  });

  it("rejects a malformed key instead of storing plaintext", () => {
    assert.throws(() => createSecretBox("not-a-key"), /64 hex/);
    assert.throws(() => createSecretBox("abc123"), /64 hex/);
  });

  it("round-trips a secret without keeping plaintext in the payload", () => {
    const box = createSecretBox(KEY);
    const payload = box.encrypt("super-secret-value");
    assert.equal(payload.alg, "aes-256-gcm");
    assert.equal("value" in payload, false);
    assert.equal(JSON.stringify(payload).includes("super-secret-value"), false);
    assert.equal(box.decrypt(payload), "super-secret-value");
  });

  it("uses a fresh IV per encryption", () => {
    const box = createSecretBox(KEY);
    const a = box.encrypt("same value");
    const b = box.encrypt("same value");
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ciphertext, b.ciphertext);
  });

  it("returns empty for a payload encrypted with another key", () => {
    const payload = createSecretBox(KEY).encrypt("secret");
    assert.equal(createSecretBox(OTHER_KEY).decrypt(payload), "");
  });
});
