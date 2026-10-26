// Unit tests for invite state logic.
// migration.md §16: Invite states: valid, used, expired, invalid.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

function inviteState(doc, nowMs) {
  if (!doc) return "invalid";
  if (!empty(doc.used)) return "used";
  if (inviteExpiresMs(doc) < nowMs) return "expired";
  return "valid";
}

function empty(v) {
  return v === null || v === undefined || v === false || v === 0 || v === "";
}

function inviteExpiresMs(doc) {
  const exp = doc.expiresAt;
  if (exp instanceof Date) return exp.getTime();
  return 0;
}

describe("invite states", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();

  it("null doc -> invalid", () => {
    assert.strictEqual(inviteState(null, now), "invalid");
  });

  it("valid unused unexpired -> valid", () => {
    const doc = { used: false, expiresAt: new Date("2026-01-02T12:00:00Z") };
    assert.strictEqual(inviteState(doc, now), "valid");
  });

  it("used -> used", () => {
    const doc = { used: true, expiresAt: new Date("2026-01-02T12:00:00Z") };
    assert.strictEqual(inviteState(doc, now), "used");
  });

  it("expired -> expired", () => {
    const doc = { used: false, expiresAt: new Date("2025-12-31T12:00:00Z") };
    assert.strictEqual(inviteState(doc, now), "expired");
  });
});
