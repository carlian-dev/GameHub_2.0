// Unit tests for the admin activity-log service.
// Covers actor/target name shaping, Manila calendar-day filters, and limits.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activityService } from "../../src/services/activity.service.js";
import { activityController } from "../../src/controllers/index.js";

function harness({ docs = [], users = [] } = {}) {
  const calls = { list: [], findIds: [] };
  const service = activityService({
    activityModel: {
      async list(filter, opts) {
        calls.list.push({ filter, opts });
        return docs;
      },
      async count() {
        return docs.length;
      },
    },
    userModel: {
      async findByIds(ids) {
        calls.findIds.push(ids);
        return users;
      },
    },
  });
  return { service, calls };
}

describe("activityService.list", () => {
  it("shapes a password sign-in with actor identity and provider", async () => {
    const at = new Date("2026-11-05T08:25:58.226Z");
    const { service, calls } = harness({
      docs: [
        {
          _id: "log1",
          actorId: "u1",
          action: "login",
          target: "u1",
          at,
          meta: {
            role: "cashier",
            provider: "password",
            username: "cashier1",
            email: null,
          },
        },
      ],
      users: [{ _id: "u1", username: "cashier1", role: "cashier" }],
    });

    const result = await service.list({});

    assert.equal(result.total, 1);
    assert.deepEqual(calls.findIds[0], ["u1"]);
    const log = result.logs[0];
    assert.equal(log.id, "log1");
    assert.equal(log.action, "login");
    assert.equal(log.actorName, "cashier1");
    assert.equal(log.actorUsername, "cashier1");
    assert.equal(log.actorRole, "cashier");
    assert.equal(log.targetName, "cashier1");
    assert.equal(log.at, at.toISOString());
    assert.equal(log.meta.provider, "password");
  });

  it("labels missing and system actors", async () => {
    const { service } = harness({
      docs: [
        { _id: "a", actorId: null, action: "reservation_create", target: "RS-1", at: new Date() },
        { _id: "b", actorId: "system", action: "session_auto_end", target: "s1", at: new Date() },
      ],
    });

    const result = await service.list({});

    assert.equal(result.logs[0].actorName, "Guest");
    assert.equal(result.logs[1].actorName, "System");
  });

  it("uses Manila calendar days for from/to", async () => {
    const { service, calls } = harness();

    await service.list({ from: "2026-11-05", to: "2026-11-05" });

    const { at } = calls.list[0].filter;
    assert.equal(at.$gte.toISOString(), "2026-11-04T16:00:00.000Z");
    assert.equal(at.$lt.toISOString(), "2026-11-05T16:00:00.000Z");
  });

  it("rejects impossible or reversed dates with 422", async () => {
    const { service } = harness();

    await assert.rejects(
      () => service.list({ from: "2026-02-30" }),
      (err) => err.status === 422 && /valid date/.test(err.message)
    );
    await assert.rejects(
      () => service.list({ from: "2026-11-06", to: "2026-11-05" }),
      (err) => err.status === 422 && /on or before/.test(err.message)
    );
  });

  it("clamps the page limit to 1..500 and defaults to 200", async () => {
    const { service, calls } = harness();

    await service.list({ limit: "9999" });
    await service.list({ limit: 0 });
    await service.list({ limit: "not-a-number" });

    assert.equal(calls.list[0].opts.limit, 500);
    assert.equal(calls.list[1].opts.limit, 1);
    assert.equal(calls.list[2].opts.limit, 200);
  });

  it("maps guest/system actor filters to the stored shapes", async () => {
    const { service, calls } = harness();

    await service.list({ actorId: "guest" });
    await service.list({ actorId: "system" });
    await service.list({ actorId: "u1" });

    assert.ok(Array.isArray(calls.list[0].filter.$or));
    assert.equal(calls.list[1].filter.actorId, "system");
    assert.equal(calls.list[2].filter.actorId, "u1");
  });
});

describe("activityController", () => {
  it("rejects unauthenticated or non-admin in list()", async () => {
    const ctrl = activityController({
      activityService: { async list() { return { logs: [], total: 0 }; } },
    });
    await assert.rejects(
      () => new Promise((_, reject) => ctrl.list({ authUser: null }, {}, reject)),
      (err) => err.status === 401
    );
    await assert.rejects(
      () =>
        new Promise((_, reject) =>
          ctrl.list(
            { authUser: { id: "u1", role: "cashier" } },
            {},
            reject
          )
        ),
      (err) => err.status === 401
    );
  });

  it("allows any logged-in user in myList() and enforces user id", async () => {
    let capturedFilter = null;
    const ctrl = activityController({
      activityService: {
        async list(filter) {
          capturedFilter = filter;
          return { logs: [{ id: "l1" }], total: 1, limit: 200 };
        },
      },
    });

    // Unauthenticated -> 401
    await assert.rejects(
      () => new Promise((_, reject) => ctrl.myList({ authUser: null }, {}, reject)),
      (err) => err.status === 401
    );

    // Cashier with spoofed actorId in query
    let sentJson = null;
    let sentStatus = null;
    const res = {
      status(code) {
        sentStatus = code;
        return this;
      },
      json(data) {
        sentJson = data;
      },
    };
    await ctrl.myList(
      {
        authUser: { id: "cashier-123", role: "cashier" },
        query: { actorId: "admin-456", action: "login" },
      },
      res,
      (err) => {
        if (err) throw err;
      }
    );

    assert.equal(sentStatus, 200);
    assert.equal(sentJson.ok, true);
    assert.equal(capturedFilter.actorId, "cashier-123");
    assert.equal(capturedFilter.action, "login");
  });
});
