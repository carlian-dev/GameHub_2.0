// Unit tests: checking in an accepted reservation opens a session for that
// table/customer (which marks the table occupied) and links it to the booking.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reservationService } from "../../src/services/reservation.service.js";

function makeEnv(overrides = {}) {
  const startTime = new Date(Date.now() + 60 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);
  const doc = {
    _id: "res-1",
    ref: "RS-20261118-ABCD",
    tableId: "507f1f77bcf86cd799439011",
    tableName: "Table 3",
    customerName: "Maria Cruz",
    customerEmail: "maria@example.com",
    contactNumber: "09171234567",
    startTime,
    endTime,
    durationMinutes: 120,
    status: "accepted",
    ...overrides,
  };
  const logs = [];
  const calls = [];
  const reservationModel = {
    async findByRef(ref) {
      return ref === doc.ref ? doc : null;
    },
    async claim(id, fromStatus, set) {
      if (id !== doc._id || doc.status !== fromStatus) return false;
      Object.assign(doc, set);
      return true;
    },
    async update(id, set) {
      if (id !== doc._id) return null;
      Object.assign(doc, set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const db = {
    collection: () => ({
      async insertOne(entry) {
        logs.push(entry);
        return { insertedId: "log-1" };
      },
    }),
  };
  const sessionService = {
    async start(input, actor) {
      calls.push({ input, actor });
      return {
        ok: true,
        session: {
          id: "session-1",
          tableId: input.tableId,
          tableName: doc.tableName,
          customerName: input.customerName,
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + input.durationMinutes * 60000).toISOString(),
          plannedMinutes: input.durationMinutes,
          status: "active",
          reservationRef: input.reservationRef,
        },
      };
    },
  };
  const svc = reservationService({
    reservationModel,
    tableModel: {},
    db,
    sessionService,
  });
  return { doc, logs, calls, svc };
}

describe("reservation check-in", () => {
  it("opens a session for the booked table and links the reservation", async () => {
    const { doc, logs, calls, svc } = makeEnv();

    const result = await svc.checkIn(doc.ref, { id: "cashier-1" });

    assert.equal(result.ok, true);
    assert.equal(result.reservation.status, "checked-in");
    assert.equal(result.reservation.sessionId, "session-1");
    assert.ok(result.reservation.sessionEndsAt);
    assert.equal(doc.checkedInBy, "cashier-1");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].input, {
      tableId: doc.tableId,
      customerName: doc.customerName,
      durationMinutes: 120,
      reservationRef: doc.ref,
    });
    assert.equal(calls[0].actor.id, "cashier-1");
    assert.equal(logs[0].action, "reservation_check_in");
    assert.equal(logs[0].target, doc.ref);
    assert.equal(logs[0].meta.sessionId, "session-1");
  });

  it("restores the accepted status when the session cannot start", async () => {
    const { doc } = makeEnv();
    const failing = reservationService({
      reservationModel: {
        async findByRef() {
          return doc;
        },
        async claim(id, fromStatus, set) {
          if (doc.status !== fromStatus) return false;
          Object.assign(doc, set);
          return true;
        },
        async update(id, set) {
          Object.assign(doc, set);
          return {};
        },
      },
      tableModel: {},
      db: { collection: () => ({ insertOne: async () => ({}) }) },
      sessionService: {
        async start() {
          const err = new Error("table is not available (current: occupied)");
          err.status = 409;
          throw err;
        },
      },
    });

    await assert.rejects(failing.checkIn(doc.ref, { id: "cashier-1" }), (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /not available/i);
      return true;
    });
    assert.equal(doc.status, "accepted");
    assert.equal(doc.checkedInAt, null);
    assert.equal(doc.sessionId, null);
  });

  it("only checks in accepted reservations", async () => {
    const { doc, svc } = makeEnv({ status: "reserved" });

    await assert.rejects(svc.checkIn(doc.ref, { id: "cashier-1" }), (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /reservation is reserved/i);
      return true;
    });
  });

  it("refuses a reservation whose window has already ended", async () => {
    const { doc, svc } = makeEnv({
      startTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
      endTime: new Date(Date.now() - 60 * 60 * 1000),
    });

    await assert.rejects(svc.checkIn(doc.ref, { id: "cashier-1" }), (err) => {
      assert.equal(err.status, 422);
      assert.match(err.message, /already ended/i);
      return true;
    });
    assert.equal(doc.status, "accepted");
  });

  it("derives the session length from legacy slots without durationMinutes", async () => {
    const { doc, calls, svc } = makeEnv({
      durationMinutes: undefined,
      startTime: new Date(Date.now() + 30 * 60 * 1000),
      endTime: new Date(Date.now() + 150 * 60 * 1000),
    });

    await svc.checkIn(doc.ref, { id: "cashier-1" });

    assert.equal(calls[0].input.durationMinutes, 120);
  });
});
