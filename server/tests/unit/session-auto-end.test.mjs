// Unit tests for session auto-end at 0:00.
// Regression: a session whose countdown reached zero used to stay "active"
// forever (and the timer counted up as overtime). It must close at endTime,
// free the table, and bill exactly the planned hours.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { sessionService } from "../../src/services/session.service.js";

function matches(doc, filter = {}) {
  for (const [key, cond] of Object.entries(filter)) {
    const value = doc[key];
    if (cond instanceof ObjectId || cond instanceof Date) {
      if (String(value) !== String(cond) && value?.getTime?.() !== cond.getTime()) return false;
      continue;
    }
    if (cond && typeof cond === "object") {
      if ("$type" in cond && cond.$type === "date" && !(value instanceof Date)) return false;
      if ("$lte" in cond && !(value instanceof Date && value.getTime() <= cond.$lte.getTime())) return false;
      if ("$in" in cond && !cond.$in.some((x) => String(x) === String(value))) return false;
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
        async toArray() { return rows.slice(); },
      };
      return cursor;
    },
    async findOne(filter = {}) {
      return docs.find((d) => matches(d, filter)) || null;
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id };
    },
  };
}

function makeService() {
  const sessions = [];
  const tables = [];
  const activityLogs = [];
  const collections = {
    sessions: fakeCollection(sessions),
    tables: fakeCollection(tables),
    users: fakeCollection([]),
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
    rateModel: {},
    db,
  });
  return { service, sessions, tables, activityLogs };
}

function seedSession(sessions, tables, { start, end, pricePerHour = 140 }) {
  const tableId = new ObjectId();
  tables.push({ _id: tableId, name: "Table 1", status: "occupied", archived: false });
  const doc = {
    _id: new ObjectId(),
    tableId,
    tableName: "Table 1",
    customerName: "Player",
    cashierId: "",
    cashierName: "cashier",
    startTime: start,
    endTime: end,
    plannedMinutes: Math.round((end - start) / 60000),
    status: "active",
    pricePerHour,
    rateType: "regular",
  };
  sessions.push(doc);
  return { doc, table: tables[0] };
}

describe("session auto-end", () => {
  it("closes at endTime, frees the table, and logs the system action", async () => {
    const { service, sessions, tables, activityLogs } = makeService();
    const end = new Date("2026-01-01T11:00:00Z");
    const { doc, table } = seedSession(sessions, tables, {
      start: new Date("2026-01-01T10:00:00Z"),
      end,
    });

    const result = await service.autoEndExpired(new Date("2026-01-01T11:00:01Z"));

    assert.deepEqual(result, { ok: true, closed: 1 });
    assert.equal(doc.status, "closed");
    assert.equal(doc.autoEnded, true);
    assert.equal(doc.closedAt.getTime(), end.getTime());
    assert.equal(table.status, "available");
    assert.equal(activityLogs[0].action, "session_auto_end");
  });

  it("leaves sessions with time remaining untouched", async () => {
    const { service, sessions, tables } = makeService();
    const { doc } = seedSession(sessions, tables, {
      start: new Date("2026-01-01T10:00:00Z"),
      end: new Date("2026-01-01T12:00:00Z"),
    });

    const result = await service.autoEndExpired(new Date("2026-01-01T11:00:00Z"));

    assert.equal(result.closed, 0);
    assert.equal(doc.status, "active");
  });

  it("list() sweeps expired sessions before returning active rows", async () => {
    const { service, sessions, tables } = makeService();
    seedSession(sessions, tables, {
      start: new Date("2026-01-01T10:00:00Z"),
      end: new Date("2026-01-01T11:00:00Z"),
    });

    const result = await service.list({ status: "active" });

    assert.deepEqual(result.sessions, []);
    assert.equal(sessions[0].status, "closed");
  });

  it("ending after 0:00 bills the planned hour, not the sweep delay", async () => {
    const { service, sessions, tables } = makeService();
    const end = new Date(Date.now() - 15000); // countdown hit zero 15s ago
    const { doc } = seedSession(sessions, tables, {
      start: new Date(end.getTime() - 3600000),
      end,
      pricePerHour: 140,
    });

    const result = await service.end(String(doc._id), {});

    assert.equal(result.amount, 140); // exactly 1 hour, not ceil(1h + 15s) = 2h
    assert.equal(result.billedHours, 1);
    assert.equal(doc.closedAt.getTime(), end.getTime());
  });

  it("refuses to extend a session whose time is up and closes it", async () => {
    const { service, sessions, tables } = makeService();
    const { doc, table } = seedSession(sessions, tables, {
      start: new Date(Date.now() - 3605000),
      end: new Date(Date.now() - 5000),
    });

    await assert.rejects(service.extend(String(doc._id), 60, null, {}), (err) => {
      assert.equal(err.status, 422);
      assert.match(err.message, /time is up/i);
      return true;
    });
    assert.equal(doc.status, "closed");
    assert.equal(table.status, "available");
  });
});
