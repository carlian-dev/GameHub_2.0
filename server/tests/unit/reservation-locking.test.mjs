// Unit tests: Pessimistic locking in the reservation section.
// Verifies that locking serializes concurrent operations (table booking, check-in, accept/reject),
// prevents double-booking race conditions, and preserves MVCC versions.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createReservationLockManager } from "../../src/utils/reservationLock.js";
import { reservationModel as createReservationModel } from "../../src/models/reservation.model.js";
import { reservationService } from "../../src/services/reservation.service.js";

describe("reservation locking — KeyedMutex & LockManager", () => {
  it("acquires and releases a lock exclusively", async () => {
    const lockMgr = createReservationLockManager();
    const order = [];

    const task1 = lockMgr.withLock("table:1", async () => {
      order.push("task1-start");
      await new Promise((r) => setTimeout(r, 40));
      order.push("task1-end");
    });

    const task2 = lockMgr.withLock("table:1", async () => {
      order.push("task2-start");
      order.push("task2-end");
    });

    await Promise.all([task1, task2]);

    assert.deepEqual(order, [
      "task1-start",
      "task1-end",
      "task2-start",
      "task2-end",
    ]);
  });

  it("allows locks on different resources to run in parallel", async () => {
    const lockMgr = createReservationLockManager();
    const order = [];

    const task1 = lockMgr.withLock("table:1", async () => {
      order.push("t1-start");
      await new Promise((r) => setTimeout(r, 40));
      order.push("t1-end");
    });

    const task2 = lockMgr.withLock("table:2", async () => {
      order.push("t2-start");
      await new Promise((r) => setTimeout(r, 10));
      order.push("t2-end");
    });

    await Promise.all([task1, task2]);

    // t2 starts before t1 ends because they are different tables
    assert.equal(order[0], "t1-start");
    assert.equal(order[1], "t2-start");
  });

  it("times out if a lock is held beyond timeoutMs", async () => {
    const lockMgr = createReservationLockManager();
    let release;
    const blocker = lockMgr.acquireLock("table:timeout-test", {
      ttlMs: 5000,
      timeoutMs: 1000,
    }).then((l) => {
      release = l;
    });

    await blocker;

    await assert.rejects(
      async () => {
        await lockMgr.acquireLock("table:timeout-test", {
          timeoutMs: 50,
          retryIntervalMs: 10,
        });
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.match(err.message, /reservation lock conflict/);
        return true;
      }
    );

    await lockMgr.releaseLock(release);
  });
});

describe("reservation locking — concurrent table reservations", () => {
  it("prevents double-booking when two requests race to reserve the same table", async () => {
    const reservationsDb = [];
    const tableId = "507f1f77bcf86cd799439011";

    const reservationModelMock = {
      async list() {
        return reservationsDb;
      },
      async findByRef(ref) {
        return reservationsDb.find((r) => r.ref === ref) || null;
      },
      async findOverlapping(tid, start, end) {
        return reservationsDb.filter((r) => {
          if (String(r.tableId) !== String(tid)) return false;
          if (!["reserved", "accepted", "checked-in"].includes(r.status)) return false;
          return r.startTime < end && r.endTime > start;
        });
      },
      async create(doc) {
        // Retain MVCC version: 1
        const item = { _id: `res-${reservationsDb.length + 1}`, version: 1, ...doc };
        // Simulate a slight DB write latency
        await new Promise((r) => setTimeout(r, 20));
        reservationsDb.push(item);
        return item._id;
      },
      async findById(id) {
        return reservationsDb.find((r) => r._id === id) || null;
      },
      async update(id, set) {
        const item = reservationsDb.find((r) => r._id === id);
        if (!item) return null;
        Object.assign(item, set, { version: (item.version || 1) + 1 });
        return { modifiedCount: 1 };
      },
    };

    const tableModelMock = {
      async findById(id) {
        if (id === tableId) {
          return { _id: tableId, name: "Table 1", archived: false, status: "available" };
        }
        return null;
      },
    };

    const dbMock = {
      collection: () => ({
        async insertOne() {
          return { insertedId: "log-1" };
        },
      }),
    };

    const lockManager = createReservationLockManager();
    const svc = reservationService({
      reservationModel: {
        ...reservationModelMock,
        withLock: lockManager.withLock,
      },
      tableModel: tableModelMock,
      db: dbMock,
    });

    const bookingTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const input1 = {
      tableId,
      customerName: "Alice Smith",
      customerEmail: "alice@example.com",
      contactNumber: "09171111111",
      startTime: bookingTime.toISOString(),
      durationMinutes: 60,
    };
    const input2 = {
      tableId,
      customerName: "Bob Jones",
      customerEmail: "bob@example.com",
      contactNumber: "09182222222",
      startTime: bookingTime.toISOString(),
      durationMinutes: 60,
    };

    // Both requests fire concurrently for the exact same slot
    const results = await Promise.allSettled([
      svc.createReservation(input1),
      svc.createReservation(input2),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one reservation was created; the second was rejected due to overlap
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.status, 409);
    assert.match(rejected[0].reason.message, /unavailable/);

    // Verify MVCC version: 1 is preserved
    assert.equal(reservationsDb.length, 1);
    assert.equal(reservationsDb[0].version, 1);
  });
});

describe("reservation locking — concurrent cashier operations & MVCC preservation", () => {
  it("serializes concurrent accept and reject decisions on the same reservation", async () => {
    const reservationDoc = {
      _id: "res-100",
      ref: "RS-20261122-XYZ1",
      tableId: "507f1f77bcf86cd799439011",
      tableName: "Table 1",
      customerName: "Charlie",
      customerEmail: "charlie@example.com",
      contactNumber: "09193333333",
      startTime: new Date(Date.now() + 3600000),
      endTime: new Date(Date.now() + 7200000),
      durationMinutes: 60,
      status: "reserved",
      version: 1,
    };

    const reservationModelMock = {
      async findByRef(ref) {
        return ref === reservationDoc.ref ? reservationDoc : null;
      },
      async update(id, set) {
        if (id === reservationDoc._id) {
          Object.assign(reservationDoc, set, { version: reservationDoc.version + 1 });
          return { modifiedCount: 1 };
        }
        return null;
      },
    };

    const lockManager = createReservationLockManager();
    const svc = reservationService({
      reservationModel: {
        ...reservationModelMock,
        withLock: lockManager.withLock,
      },
      tableModel: {},
      db: { collection: () => ({ insertOne: async () => ({}) }) },
    });

    // Cashier A accepts, Cashier B rejects concurrently
    const results = await Promise.allSettled([
      svc.accept(reservationDoc.ref, "cashier-A"),
      svc.reject(reservationDoc.ref, "cashier-B"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.status, 409);

    // MVCC version was incremented from 1 to 2
    assert.equal(reservationDoc.version, 2);
  });

  it("serializes concurrent check-in requests so only one succeeds", async () => {
    const reservationDoc = {
      _id: "res-200",
      ref: "RS-20261122-XYZ2",
      tableId: "507f1f77bcf86cd799439011",
      tableName: "Table 2",
      customerName: "Diana",
      customerEmail: "diana@example.com",
      contactNumber: "09194444444",
      startTime: new Date(Date.now() + 3600000),
      endTime: new Date(Date.now() + 7200000),
      durationMinutes: 60,
      status: "accepted",
      version: 2,
    };

    let sessionCreated = 0;
    const reservationModelMock = {
      async findByRef(ref) {
        return ref === reservationDoc.ref ? reservationDoc : null;
      },
      async claim(id, fromStatus, set) {
        if (id === reservationDoc._id && reservationDoc.status === fromStatus) {
          Object.assign(reservationDoc, set, { version: reservationDoc.version + 1 });
          return true;
        }
        return false;
      },
      async update(id, set) {
        if (id === reservationDoc._id) {
          Object.assign(reservationDoc, set, { version: reservationDoc.version + 1 });
          return { modifiedCount: 1 };
        }
        return null;
      },
    };

    const sessionServiceMock = {
      async start(input) {
        sessionCreated++;
        return {
          ok: true,
          session: {
            id: `session-${sessionCreated}`,
            tableId: input.tableId,
            endTime: new Date(Date.now() + 3600000).toISOString(),
          },
        };
      },
    };

    const lockManager = createReservationLockManager();
    const svc = reservationService({
      reservationModel: {
        ...reservationModelMock,
        withLock: lockManager.withLock,
      },
      tableModel: {},
      sessionService: sessionServiceMock,
      db: { collection: () => ({ insertOne: async () => ({}) }) },
    });

    const results = await Promise.allSettled([
      svc.checkIn(reservationDoc.ref, { id: "cashier-1" }),
      svc.checkIn(reservationDoc.ref, { id: "cashier-2" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(sessionCreated, 1);
    assert.equal(reservationDoc.status, "checked-in");
  });
});
