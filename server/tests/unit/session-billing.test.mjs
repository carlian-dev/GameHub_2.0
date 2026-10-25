// Unit tests for billing: billedHours, charge, rateTypeForStart, manilaHour.
// migration.md §16: billedHours, charge, Manila rate window at 17:59/18:00/23:59.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  billedHours,
  charge,
  rateTypeForStart,
  manilaHour,
} from "../../src/services/session.service.js";

describe("billedHours", () => {
  it("returns minimum 1 hour for any positive duration", () => {
    assert.strictEqual(billedHours(1), 1);
    assert.strictEqual(billedHours(60), 1);
    assert.strictEqual(billedHours(3599), 1);
  });

  it("ceil to whole hours", () => {
    assert.strictEqual(billedHours(3600), 1);
    assert.strictEqual(billedHours(3601), 2);
    assert.strictEqual(billedHours(7200), 2);
    assert.strictEqual(billedHours(7201), 3);
  });

  it("clamps negative to 0 then min 1", () => {
    assert.strictEqual(billedHours(-100), 1);
    assert.strictEqual(billedHours(0), 1);
  });
});

describe("charge", () => {
  const session = {
    startTime: new Date("2026-01-01T10:00:00Z"),
    pricePerHour: 140,
  };

  it("computes per-hour charge with 1-hour minimum", () => {
    // 30 minutes -> ceil(1800/3600) = 1 hour -> 140
    assert.strictEqual(charge(session, new Date("2026-01-01T10:30:00Z")), 140);
    // 90 minutes -> ceil(5400/3600) = 2 hours -> 280
    assert.strictEqual(charge(session, new Date("2026-01-01T11:30:00Z")), 280);
    // 2 hours -> 2 hours -> 280
    assert.strictEqual(charge(session, new Date("2026-01-01T12:00:00Z")), 280);
  });

  it("uses fallback rate when pricePerHour missing", () => {
    const noRate = { startTime: new Date("2026-01-01T10:00:00Z") };
    assert.strictEqual(charge(noRate, new Date("2026-01-01T11:00:00Z")), 140);
  });
});

describe("rateTypeForStart / manilaHour", () => {
  // Asia/Manila is UTC+8. 18:00 Manila = 10:00 UTC.
  const utc17_59_manila = new Date("2026-01-01T09:59:00Z"); // 17:59 Manila
  const utc18_00_manila = new Date("2026-01-01T10:00:00Z"); // 18:00 Manila
  const utc23_59_manila = new Date("2026-01-01T15:59:00Z"); // 23:59 Manila

  it("17:59 Manila -> regular", () => {
    assert.strictEqual(rateTypeForStart(utc17_59_manila), "regular");
    assert.strictEqual(manilaHour(utc17_59_manila), 17);
  });

  it("18:00 Manila -> special", () => {
    assert.strictEqual(rateTypeForStart(utc18_00_manila), "special");
    assert.strictEqual(manilaHour(utc18_00_manila), 18);
  });

  it("23:59 Manila -> special", () => {
    assert.strictEqual(rateTypeForStart(utc23_59_manila), "special");
    assert.strictEqual(manilaHour(utc23_59_manila), 23);
  });

  it("morning Manila -> regular", () => {
    const utc08_00_manila = new Date("2026-01-01T00:00:00Z"); // 08:00 Manila
    assert.strictEqual(rateTypeForStart(utc08_00_manila), "regular");
    assert.strictEqual(manilaHour(utc08_00_manila), 8);
  });
});
