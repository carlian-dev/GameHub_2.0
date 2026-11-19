// Rate limiting rules (express-rate-limit). Each test builds its own limiters
// with a tiny limit so nothing depends on wall-clock windows.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createRateLimiters, resolveRateLimitConfig } from "../../src/middleware/rateLimit.js";

const LIMITER_KEYS = [
  "api",
  "auth",
  "writes",
  "actions",
  "reservations",
  "staffLists",
  "reports",
  "exports",
  "audit",
  "notifications",
  "integrationChecks",
  "profileEdits",
  "health",
];

function config(overrides = {}) {
  const base = Object.fromEntries(
    LIMITER_KEYS.map((key) => [key, { windowMs: 60_000, limit: 100 }])
  );
  const merged = { enabled: true, ...base, ...overrides };
  for (const key of LIMITER_KEYS) {
    merged[key] = { ...base[key], ...(overrides[key] || {}) };
  }
  return merged;
}

// Minimal stand-in for the JWT middleware: `x-user-id` marks the request as
// signed in, everything else is anonymous (same shape the real middleware
// stores under req.authUser).
function testApp(limiters) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const id = req.get("x-user-id");
    req.authUser = id ? { id, role: "admin" } : null;
    next();
  });
  app.get("/read", limiters.api, (req, res) => res.json({ ok: true }));
  app.get("/write", limiters.writes, (req, res) => res.json({ ok: true }));
  app.post("/write", limiters.writes, (req, res) => res.json({ ok: true }));
  app.get("/action", limiters.actions, (req, res) => res.json({ ok: true }));
  app.post("/action", limiters.actions, (req, res) => res.json({ ok: true }));
  app.post("/other-action", limiters.actions, (req, res) => res.json({ ok: true }));
  app.post("/login", limiters.auth, (req, res) => {
    const failed = req.get("x-fail") === "1";
    res.status(failed ? 401 : 200).json({ ok: !failed });
  });
  app
    .route("/reservations")
    .post(limiters.reservations, (req, res) => res.json({ ok: true }));
  // One route per resource-heavy limiter so each budget can be asserted.
  app.get("/staff-list", limiters.staffLists, (req, res) => res.json({ ok: true }));
  app.get("/report", limiters.reports, (req, res) => res.json({ ok: true }));
  app.get("/export", limiters.exports, (req, res) => res.json({ ok: true }));
  app.get("/audit", limiters.audit, (req, res) => res.json({ ok: true }));
  app.post("/notify", limiters.notifications, (req, res) => res.json({ ok: true }));
  app.put("/integration", limiters.integrationChecks, (req, res) => res.json({ ok: true }));
  app.put("/profile", limiters.profileEdits, (req, res) => res.json({ ok: true }));
  app.get("/health", limiters.health, (req, res) => res.json({ ok: true }));
  return app;
}

describe("createRateLimiters", () => {
  it("returns the shared JSON error shape plus Retry-After", async () => {
    const app = testApp(createRateLimiters(config({ api: { limit: 2 } })));

    assert.equal((await request(app).get("/read")).status, 200);
    const second = await request(app).get("/read");
    assert.equal(second.status, 200);
    assert.match(String(second.headers.ratelimit), /limit=2/);

    const blocked = await request(app).get("/read");
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, {
      ok: false,
      error: "too many requests, please try again later",
    });
    assert.match(String(blocked.headers["retry-after"]), /^\d+$/);
  });

  it("keys signed-in traffic by user id, anonymous traffic by IP", async () => {
    const app = testApp(createRateLimiters(config({ api: { limit: 1 } })));

    // One request each for two different users: separate buckets.
    assert.equal((await request(app).get("/read").set("x-user-id", "u1")).status, 200);
    assert.equal((await request(app).get("/read").set("x-user-id", "u2")).status, 200);
    // Same user again: bucket is empty.
    assert.equal((await request(app).get("/read").set("x-user-id", "u1")).status, 429);

    // Anonymous requests share the loopback IP bucket.
    assert.equal((await request(app).get("/read")).status, 200);
    assert.equal((await request(app).get("/read")).status, 429);
  });

  it("counts only mutations on the writes limiter", async () => {
    const app = testApp(createRateLimiters(config({ writes: { limit: 1 } })));

    // Reads pass even after the write budget would be gone.
    assert.equal((await request(app).get("/write")).status, 200);
    assert.equal((await request(app).get("/write")).status, 200);
    assert.equal((await request(app).post("/write")).status, 200);
    assert.equal((await request(app).post("/write")).status, 429);
  });

  it("cools down repeated mutations without throttling reads", async () => {
    const app = testApp(createRateLimiters(config({ actions: { limit: 1 } })));

    // Reads never enter the per-action cooldown.
    assert.equal((await request(app).get("/action")).status, 200);
    assert.equal((await request(app).get("/action")).status, 200);

    // First mutation passes; an immediate repeat of the same action waits.
    assert.equal((await request(app).post("/action")).status, 200);
    const blocked = await request(app).post("/action");
    assert.equal(blocked.status, 429);
    assert.match(String(blocked.headers["retry-after"]), /^\d+$/);

    // Another route is a different action with its own fresh cooldown, and a
    // second user does not inherit the first user's countdown.
    assert.equal((await request(app).post("/other-action")).status, 200);
    assert.equal(
      (await request(app).post("/action").set("x-user-id", "u2")).status,
      200
    );
  });

  it("treats a different payload on the same route as a different action", async () => {
    const app = testApp(createRateLimiters(config({ actions: { limit: 1 } })));

    assert.equal(
      (await request(app).post("/action").send({ item: "coffee" })).status,
      200
    );
    // The same button (same method, path and payload) is on cooldown.
    assert.equal(
      (await request(app).post("/action").send({ item: "coffee" })).status,
      429
    );
    // A different item is a different action and gets its own slot.
    assert.equal(
      (await request(app).post("/action").send({ item: "juice" })).status,
      200
    );
  });

  it("does not count successful auth attempts", async () => {
    const app = testApp(createRateLimiters(config({ auth: { limit: 2 } })));

    // Successes are refunded on response finish, so they never exhaust it.
    for (let i = 0; i < 4; i += 1) {
      assert.equal((await request(app).post("/login")).status, 200);
    }
    const firstFailure = await request(app).post("/login").set("x-fail", "1");
    assert.equal(firstFailure.status, 401);
    assert.equal(firstFailure.headers["x-auth-attempts-remaining"], "1");
    const lastAllowedFailure = await request(app).post("/login").set("x-fail", "1");
    assert.equal(lastAllowedFailure.status, 401);
    assert.equal(lastAllowedFailure.headers["x-auth-attempts-remaining"], "0");
    assert.match(lastAllowedFailure.headers["retry-after"], /^\d+$/);
    const blocked = await request(app).post("/login").set("x-fail", "1");
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers["x-auth-attempts-remaining"], "0");
  });

  it("uses the same IP bucket across users and updates limits without clearing counts", async () => {
    const limiters = createRateLimiters(config({ auth: { limit: 3, windowMs: 60_000 } }));
    const app = testApp(limiters);

    assert.equal(
      (await request(app).post("/login").set("x-user-id", "u1").set("x-fail", "1")).status,
      401
    );
    limiters.configureAuth({ limit: 1, windowMs: 1000 });

    const blocked = await request(app)
      .post("/login")
      .set("x-user-id", "u2")
      .set("x-fail", "1");
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers["x-auth-attempts-limit"], "1");
    assert.match(blocked.headers["retry-after"], /^\d+$/);
  });

  it("throttles anonymous guest reservations but lets signed-in staff through", async () => {
    const app = testApp(createRateLimiters(config({ reservations: { limit: 1 } })));

    assert.equal((await request(app).post("/reservations")).status, 200);
    assert.equal((await request(app).post("/reservations")).status, 429);
    // Staff reference lookups are not part of the guest brute-force surface.
    assert.equal(
      (await request(app).post("/reservations").set("x-user-id", "cashier-1")).status,
      200
    );
  });

  it("gives each expensive read its own per-user budget", async () => {
    const app = testApp(
      createRateLimiters(
        config({
          staffLists: { limit: 1 },
          reports: { limit: 1 },
          exports: { limit: 1 },
          audit: { limit: 1 },
        })
      )
    );

    for (const path of ["/staff-list", "/report", "/export", "/audit"]) {
      assert.equal(
        (await request(app).get(path).set("x-user-id", "u1")).status,
        200
      );
      assert.equal(
        (await request(app).get(path).set("x-user-id", "u1")).status,
        429
      );
      // Another user has a fresh bucket, and exhausting one read type must
      // not spend the budget of the other three.
      assert.equal(
        (await request(app).get(path).set("x-user-id", "u2")).status,
        200
      );
    }
  });

  it("throttles notification, integration-check and profile writes per user", async () => {
    const app = testApp(
      createRateLimiters(
        config({
          notifications: { limit: 1 },
          integrationChecks: { limit: 1 },
          profileEdits: { limit: 1 },
        })
      )
    );

    for (const [method, path] of [
      ["post", "/notify"],
      ["put", "/integration"],
      ["put", "/profile"],
    ]) {
      assert.equal(
        (await request(app)[method](path).set("x-user-id", "u1")).status,
        200
      );
      assert.equal(
        (await request(app)[method](path).set("x-user-id", "u1")).status,
        429
      );
      assert.equal(
        (await request(app)[method](path).set("x-user-id", "u2")).status,
        200
      );
    }
  });

  it("throttles the public health probe by IP", async () => {
    const app = testApp(createRateLimiters(config({ health: { limit: 1 } })));

    assert.equal((await request(app).get("/health")).status, 200);
    assert.equal((await request(app).get("/health")).status, 429);
  });

  it("is a pass-through when disabled", async () => {
    const app = testApp(createRateLimiters(config({ enabled: false, api: { limit: 1 } })));

    for (const path of ["/read", "/staff-list", "/report", "/export", "/audit", "/health"]) {
      assert.equal((await request(app).get(path)).status, 200);
    }
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await request(app).get("/read")).status, 200);
    }
    assert.equal((await request(app).post("/write")).status, 200);
    assert.equal((await request(app).post("/write")).status, 200);
    assert.equal((await request(app).post("/action")).status, 200);
    assert.equal((await request(app).post("/action")).status, 200);
    assert.equal((await request(app).post("/login").set("x-fail", "1")).status, 401);
  });
});

describe("resolveRateLimitConfig", () => {
  it("falls back to defaults for invalid or non-positive numbers", () => {
    const cfg = resolveRateLimitConfig({
      RATE_LIMIT_ENABLED: true,
      RATE_LIMIT_WINDOW_MS: "not-a-number",
      RATE_LIMIT_MAX: "-5",
      AUTH_RATE_LIMIT_WINDOW_MS: "0",
      AUTH_RATE_LIMIT_MAX: "0",
      WRITE_RATE_LIMIT_MAX: "",
      ACTION_RATE_LIMIT_WINDOW_MS: "0",
      ACTION_RATE_LIMIT_MAX: "-1",
      RESERVATION_RATE_LIMIT_WINDOW_MS: "0",
      RESERVATION_RATE_LIMIT_MAX: "0",
      STAFF_LIST_RATE_LIMIT_WINDOW_MS: "0",
      STAFF_LIST_RATE_LIMIT_MAX: "-1",
      REPORT_RATE_LIMIT_WINDOW_MS: "nope",
      REPORT_RATE_LIMIT_MAX: "",
      EXPORT_RATE_LIMIT_WINDOW_MS: "0",
      EXPORT_RATE_LIMIT_MAX: "0",
      AUDIT_RATE_LIMIT_WINDOW_MS: "0",
      AUDIT_RATE_LIMIT_MAX: "0",
      NOTIFICATION_RATE_LIMIT_WINDOW_MS: "0",
      NOTIFICATION_RATE_LIMIT_MAX: "0",
      INTEGRATION_RATE_LIMIT_WINDOW_MS: "0",
      INTEGRATION_RATE_LIMIT_MAX: "0",
      PROFILE_RATE_LIMIT_WINDOW_MS: "0",
      PROFILE_RATE_LIMIT_MAX: "0",
      HEALTH_RATE_LIMIT_WINDOW_MS: "0",
      HEALTH_RATE_LIMIT_MAX: "0",
    });

    assert.equal(cfg.enabled, true);
    assert.equal(cfg.api.windowMs, 60_000);
    assert.equal(cfg.api.limit, 300);
    assert.equal(cfg.auth.windowMs, 15 * 60 * 1000);
    assert.equal(cfg.auth.limit, 10);
    assert.equal(cfg.writes.limit, 60);
    assert.deepEqual(cfg.actions, { windowMs: 1000, limit: 1 });
    assert.equal(cfg.reservations.windowMs, 10 * 60 * 1000);
    assert.equal(cfg.reservations.limit, 10);
    assert.deepEqual(cfg.staffLists, { windowMs: 60_000, limit: 60 });
    assert.deepEqual(cfg.reports, { windowMs: 60_000, limit: 20 });
    assert.deepEqual(cfg.exports, { windowMs: 10 * 60 * 1000, limit: 5 });
    assert.deepEqual(cfg.audit, { windowMs: 60_000, limit: 20 });
    assert.deepEqual(cfg.notifications, {
      windowMs: 10 * 60 * 1000,
      limit: 10,
    });
    assert.deepEqual(cfg.integrationChecks, {
      windowMs: 15 * 60 * 1000,
      limit: 10,
    });
    assert.deepEqual(cfg.profileEdits, { windowMs: 60_000, limit: 5 });
    assert.deepEqual(cfg.health, { windowMs: 60_000, limit: 30 });
  });

  it("accepts explicit env values", () => {
    const cfg = resolveRateLimitConfig({
      RATE_LIMIT_ENABLED: "0",
      RATE_LIMIT_WINDOW_MS: "5000",
      RATE_LIMIT_MAX: "42",
      AUTH_RATE_LIMIT_WINDOW_MS: "9000",
      AUTH_RATE_LIMIT_MAX: "7",
      WRITE_RATE_LIMIT_MAX: "12",
      ACTION_RATE_LIMIT_WINDOW_MS: "1500",
      ACTION_RATE_LIMIT_MAX: "2",
      RESERVATION_RATE_LIMIT_WINDOW_MS: "7000",
      RESERVATION_RATE_LIMIT_MAX: "3",
      STAFF_LIST_RATE_LIMIT_WINDOW_MS: "3000",
      STAFF_LIST_RATE_LIMIT_MAX: "9",
      REPORT_RATE_LIMIT_WINDOW_MS: "4000",
      REPORT_RATE_LIMIT_MAX: "8",
      EXPORT_RATE_LIMIT_WINDOW_MS: "5000",
      EXPORT_RATE_LIMIT_MAX: "7",
      AUDIT_RATE_LIMIT_WINDOW_MS: "6000",
      AUDIT_RATE_LIMIT_MAX: "6",
      NOTIFICATION_RATE_LIMIT_WINDOW_MS: "7000",
      NOTIFICATION_RATE_LIMIT_MAX: "5",
      INTEGRATION_RATE_LIMIT_WINDOW_MS: "8000",
      INTEGRATION_RATE_LIMIT_MAX: "4",
      PROFILE_RATE_LIMIT_WINDOW_MS: "9000",
      PROFILE_RATE_LIMIT_MAX: "3",
      HEALTH_RATE_LIMIT_WINDOW_MS: "10000",
      HEALTH_RATE_LIMIT_MAX: "2",
    });

    assert.equal(cfg.enabled, false);
    assert.deepEqual(cfg.api, { windowMs: 5000, limit: 42 });
    assert.deepEqual(cfg.auth, { windowMs: 9000, limit: 7 });
    assert.deepEqual(cfg.writes, { windowMs: 5000, limit: 12 });
    assert.deepEqual(cfg.actions, { windowMs: 1500, limit: 2 });
    assert.deepEqual(cfg.reservations, { windowMs: 7000, limit: 3 });
    assert.deepEqual(cfg.staffLists, { windowMs: 3000, limit: 9 });
    assert.deepEqual(cfg.reports, { windowMs: 4000, limit: 8 });
    assert.deepEqual(cfg.exports, { windowMs: 5000, limit: 7 });
    assert.deepEqual(cfg.audit, { windowMs: 6000, limit: 6 });
    assert.deepEqual(cfg.notifications, { windowMs: 7000, limit: 5 });
    assert.deepEqual(cfg.integrationChecks, { windowMs: 8000, limit: 4 });
    assert.deepEqual(cfg.profileEdits, { windowMs: 9000, limit: 3 });
    assert.deepEqual(cfg.health, { windowMs: 10000, limit: 2 });
  });
});
