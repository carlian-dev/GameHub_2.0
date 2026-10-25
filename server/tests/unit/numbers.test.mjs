// Unit tests for money rounding (round2).
// migration.md §16: round2() — never use Math.round() for money.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { round2 } from "../../src/utils/numbers.js";

describe("round2", () => {
  it("rounds to 2 decimals", () => {
    assert.strictEqual(round2(140.005), 140.01);
    assert.strictEqual(round2(140.004), 140);
    assert.strictEqual(round2(0), 0);
    assert.strictEqual(round2(1), 1);
    assert.strictEqual(round2(1.5), 1.5);
    assert.strictEqual(round2(1.555), 1.56);
    assert.strictEqual(round2(1000000), 1000000);
  });

  it("handles floating point precision", () => {
    // 0.1 + 0.2 = 0.30000000000000004; round2 should give 0.3
    assert.strictEqual(round2(0.1 + 0.2), 0.3);
  });
});
