// Unit tests: a reservation check-in session occupies the table, and the
// reservation follows the session lifecycle (end -> completed, void -> accepted).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { sessionService } from "../../src/services/session.service.js";

function matches(doc, filter = {}) {
  for (const [key, cond] of Object.entries(filter)) {
    const value = doc[key];
    if (cond instanceof ObjectId) {
      if (String(value) !== String(cond)) return false;
      continue;
    }
    if (cond && typeof cond === "object") {
      if ("$type" in cond && cond.$type === "date" && !(value instanceof Date)) return false;
      if ("$lte" in cond && !(value instanceof Date && value.getTime() <= cond.$lte.getTime())) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function fakeCollection(docs) {
  return {
    docs,
    find(filter = {}) {
      let rows = docs.filter((d) => matches(d, filter));
      const cursor = {
        project: () => cursor,
        sort: () => cursor,
        limit: () => cursor,
        async toArray() {
          return rows.slice();
        },
      };
      return cursor;
    },
    async findOne(filter = {}) {
      return docs.find((d) => matches(d, filter)) || null;
    },
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id };
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$unset) {
        for (const key of Object.keys(update.$unset)) delete doc[key];
      }
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
}

function makeService() {
  const sessions = [];
  const tables = [];
  const reservations = [];
  const activityLogs = [];
  const collections = {
    sessions: fakeCollection(sessions),
    tables: fakeCollection(tables),
    users: fakeCollection([]),
    reservations: fakeCollection(reservations),
    activityLogs: fakeCollection(activityLogs),
  };
  const db = { collection: (name) => collections[name] };
  const sessionModel = {
    async findById(id) {
      return sessions.find((s) => String(s._id) === String(id)) || null;
    },
    async list(filter) {
      return sessions.filter((s) => matches(s, filter));
    },
    async insert(doc) {
      const _id = new ObjectId();
      sessions.push({ _id, ...doc });
      return _id;
    },
    async update(id, set) {
      const doc = sessions.find((s) => String(s._id) === String(id));
      if (!doc) return null;
      Object.assign(doc, set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const service = sessionService({
    sessionModel,
    tableModel: {},
    userModel: {},
    rateModel: { async findByType() { return { pricePerHour: 140 }; } },
    db,
  });
  return { service, sessions, tables, reservations, activityLogs };
}

function seedTable(tables, status = "reserved") {
  const table = {
    _id: new ObjectId(),
    name: "Table 3",
    status,
    archived: false,
  };
  tables.push(table);
  return table;
}

describe("session started from a reservation", () => {
  it("occupies a table flagged reserved and completes the booking when it ends", async () => {
    const { service, tables, reservations, sessions } = makeService();
    const table = seedTable(tables);
    reservations.push({ ref: "RS-20261118-ABCD", status: "checked-in" });

    const started = await service.start(
      {
        tableId: String(table._id),
        customerName: "Maria Cruz",
        durationMinutes: 120,
        reservationRef: "RS-20261118-ABCD",
      },
      {}
    );

    assert.equal(started.session.reservationRef, "RS-20261118-ABCD");
    assert.equal(started.session.tableId, String(table._id));
    assert.equal(table.status, "occupied");

    await service.end(started.session.id, {});

    assert.equal(sessions[0].status, "closed");
    assert.equal(table.status, "available");
    assert.equal(reservations[0].status, "completed");
    assert.ok(reservations[0].completedAt);
  });

  it("returns the booking to accepted when the session is voided", async () => {
    const { service, tables, reservations } = makeService();
    const table = seedTable(tables, "available");
    reservations.push({
      ref: "RS-20261118-ABCD",
      status: "checked-in",
      checkedInAt: new Date(),
      sessionId: "session-1",
      sessionEndsAt: new Date(Date.now() + 3600000),
    });

    const started = await service.start(
      {
        tableId: String(table._id),
        customerName: "Maria Cruz",
        durationMinutes: 60,
        reservationRef: "RS-20261118-ABCD",
      },
      {}
    );
    await service.cancel(started.session.id, {});

    assert.equal(table.status, "available");
    assert.equal(reservations[0].status, "accepted");
    assert.equal(reservations[0].sessionId, undefined);
    assert.equal(reservations[0].checkedInAt, undefined);
  });

  it("keeps the reservation occupancy window in sync when extended", async () => {
    const { service, tables, reservations } = makeService();
    const table = seedTable(tables, "available");
    reservations.push({ ref: "RS-20261118-ABCD", status: "checked-in" });

    const started = await service.start(
      {
        tableId: String(table._id),
        customerName: "Maria Cruz",
        durationMinutes: 60,
        reservationRef: "RS-20261118-ABCD",
      },
      {}
    );
    const extended = await service.extend(started.session.id, 60, null, {});

    assert.equal(
      reservations[0].sessionEndsAt.getTime(),
      new Date(extended.session.endTime).getTime()
    );
  });

  it("completes the booking when the countdown reaches zero", async () => {
    const { service, tables, reservations, sessions } = makeService();
    const table = seedTable(tables, "available");
    reservations.push({ ref: "RS-20261118-ABCD", status: "checked-in" });

    await service.start(
      {
        tableId: String(table._id),
        customerName: "Maria Cruz",
        durationMinutes: 60,
        reservationRef: "RS-20261118-ABCD",
      },
      {}
    );
    const after = new Date(Date.now() + 61 * 60 * 1000);
    const result = await service.autoEndExpired(after);

    assert.equal(result.closed, 1);
    assert.equal(table.status, "available");
    assert.equal(reservations[0].status, "completed");
    assert.equal(reservations[0].completedAt.getTime(), sessions[0].endTime.getTime());
  });
});
