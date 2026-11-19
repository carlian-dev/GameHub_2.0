// Unit tests for the super-admin feature access matrix (RBAC).
// The matrix has one row per feature and one switch per applicable role, so
// coverage checks defaults per cell, per-role updates, and the API path map.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FEATURES,
  featureAccessService,
  featureForRequest,
} from "../../src/services/featureAccess.service.js";

/** Apply Mongo-style dotted $set keys to a plain object. */
function applyDotted(target, set) {
  for (const [key, value] of Object.entries(set || {})) {
    const parts = key.split(".");
    let obj = target;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]] || typeof obj[parts[i]] !== "object") obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
  }
}

function fakeStore(initialDoc = null) {
  const state = { doc: initialDoc, logs: [] };
  const db = {
    collection(name) {
      if (name === "settings") {
        return {
          async updateOne(filter, update, options) {
            if (!state.doc) state.doc = { key: filter.key };
            if (options && options.upsert) state.doc.key = filter.key;
            applyDotted(state.doc, update.$set);
          },
        };
      }
      if (name === "activityLogs") {
        return {
          async insertOne(entry) {
            state.logs.push(entry);
          },
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
  const settingsModel = {
    async findOne(key) {
      return key === "featureAccess" ? state.doc : null;
    },
  };
  return { state, db, settingsModel };
}

function serviceFor(initialDoc = null) {
  const store = fakeStore(initialDoc);
  const service = featureAccessService({
    settingsModel: store.settingsModel,
    db: store.db,
  });
  return { service, store };
}

const superAdmin = { id: "u1", email: "root@example.com", role: "super_admin" };

describe("featureAccess matrix defaults", () => {
  it("turns every applicable cell on when no document exists", async () => {
    const { service } = serviceFor(null);
    const snapshot = await service.snapshot();
    assert.equal(snapshot.features.length, FEATURES.length);
    for (const feature of snapshot.features) {
      assert.ok(feature.roles.length > 0);
      for (const role of feature.roles) {
        assert.equal(feature.access[role], true);
      }
    }
    assert.equal(snapshot.updatedAt, null);
  });

  it("keeps a feature out of a role that does not have it", async () => {
    const { service } = serviceFor(null);
    const snapshot = await service.snapshot();
    const staff = snapshot.features.find((f) => f.key === "staff");
    assert.deepEqual(staff.roles, ["admin"]);
    assert.equal(staff.access.cashier, undefined);
    const reservations = snapshot.features.find((f) => f.key === "reservations");
    assert.deepEqual(reservations.roles, ["cashier"]);
    assert.equal(reservations.access.admin, undefined);
  });

  it("honours stored per-role cells and ignores unknown ones", async () => {
    const { service } = serviceFor({
      key: "featureAccess",
      features: {
        menu: { cashier: false, owner: false },
        staff: { admin: false },
      },
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      updatedBy: "root@example.com",
    });
    const snapshot = await service.snapshot();
    const menu = snapshot.features.find((f) => f.key === "menu");
    assert.equal(menu.access.admin, true);
    assert.equal(menu.access.cashier, false);
    const staff = snapshot.features.find((f) => f.key === "staff");
    assert.equal(staff.access.admin, false);
    assert.equal(snapshot.updatedBy, "root@example.com");
  });

  it("lists only the enabled features for one role", async () => {
    const { service } = serviceFor({
      key: "featureAccess",
      features: { menu: { cashier: false }, tables: { admin: false } },
    });
    const cashier = await service.enabledFor("cashier");
    assert.ok(cashier.includes("sessions"));
    assert.ok(cashier.includes("tables"));
    assert.ok(!cashier.includes("menu"));
    assert.ok(!cashier.includes("staff"));

    const admin = await service.enabledFor("admin");
    assert.ok(admin.includes("menu"));
    assert.ok(!admin.includes("tables"));
    assert.ok(!admin.includes("reservations"));
    assert.deepEqual(await service.enabledFor("super_admin"), []);
  });
});

describe("featureAccess update", () => {
  it("rejects non-super-admin actors", async () => {
    const { service } = serviceFor(null);
    await assert.rejects(
      () => service.update({ features: { "staff.admin": false } }, { role: "admin" }),
      (err) => err.status === 403
    );
  });

  it("rejects unknown features, wrong roles and non-boolean values", async () => {
    const { service, store } = serviceFor(null);
    await assert.rejects(
      () => service.update({ features: { "nope.admin": false } }, superAdmin),
      (err) => err.status === 422
    );
    await assert.rejects(
      () => service.update({ features: { "staff.cashier": false } }, superAdmin),
      (err) => err.status === 422
    );
    await assert.rejects(
      () => service.update({ features: { "menu.cashier": "off" } }, superAdmin),
      (err) => err.status === 422
    );
    await assert.rejects(
      () => service.update({ features: {} }, superAdmin),
      (err) => err.status === 422
    );
    assert.equal(store.state.doc, null);
    assert.equal(store.state.logs.length, 0);
  });

  it("stores one cell, audits it and refreshes the cache immediately", async () => {
    const { service, store } = serviceFor(null);
    const snapshot = await service.update(
      { features: { "menu.cashier": false } },
      superAdmin
    );
    const menu = snapshot.features.find((f) => f.key === "menu");
    assert.equal(menu.access.cashier, false);
    assert.equal(menu.access.admin, true);

    // `features.menu.cashier` is stored nested by Mongo.
    assert.equal(store.state.doc.features.menu.cashier, false);
    assert.equal(store.state.logs.length, 1);
    assert.equal(store.state.logs[0].action, "feature_access_update");
    assert.equal(store.state.logs[0].actorId, "u1");
    assert.deepEqual(store.state.logs[0].meta.changed, { "menu.cashier": false });

    assert.equal(await service.isEnabled("menu", "cashier"), false);
    assert.equal(await service.isEnabled("menu", "admin"), true);
    const cashier = await service.enabledFor("cashier");
    assert.ok(!cashier.includes("menu"));
    assert.ok((await service.enabledFor("admin")).includes("menu"));
  });

  it("treats a role the feature does not apply to as enabled", async () => {
    const { service } = serviceFor(null);
    assert.equal(await service.isEnabled("staff", "cashier"), true);
    assert.equal(await service.isEnabled("reservations", "admin"), true);
  });
});

describe("featureForRequest", () => {
  it("maps admin paths to their matrix row", () => {
    assert.equal(
      featureForRequest("admin", "GET", "/admin/cashiers/abc/archive"),
      "staff"
    );
    assert.equal(featureForRequest("admin", "GET", "/admin/tables"), "tables");
    assert.equal(featureForRequest("admin", "GET", "/admin/rates"), "tables");
    assert.equal(featureForRequest("admin", "GET", "/admin/sessions"), "sessions");
    assert.equal(featureForRequest("admin", "GET", "/admin/products"), "menu");
    assert.equal(
      featureForRequest("admin", "GET", "/admin/reports/daily"),
      "transactions"
    );
    assert.equal(
      featureForRequest("admin", "GET", "/admin/activity-logs"),
      "activity"
    );
  });

  it("maps cashier paths to their matrix row", () => {
    assert.equal(
      featureForRequest("cashier", "POST", "/cashier/sessions/abc/orders"),
      "sessions"
    );
    assert.equal(
      featureForRequest("cashier", "GET", "/cashier/sessions/abc/bill"),
      "sessions"
    );
    assert.equal(
      featureForRequest("cashier", "GET", "/cashier/products"),
      "menu"
    );
    assert.equal(featureForRequest("cashier", "GET", "/cashier/tables"), "tables");
  });

  it("gates only the cashier reservation list, not guest lookups", () => {
    assert.equal(
      featureForRequest("cashier", "GET", "/reservations"),
      "reservations"
    );
    assert.equal(
      featureForRequest("cashier", "GET", "/reservations/"),
      "reservations"
    );
    assert.equal(
      featureForRequest("cashier", "POST", "/cashier/reservations/AB12/accept"),
      "reservations"
    );
    assert.equal(featureForRequest("cashier", "GET", "/reservations/AB12"), null);
    assert.equal(featureForRequest("cashier", "POST", "/reservations"), null);
  });

  it("never hands a role another column's endpoints", () => {
    assert.equal(featureForRequest("cashier", "GET", "/admin/products"), null);
    assert.equal(featureForRequest("admin", "GET", "/cashier/products"), null);
    assert.equal(featureForRequest("admin", "GET", "/cashier/sessions"), null);
    assert.equal(featureForRequest("cashier", "GET", "/admin/cashiers"), null);
    assert.equal(featureForRequest("super_admin", "GET", "/admin/cashiers"), null);
  });
});
