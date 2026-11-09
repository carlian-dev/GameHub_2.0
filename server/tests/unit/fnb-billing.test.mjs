// Unit tests for Sprint 5 F&B math and reporting.
// Covers the shared billing helpers (session charge + item snapshots) and the
// report split/CSV rules, including legacy transactions with no F&B fields.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  billedHours,
  billTotals,
  fnbItems,
  fnbTotalOf,
  sessionCharge,
} from "../../src/utils/billing.js";
import { reportService } from "../../src/services/report.service.js";

const START = new Date("2026-11-04T10:00:00Z");

function session(overrides = {}) {
  return {
    startTime: START,
    closedAt: new Date("2026-11-04T11:00:00Z"),
    pricePerHour: 240,
    fnbOrders: [
      {
        productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        name: "Coke",
        category: "beverage",
        unitPrice: 35,
        qty: 2,
        lineTotal: 70,
      },
      {
        productId: "bbbbbbbbbbbbbbbbbbbbbbbb",
        name: "Chips",
        category: "food",
        unitPrice: 50,
        qty: 1,
        lineTotal: 50,
      },
    ],
    ...overrides,
  };
}

describe("billing helpers (Sprint 5)", () => {
  it("billedHours keeps the 1-hour minimum and ceilings", () => {
    assert.equal(billedHours(0), 1);
    assert.equal(billedHours(3599), 1);
    assert.equal(billedHours(3600), 1);
    assert.equal(billedHours(3601), 2);
    assert.equal(billedHours(-20), 1);
  });

  it("fnbItems snapshots only the bill fields, rounded", () => {
    const items = fnbItems(
      session({
        fnbOrders: [
          {
            productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
            name: "Coke",
            category: "beverage",
            unitPrice: 35.0000001,
            qty: 2,
            lineTotal: 70.0000001,
            addedBy: "secret-internal-field",
          },
        ],
      })
    );
    assert.deepEqual(items, [
      {
        productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        name: "Coke",
        category: "beverage",
        unitPrice: 35,
        qty: 2,
        lineTotal: 70,
      },
    ]);
  });

  it("fnbTotalOf sums stored line totals and tolerates a missing array", () => {
    assert.equal(fnbTotalOf(session()), 120);
    assert.equal(fnbTotalOf({}), 0);
    assert.equal(fnbTotalOf({ fnbOrders: [] }), 0);
  });

  it("sessionCharge uses the closed time and the rate snapshot", () => {
    assert.equal(sessionCharge(session()), 240);
    // 61 minutes -> 2 hours.
    assert.equal(
      sessionCharge(session({ closedAt: new Date("2026-11-04T11:01:00Z") })),
      480
    );
    assert.equal(sessionCharge({}), 0);
  });

  it("billTotals combines session + F&B with one final rounding", () => {
    assert.deepEqual(billTotals(session()), {
      sessionTotal: 240,
      fnbTotal: 120,
      total: 360,
    });
    assert.deepEqual(billTotals(session({ fnbOrders: [] })), {
      sessionTotal: 240,
      fnbTotal: 0,
      total: 240,
    });
  });
});

const TX_DOCS = [
  {
    ref: "GH-1",
    paidAt: new Date("2026-11-04T10:00:00Z"),
    tableName: "Table 1",
    customerName: "Ana",
    cashierName: "Cashier One",
    minutes: 60,
    billedHours: 1,
    pricePerHour: 240,
    rateType: "regular",
    sessionTotal: 240,
    fnbTotal: 120,
    total: 360,
    method: "cash",
    received: 500,
    change: 140,
    items: [
      {
        name: "Coke",
        qty: 2,
        unitPrice: 35,
        lineTotal: 70,
      },
      {
        name: 'Chips, "large"',
        qty: 1,
        unitPrice: 50,
        lineTotal: 50,
      },
    ],
  },
  {
    // Legacy document: no split and no items.
    ref: "GH-2",
    paidAt: new Date("2026-11-04T12:00:00Z"),
    tableName: "Table 2",
    customerName: "Ben",
    cashierName: "Cashier One",
    minutes: 30,
    billedHours: 1,
    pricePerHour: 140,
    rateType: "regular",
    total: 140,
    method: "gcash",
    received: 140,
    change: 0,
  },
];

function service(docs = TX_DOCS) {
  return reportService({
    transactionModel: {
      list: async () => docs,
    },
  });
}

describe("report F&B split", () => {
  it("reports grand, session, and F&B gross with legacy fallback", async () => {
    const r = await service().daily({ date: "2026-11-04" });
    assert.equal(r.count, 2);
    assert.equal(r.gross, 500);
    assert.equal(r.sessionGross, 380);
    assert.equal(r.fnbGross, 120);
    assert.deepEqual(r.byMethod, {
      cash: { count: 1, gross: 360 },
      gcash: { count: 1, gross: 140 },
    });
  });

  it("income ranges expose the same split", async () => {
    const r = await service().income({
      from: "2026-11-04",
      to: "2026-11-04",
    });
    assert.equal(r.sessionGross, 380);
    assert.equal(r.fnbGross, 120);
  });
});

describe("report CSV", () => {
  it("appends the split columns and escapes commas/quotes", async () => {
    const { body } = await service().export({});
    const lines = body.trimEnd().split("\n");
    assert.equal(
      lines[0],
      "ref,paidAt,table,customer,cashier,minutes,billedHours,rate,rateType,total,method,received,change,sessionTotal,fnbTotal,items"
    );
    assert.equal(
      lines[1],
      'GH-1,2026-11-04T10:00:00.000Z,Table 1,Ana,Cashier One,60,1,240,regular,360,cash,500,140,240,120,"Coke x2 @35.00; Chips, ""large"" x1 @50.00"'
    );
    // Legacy row: sessionTotal = total, fnbTotal = 0, empty item summary.
    assert.equal(
      lines[2],
      "GH-2,2026-11-04T12:00:00.000Z,Table 2,Ben,Cashier One,30,1,140,regular,140,gcash,140,0,140,0,"
    );
  });
});
