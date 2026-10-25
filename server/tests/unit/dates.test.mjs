// Unit tests for date parsing (strict YYYY-MM-DD).
// migration.md §16: Date-range filters.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

function parseDay(raw, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
    const err = new Error(`${field} must be YYYY-MM-DD`);
    err.status = 422;
    throw err;
  }
  const d = new Date(Date.UTC(
    Number(raw.slice(0, 4)),
    Number(raw.slice(5, 7)) - 1,
    Number(raw.slice(8, 10))
  ));
  if (isNaN(d.getTime())) {
    const err = new Error(`${field} must be YYYY-MM-DD`);
    err.status = 422;
    throw err;
  }
  return d;
}

describe("parseDay", () => {
  it("accepts valid YYYY-MM-DD", () => {
    const d = parseDay("2026-01-15", "date");
    assert.strictEqual(d.getUTCFullYear(), 2026);
    assert.strictEqual(d.getUTCMonth(), 0);
    assert.strictEqual(d.getUTCDate(), 15);
    assert.strictEqual(d.getUTCHours(), 0);
    assert.strictEqual(d.getUTCMinutes(), 0);
    assert.strictEqual(d.getUTCSeconds(), 0);
    assert.strictEqual(d.getUTCMilliseconds(), 0);
  });

  it("rejects invalid format", () => {
    assert.throws(() => parseDay("2026-1-5", "date"), /must be YYYY-MM-DD/);
    assert.throws(() => parseDay("not-a-date", "date"), /must be YYYY-MM-DD/);
    assert.throws(() => parseDay("", "date"), /must be YYYY-MM-DD/);
  });
});
