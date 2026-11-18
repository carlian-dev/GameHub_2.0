// Rate limiting rules (express-rate-limit). Each test builds its own limiters
// with a tiny limit so nothing depends on wall-clock windows.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createRateLimiters, resolveRateLimitConfig } from "../../src/middleware/rateLimit.js";

function config(overrides = {}) {
  const base = {
    enabled: true,
    api: { windowMs: 60_000, limit: 100 },
    auth: { windowMs: 60_000, limit: 100 },
    writes: { windowMs: 60_000, limit: 100 },
    reservations: { windowMs: 60_000, limit: 100 },
  };
  return {
    ...base,
    ...overrides,
    api: { ...base.api, ...(overrides.api || {}) },
    auth: { ...base.auth, ...(overrides.auth || {}) },
    writes: { ...base.writes, ...(overrides.writes || {}) },
    reservations: { ...base.reservations, ...(overrides.reservations || {}) },
  };
}

// Minimal stand-in for the JWT middleware: `x-user-id` marks the request as
// signed in, everything else is anonymous (same shape the real middleware
// stores under req.authUser).
function testApp(limiters) {
  const app = express();
  app.use((req, res, next) => {
    const id = req.get("x-user-id");
    req.authUser = id ? { id, role: "admin" } : null;
    next();
  });
  app.get("/read", limiters.api, (req, res) => res.json({ ok: true }));
  app.get("/write", limiters.writes, (req, res) => res.json({ ok: true }));
  app.post("/write", limiters.writes, (req, res) => res.json({ ok: true }));
  app.post("/login", limiters.auth, (req, res) => {
    const failed = req.get("x-fail") === "1";
    res.status(failed ? 401 : 200).json({ ok: !failed });
  });
  app
    .route("/reservations")
    .post(limiters.reservations, (req, res) => res.json({ ok: true }));
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

  it("is a pass-through when disabled", async () => {
    const app = testApp(createRateLimiters(config({ enabled: false, api: { limit: 1 } })));

    for (let i = 0; i < 5; i += 1) {
      assert.equal((await request(app).get("/read")).status, 200);
    }
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
      RESERVATION_RATE_LIMIT_WINDOW_MS: "0",
      RESERVATION_RATE_LIMIT_MAX: "0",
    });

    assert.equal(cfg.enabled, true);
    assert.equal(cfg.api.windowMs, 60_000);
    assert.equal(cfg.api.limit, 300);
    assert.equal(cfg.auth.windowMs, 15 * 60 * 1000);
    assert.equal(cfg.auth.limit, 10);
    assert.equal(cfg.writes.limit, 60);
    assert.equal(cfg.reservations.windowMs, 10 * 60 * 1000);
    assert.equal(cfg.reservations.limit, 10);
  });

  it("accepts explicit env values", () => {
    const cfg = resolveRateLimitConfig({
      RATE_LIMIT_ENABLED: "0",
      RATE_LIMIT_WINDOW_MS: "5000",
      RATE_LIMIT_MAX: "42",
      AUTH_RATE_LIMIT_WINDOW_MS: "9000",
      AUTH_RATE_LIMIT_MAX: "7",
      WRITE_RATE_LIMIT_MAX: "12",
      RESERVATION_RATE_LIMIT_WINDOW_MS: "7000",
      RESERVATION_RATE_LIMIT_MAX: "3",
    });

    assert.equal(cfg.enabled, false);
    assert.deepEqual(cfg.api, { windowMs: 5000, limit: 42 });
    assert.deepEqual(cfg.auth, { windowMs: 9000, limit: 7 });
    assert.deepEqual(cfg.writes, { windowMs: 5000, limit: 12 });
    assert.deepEqual(cfg.reservations, { windowMs: 7000, limit: 3 });
  });
});
