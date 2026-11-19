// Unit tests for the cashier self-service profile update.
// Requirement: a cashier may change only their own display name/nickname.
// Email, username, role and password must never be writable through this path,
// and the audit log must record the old/new name.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { authService } from "../../src/services/auth.service.js";
import { userModel } from "../../src/models/user.model.js";

// Minimal Mongo filter matcher: _id equality, $or, plain fields, and
// `{ field: { $exists: boolean } }` — everything the OCC update uses.
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
    docs,
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
  };
}

function seedUser(overrides = {}) {
  return {
    _id: new ObjectId(),
    version: 1,
    username: "cashier1",
    email: "cashier1@example.com",
    passwordHash: "secret-hash",
    role: "cashier",
    status: "active",
    displayName: "Old Name",
    ...overrides,
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
    service: authService({ userModel: userModel({ db }), settingsModel: {}, db }),
    users,
    activityLogs,
  };
}

describe("authService.updateProfile", () => {
  it("trims and stores a cashier display name with an audit entry", async () => {
    const user = seedUser();
    const { service, activityLogs } = makeService(user);

    const result = await service.updateProfile(String(user._id), {
      displayName: "  Kuya J  ",
      version: 1,
    });

    assert.deepStrictEqual(result, {
      displayName: "Kuya J",
      avatarUrl: null,
      version: 2,
    });
    assert.strictEqual(user.displayName, "Kuya J");
    assert.strictEqual(user.version, 2);
    assert.strictEqual(activityLogs.length, 1);

    const log = activityLogs[0];
    assert.strictEqual(log.action, "profile_update");
    assert.strictEqual(log.actorId, String(user._id));
    assert.strictEqual(log.target, String(user._id));
    assert.deepStrictEqual(log.meta, {
      field: "displayName",
      oldValue: "Old Name",
      newValue: "Kuya J",
    });
  });

  it("ignores email, username, role and password in the payload", async () => {
    const user = seedUser();
    const { service } = makeService(user);

    await service.updateProfile(String(user._id), {
      displayName: "New Name",
      email: "attacker@example.com",
      username: "attacker",
      role: "admin",
      password: "hunter2",
      passwordHash: "overwritten",
      version: 1,
    });

    assert.strictEqual(user.displayName, "New Name");
    assert.strictEqual(user.version, 2);
    assert.strictEqual(user.email, "cashier1@example.com");
    assert.strictEqual(user.username, "cashier1");
    assert.strictEqual(user.role, "cashier");
    assert.strictEqual(user.passwordHash, "secret-hash");
  });

  it("rejects missing, non-string, or out-of-range names", async () => {
    const user = seedUser();
    const { service, activityLogs } = makeService(user);

    for (const payload of [
      { version: 1 },
      { displayName: "", version: 1 },
      { displayName: "   ", version: 1 },
      { displayName: "a", version: 1 },
      { displayName: "x".repeat(61), version: 1 },
      { displayName: { text: "Object" }, version: 1 },
      { displayName: 12345, version: 1 },
    ]) {
      await assert.rejects(
        service.updateProfile(String(user._id), payload),
        (err) => err.status === 422
      );
    }

    assert.strictEqual(user.displayName, "Old Name");
    assert.strictEqual(activityLogs.length, 0);
  });

  it("is a no-op (no audit entry) when the name is unchanged", async () => {
    const user = seedUser({ displayName: "Same Name" });
    const { service, activityLogs } = makeService(user);

    const result = await service.updateProfile(String(user._id), {
      displayName: "  Same Name  ",
      version: 99,
    });

    // No write, so a stale precondition cannot conflict; the current revision
    // comes back so the client can catch up.
    assert.deepStrictEqual(result, {
      displayName: "Same Name",
      avatarUrl: null,
      version: 1,
    });
    assert.strictEqual(user.version, 1);
    assert.strictEqual(activityLogs.length, 0);
  });

  it("allows admin and super_admin to update their profile", async () => {
    const admin = seedUser({ role: "admin", displayName: "Old Admin" });
    const superAdmin = seedUser({ role: "super_admin", displayName: "Old Super" });

    const adminRes = await makeService(admin).service.updateProfile(String(admin._id), {
      displayName: "New Admin",
      version: admin.version,
    });
    assert.strictEqual(adminRes.displayName, "New Admin");

    const superRes = await makeService(superAdmin).service.updateProfile(String(superAdmin._id), {
      displayName: "New Super",
      version: superAdmin.version,
    });
    assert.strictEqual(superRes.displayName, "New Super");
  });

  it("allows setting, updating and clearing profile picture (avatarUrl)", async () => {
    const user = seedUser();
    const { service, activityLogs } = makeService(user);
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const res1 = await service.updateProfile(String(user._id), {
      avatarUrl: dataUrl,
      version: user.version,
    });
    assert.strictEqual(res1.avatarUrl, dataUrl);
    assert.strictEqual(res1.version, 2);
    assert.strictEqual(user.avatarUrl, dataUrl);
    assert.strictEqual(activityLogs.length, 1);
    assert.strictEqual(activityLogs[0].meta.field, "avatarUrl");

    // Clear avatar, using the revision returned by the first save.
    const res2 = await service.updateProfile(String(user._id), {
      avatarUrl: null,
      version: res1.version,
    });
    assert.strictEqual(res2.avatarUrl, null);
    assert.strictEqual(res2.version, 3);
    assert.strictEqual(user.avatarUrl, null);
    assert.strictEqual(activityLogs.length, 2);
  });

  it("rejects invalid avatar image format", async () => {
    const user = seedUser();
    const { service } = makeService(user);

    await assert.rejects(
      service.updateProfile(String(user._id), {
        avatarUrl: "not-an-image",
        version: 1,
      }),
      (err) => err.status === 422
    );
  });

  it("rejects inactive accounts", async () => {
    const archived = seedUser({ status: "archived" });

    await assert.rejects(
      makeService(archived).service.updateProfile(String(archived._id), {
        displayName: "Nope",
        version: 1,
      }),
      (err) => err.status === 403
    );
  });

  it("rejects an unknown user id", async () => {
    const { service } = makeService(null);
    await assert.rejects(
      service.updateProfile(String(new ObjectId()), {
        displayName: "Ghost",
        version: 1,
      }),
      (err) => err.status === 401
    );
  });

  it("requires the last-read version for an actual edit", async () => {
    const user = seedUser();
    const { service, activityLogs } = makeService(user);

    await assert.rejects(
      service.updateProfile(String(user._id), { displayName: "No Version" }),
      (err) => err.status === 428 && /version is required/.test(err.message)
    );

    assert.strictEqual(user.displayName, "Old Name");
    assert.strictEqual(user.version, 1);
    assert.strictEqual(activityLogs.length, 0);
  });

  it("rejects a stale version with 409 and writes nothing", async () => {
    const user = seedUser({ version: 4 });
    const { service, activityLogs } = makeService(user);

    await assert.rejects(
      service.updateProfile(String(user._id), {
        displayName: "Stale Name",
        version: 3,
      }),
      (err) =>
        err.status === 409 &&
        err.currentVersion === 4 &&
        /changed by someone else/.test(err.message)
    );

    assert.strictEqual(user.displayName, "Old Name");
    assert.strictEqual(user.version, 4);
    assert.strictEqual(activityLogs.length, 0);
  });

  it("lets only the first of two editors win", async () => {
    const user = seedUser();
    const { service } = makeService(user);

    // Both tabs read version 1 before either saves.
    const first = await service.updateProfile(String(user._id), {
      displayName: "First Tab",
      version: 1,
    });
    assert.strictEqual(first.version, 2);

    await assert.rejects(
      service.updateProfile(String(user._id), {
        displayName: "Second Tab",
        version: 1,
      }),
      (err) => err.status === 409 && err.currentVersion === 2
    );

    assert.strictEqual(user.displayName, "First Tab");
    assert.strictEqual(user.version, 2);
  });

  it("treats a legacy document without version as version 1", async () => {
    const user = seedUser();
    delete user.version;
    const { service } = makeService(user);

    const result = await service.updateProfile(String(user._id), {
      displayName: "First Edit",
      version: 1,
    });

    assert.strictEqual(result.version, 2);
    assert.strictEqual(user.version, 2);
    assert.strictEqual(user.displayName, "First Edit");
  });
});
