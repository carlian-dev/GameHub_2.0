// Unit tests for settings masking.
// migration.md §16: settings masking/required-credential rules.
// migration.md §13.6: 8 bullets plus a safe 4-char hint.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maskValue, googleClientIdHint } from "../../src/utils/mask.js";

describe("maskValue", () => {
  it("returns empty for empty value", () => {
    assert.strictEqual(maskValue(""), "");
  });

  it("returns 8 bullets for short value (<= 8 chars)", () => {
    assert.strictEqual(maskValue("abc"), "••••••••");
    assert.strictEqual(maskValue("12345678"), "••••••••");
  });

  it("returns 8 bullets + hint for long value (> 8 chars)", () => {
    assert.strictEqual(
      maskValue("abcdefghijkl", "ijkl"),
      "••••••••ijkl"
    );
    assert.strictEqual(
      maskValue("my-secret-key-12345", "12345"),
      "••••••••12345"
    );
  });

  it("uses last4 when no hint provided", () => {
    assert.strictEqual(maskValue("abcdefghijkl"), "••••••••ijkl");
  });
});

describe("googleClientIdHint", () => {
  it("returns last 4 before .apps.googleusercontent.com", () => {
    assert.strictEqual(
      googleClientIdHint("1234567890-abcdef.apps.googleusercontent.com"),
      "cdef"
    );
    assert.strictEqual(
      googleClientIdHint("XYZ123.apps.googleusercontent.com"),
      "Z123"
    );
  });

  it("returns empty for empty value", () => {
    assert.strictEqual(googleClientIdHint(""), "");
  });

  it("returns last 4 for non-Google-ID values", () => {
    assert.strictEqual(googleClientIdHint("somelongkey1234"), "1234");
  });
});
