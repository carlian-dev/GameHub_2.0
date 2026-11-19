// Unit tests for optimistic concurrency on admin edits of a cashier account.
// The admin edit form sends the `version` from the row it opened; a stale
// version is a 409 and writes nothing, a missing one is a 428.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { cashierModel } from "../../src/models/cashier.model.js";
import { cashierService } from "../../src/services/cashier.service.js";

function matches(doc, filter = {}) {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === "$or") {
      if (!cond.some((sub) => matches(doc, sub))) return false;
      continue;
    }
    const actual = doc[key];
    if (cond && typeof cond === "object" && "$exists" in cond) {
      if ((actual !== undefined) !== cond.$exists) return false;
      continue;
    }
    if (String(actual) !== String(cond)) return false;
  }
  return true;
}

function fakeCollection(docs) {
  return {
    async findOne(filter = {}) {
      return docs.find((d) => matches(d, filter)) || null;
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set || {});
      for (const [field, by] of Object.entries(update.$inc || {})) {
        doc[field] = Number(doc[field] || 0) + by;
      }
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id };
    },
    find() {
      throw new Error("list() is not used by these tests");
    },
  };
}

function makeService(user) {
  const users = user ? [user] : [];
  const activityLogs = [];
  const collections = {
    users: fakeCollection(users),
    activityLogs: fakeCollection(activityLogs),
  };
  const db = { collection: (name) => collections[name] };
  return {
    service: cashierService({ cashierModel: cashierModel({ db }), db }),
    activityLogs,
  };
}

function seedCashier(overrides = {}) {
  return {
    _id: new ObjectId(),
    version: 1,
    username: "cashier1",
    email: "cashier1@example.com",
    passwordHash: "secret-hash",
    role: "cashier",
    status: "active",
    displayName: "Old Name",
    schedule: "",
    ...overrides,
  };
}

describe("cashierService.update (OCC)", () => {
  it("increments the version when the expected one matches", async () => {
    const user = seedCashier();
    const { service } = makeService(user);

    const result = await service.update(String(user._id), {
      displayName: "Updated Name",
      schedule: "09:00 - 17:00",
      version: 1,
    });

    assert.strictEqual(result.cashier.displayName, "Updated Name");
    assert.strictEqual(result.cashier.schedule, "09:00 - 17:00");
    assert.strictEqual(result.cashier.version, 2);
    assert.strictEqual(user.version, 2);
  });

  it("rejects a stale edit with 409 and leaves the row untouched", async () => {
    const user = seedCashier({ version: 3 });
    const { service, activityLogs } = makeService(user);

    await assert.rejects(
      service.update(String(user._id), {
        displayName: "Stale Name",
        version: 2,
      }),
      (err) =>
        err.status === 409 &&
        err.currentVersion === 3 &&
        /changed by someone else/.test(err.message)
    );

    assert.strictEqual(user.displayName, "Old Name");
    assert.strictEqual(user.version, 3);
    assert.strictEqual(activityLogs.length, 0);
  });

  it("requires a version", async () => {
    const user = seedCashier();
    const { service } = makeService(user);

    await assert.rejects(
      service.update(String(user._id), { displayName: "No Version" }),
      (err) => err.status === 428
    );
    assert.strictEqual(user.displayName, "Old Name");
  });

  it("validates the fields before the version precondition", async () => {
    const user = seedCashier();
    const { service } = makeService(user);

    await assert.rejects(
      service.update(String(user._id), { schedule: "not-a-time" }),
      (err) => err.status === 422
    );
    await assert.rejects(
      service.update(String(user._id), {}),
      (err) => err.status === 422
    );
  });

  it("archive bumps the version (status edits count too)", async () => {
    const user = seedCashier({ version: 5 });
    const { service, activityLogs } = makeService(user);

    const result = await service.archive(String(user._id), "admin-1");

    assert.deepStrictEqual(result, {
      ok: true,
      id: String(user._id),
      status: "archived",
    });
    assert.strictEqual(user.status, "archived");
    assert.strictEqual(user.version, 6);
    assert.strictEqual(activityLogs[0].action, "archive_cashier");
  });
});
