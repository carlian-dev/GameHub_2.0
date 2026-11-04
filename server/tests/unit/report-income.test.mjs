// Unit tests for /api/admin/reports/income (day/month/year income cards) and
// the daily report it shares its aggregation with.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reportService } from "../../src/services/report.service.js";

const DOCS = [
  { total: 140, method: "cash" },
  { total: 280, method: "gcash" },
  { total: 60.5, method: "cash" },
];

function service() {
  const calls = [];
  const svc = reportService({
    transactionModel: {
      list: async (filter) => {
        calls.push(filter);
        return DOCS;
      },
    },
  });
  return { svc, calls };
}

describe("reportService.income", () => {
  it("covers a single day (Nov 2, 2026)", async () => {
    const { svc, calls } = service();
    const r = await svc.income({ from: "2026-11-02", to: "2026-11-02" });
    assert.deepEqual(calls[0].paidAt, {
      $gte: new Date("2026-11-02T00:00:00Z"),
      $lt: new Date("2026-11-03T00:00:00Z"),
    });
    assert.equal(r.count, 3);
    assert.equal(r.gross, 480.5);
    assert.deepEqual(r.byMethod, {
      cash: { count: 2, gross: 200.5 },
      gcash: { count: 1, gross: 280 },
    });
    assert.equal(r.from, "2026-11-02");
    assert.equal(r.to, "2026-11-02");
  });

  it("covers a whole month (November 2026)", async () => {
    const { svc, calls } = service();
    await svc.income({ from: "2026-11-01", to: "2026-11-30" });
    assert.deepEqual(calls[0].paidAt, {
      $gte: new Date("2026-11-01T00:00:00Z"),
      $lt: new Date("2026-12-01T00:00:00Z"),
    });
  });

  it("covers a whole year (2026)", async () => {
    const { svc, calls } = service();
    await svc.income({ from: "2026-01-01", to: "2026-12-31" });
    assert.deepEqual(calls[0].paidAt, {
      $gte: new Date("2026-01-01T00:00:00Z"),
      $lt: new Date("2027-01-01T00:00:00Z"),
    });
  });

  it("with no range reads everything", async () => {
    const { svc, calls } = service();
    await svc.income({});
    assert.deepEqual(calls[0], {});
  });

  it("rejects malformed dates", async () => {
    const { svc } = service();
    await assert.rejects(() => svc.income({ from: "2026-11" }), /from must be YYYY-MM-DD/);
    await assert.rejects(() => svc.income({ to: "nope" }), /to must be YYYY-MM-DD/);
  });
});

describe("reportService.daily", () => {
  it("still returns the same shape for the dashboard", async () => {
    const { svc, calls } = service();
    const r = await svc.daily({ date: "2026-11-02" });
    assert.equal(r.date, "2026-11-02");
    assert.equal(r.count, 3);
    assert.equal(r.gross, 480.5);
    assert.equal(r.byMethod.cash.count, 2);
    assert.deepEqual(calls[0].paidAt, {
      $gte: new Date("2026-11-02T00:00:00Z"),
      $lt: new Date("2026-11-03T00:00:00Z"),
    });
  });
});
