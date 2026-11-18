// Unit tests for the super-admin route scope and sign-in.
// The role is intentionally least-privilege: it may only manage integrations,
// so operational admin/cashier routes must be rejected before a controller
// that merely checks for a login sees the request.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { superAdminScope } from "../../src/middleware/auth.js";
import { authService } from "../../src/services/auth.service.js";

function scope({ role, method = "GET", path }) {
  const req = {
    session: role ? { user: { id: "u1", role } } : {},
    method,
    path,
  };
  let error = null;
  superAdminScope(req, {}, (err) => {
    error = err || null;
  });
  return error;
}

describe("superAdminScope", () => {
  it("blocks operational admin endpoints", () => {
    const err = scope({ role: "super_admin", path: "/admin/sessions" });
    assert.strictEqual(err && err.status, 403);
    assert.match(err.message, /only manage integrations/i);
  });

  it("blocks operational cashier endpoints", () => {
    const err = scope({
      role: "super_admin",
      method: "POST",
      path: "/cashier/sessions",
    });
    assert.strictEqual(err && err.status, 403);
  });

  it("blocks the full reservation list but not a public single lookup", () => {
    assert.strictEqual(
      scope({ role: "super_admin", path: "/reservations" })?.status,
      403
    );
    assert.strictEqual(
      scope({ role: "super_admin", path: "/reservations/ABC123" }),
      null
    );
  });

  it("allows its own integration endpoints and auth basics", () => {
    assert.strictEqual(
      scope({ role: "super_admin", path: "/super-admin/settings/integrations" }),
      null
    );
    assert.strictEqual(scope({ role: "super_admin", path: "/me" }), null);
    assert.strictEqual(
      scope({ role: "super_admin", path: "/me/activity-logs" }),
      null
    );
    assert.strictEqual(
      scope({ role: "super_admin", method: "POST", path: "/logout" }),
      null
    );
  });

  it("does not affect other roles or guests", () => {
    assert.strictEqual(scope({ role: "admin", path: "/admin/sessions" }), null);
    assert.strictEqual(scope({ role: "cashier", path: "/cashier/sessions" }), null);
    assert.strictEqual(scope({ role: null, path: "/admin/sessions" }), null);
  });
});

function fakeSession() {
  return {
    user: null,
    destroyed: false,
    regenerate(cb) {
      this.user = null;
      cb(null);
    },
    async save() {},
    destroy(cb) {
      this.destroyed = true;
      if (cb) cb(null);
    },
  };
}

function serviceFor(user) {
  return authService({
    userModel: {
      findByEmail: async () => user,
      findByUsername: async () => null,
      findById: async () => user,
    },
    settingsModel: {},
    db: {
      collection: () => ({
        insertOne: async () => ({ insertedId: "log-1" }),
      }),
    },
  });
}

describe("super-admin sign-in without an authenticator", () => {
  it("creates the session directly when no app is paired", async () => {
    const passwordHash = await bcrypt.hash("Secret123", 4);
    const user = {
      _id: "super-1",
      email: "super@example.com",
      passwordHash,
      role: "super_admin",
      status: "active",
    };
    const req = { ip: "127.0.0.1", session: fakeSession() };

    const result = await serviceFor(user).login(
      { identifier: "super@example.com", password: "Secret123" },
      req
    );

    assert.equal(result.role, "super_admin");
    assert.equal(result.twoFactorRequired, undefined);
    assert.equal(req.session.user.id, "super-1");
    assert.equal(req.session.user.role, "super_admin");
  });

  it("does not invalidate /api/me for a super admin with 2FA off", async () => {
    const user = {
      _id: "super-1",
      email: "super@example.com",
      role: "super_admin",
      status: "active",
    };
    const req = { session: fakeSession() };
    req.session.user = { id: "super-1", role: "super_admin" };

    const me = await serviceFor(user).me("super-1", req);

    assert.equal(me.role, "super_admin");
    assert.equal(me.twoFactorEnabled, false);
    assert.equal(req.session.destroyed, false);
  });
});
