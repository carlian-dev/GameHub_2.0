import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePassword,
  validateUsername,
  PASSWORD_LEVELS,
} from "../../src/utils/passwordStrength.js";

describe("validateUsername", () => {
  it("accepts valid usernames", () => {
    const valid = ["juan.cashier", "cashier_01", "juan-c", "alex123", "user.name.ok"];
    for (const u of valid) {
      const res = validateUsername(u);
      assert.strictEqual(res.valid, true, `Expected valid for ${u}`);
      assert.strictEqual(res.normalized, u.toLowerCase());
    }
  });

  it("rejects too short or too long usernames", () => {
    assert.strictEqual(validateUsername("ab").valid, false);
    assert.strictEqual(validateUsername("a".repeat(31)).valid, false);
  });

  it("rejects invalid characters", () => {
    assert.strictEqual(validateUsername("juan cashier").valid, false);
    assert.strictEqual(validateUsername("juan@cashier").valid, false);
    assert.strictEqual(validateUsername("juan!").valid, false);
  });

  it("rejects usernames starting or ending with punctuation", () => {
    assert.strictEqual(validateUsername(".juancashier").valid, false);
    assert.strictEqual(validateUsername("juancashier.").valid, false);
    assert.strictEqual(validateUsername("_juancashier").valid, false);
    assert.strictEqual(validateUsername("juancashier_").valid, false);
    assert.strictEqual(validateUsername("-juancashier").valid, false);
    assert.strictEqual(validateUsername("juancashier-").valid, false);
  });

  it("rejects consecutive punctuation", () => {
    assert.strictEqual(validateUsername("juan..cashier").valid, false);
    assert.strictEqual(validateUsername("juan__cashier").valid, false);
    assert.strictEqual(validateUsername("juan--cashier").valid, false);
    assert.strictEqual(validateUsername("juan._cashier").valid, false);
  });

  it("rejects reserved system usernames", () => {
    const reserved = ["admin", "administrator", "super_admin", "superadmin", "cashier", "root", "system"];
    for (const r of reserved) {
      const res = validateUsername(r);
      assert.strictEqual(res.valid, false, `Expected rejected reserved name ${r}`);
      assert.match(res.error, /reserved/i);
    }
  });
});

describe("evaluatePassword", () => {
  it("treats empty password as score 0 and no level", () => {
    const res = evaluatePassword("");
    assert.strictEqual(res.score, 0);
    assert.strictEqual(res.level, "");
    assert.strictEqual(res.isValid, false);
  });

  it("identifies Weak passwords", () => {
    // Too short (< 8 chars)
    assert.strictEqual(evaluatePassword("short").level, PASSWORD_LEVELS.WEAK);
    assert.strictEqual(evaluatePassword("Ab1!").level, PASSWORD_LEVELS.WEAK);

    // Only numbers
    assert.strictEqual(evaluatePassword("123456789").level, PASSWORD_LEVELS.WEAK);

    // Only lowercase letters
    assert.strictEqual(evaluatePassword("abcdefghij").level, PASSWORD_LEVELS.WEAK);

    // Common weak password
    assert.strictEqual(evaluatePassword("password123").level, PASSWORD_LEVELS.WEAK);
    assert.strictEqual(evaluatePassword("12345678").level, PASSWORD_LEVELS.WEAK);

    // Personal info containment
    const withUsername = evaluatePassword("CashierAlex123!", { username: "alex123" });
    assert.strictEqual(withUsername.level, PASSWORD_LEVELS.WEAK);
    assert.strictEqual(withUsername.checks.noUsername, false);

    const withName = evaluatePassword("SecretJuan123!", { firstName: "Juan", lastName: "Dela Cruz" });
    assert.strictEqual(withName.level, PASSWORD_LEVELS.WEAK);
    assert.strictEqual(withName.checks.noUsername, false);
  });

  it("identifies Moderate passwords", () => {
    // 8-9 chars with 3 pools (uppercase, lowercase, number)
    const m1 = evaluatePassword("Cashier1", { username: "juan" });
    assert.strictEqual(m1.level, PASSWORD_LEVELS.MODERATE);
    assert.strictEqual(m1.isValid, true);
    assert.strictEqual(m1.score, 2);

    // 8-9 chars with lowercase, numbers, symbols
    const m2 = evaluatePassword("secret#9", { username: "juan" });
    assert.strictEqual(m2.level, PASSWORD_LEVELS.MODERATE);
    assert.strictEqual(m2.isValid, true);
  });

  it("identifies Strong passwords", () => {
    // 8+ chars with all 4 pools
    const s1 = evaluatePassword("Cashier#1", { username: "juan" });
    assert.strictEqual(s1.level, PASSWORD_LEVELS.STRONG);
    assert.strictEqual(s1.isValid, true);
    assert.strictEqual(s1.score, 3);

    // 10+ chars with 3 pools (upper, lower, number)
    const s2 = evaluatePassword("GoldenBilliard2026", { username: "juan" });
    assert.strictEqual(s2.level, PASSWORD_LEVELS.STRONG);
    assert.strictEqual(s2.isValid, true);

    // 12+ chars complex
    const s3 = evaluatePassword("Tr0ngP@ssw0rd!2026", { username: "juan" });
    assert.strictEqual(s3.level, PASSWORD_LEVELS.STRONG);
    assert.strictEqual(s3.isValid, true);
  });
});
