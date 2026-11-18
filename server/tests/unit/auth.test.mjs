// Unit tests for authService input handling and super-admin scope/sign-in.
// Regression: register() must build the invitation model from `db` (the
// module exports a factory, not an instance) and malformed JSON bodies must
// fail with 422 instead of a TypeError/500. The super admin is least-privilege:
// operational routes must be rejected before a controller sees the request.
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

function harness({ users = [], invitation = null } = {}) {
  const calls = { invitations: [], inserts: [], activities: [] };
  const db = {
    collection(name) {
      if (name === "invitations") {
        return {
          async findOne(filter) {
            calls.invitations.push(filter);
            return invitation;
          },
          async updateOne() {
            return { modifiedCount: 1 };
          },
        };
      }
      if (name === "users") {
        return {
          async insertOne(doc) {
            calls.inserts.push(doc);
            return { insertedId: "64b000000000000000000001" };
          },
        };
      }
      return {
        async insertOne(doc) {
          calls.activities.push(doc);
          return { insertedId: "log1" };
        },
      };
    },
  };
  const userModel = {
    async findByEmail(email) {
      return users.find((u) => u.email === String(email).toLowerCase()) || null;
    },
    async findByUsername(username) {
      return users.find((u) => u.username === String(username).toLowerCase()) || null;
    },
    async findById(id) {
      return users.find((u) => String(u._id) === String(id)) || null;
    },
  };
  const service = authService({
    userModel,
    settingsModel: { findOne: async () => null },
    db,
  });
  return { service, calls };
}

function sessionStub() {
  return {
    session: {
      regenerate(done) {
        done(null);
      },
      async save() {},
    },
  };
}

const INVITE = {
  _id: "64b000000000000000000002",
  email: "invited@example.com",
  used: false,
  expiresAt: new Date(Date.now() + 60_000),
};

const VALID_REGISTER = {
  token: "invite-token",
  firstName: "Ana",
  lastName: "Cruz",
  email: "Invited@Example.com",
  password: "supersecret",
  username: "Ana.Cruz",
};

describe("authService.register", () => {
  it("creates the cashier through the invitation model and normalizes fields", async () => {
    const { service, calls } = harness({ invitation: INVITE });

    const out = await service.register(VALID_REGISTER);

    assert.deepEqual(out, {
      username: "ana.cruz",
      email: "invited@example.com",
      role: "cashier",
    });
    assert.equal(calls.invitations.length, 1);
    assert.equal(calls.inserts.length, 1);
    const user = calls.inserts[0];
    assert.equal(user.firstName, "Ana");
    assert.equal(user.lastName, "Cruz");
    assert.equal(user.displayName, "Ana Cruz");
    assert.equal(user.username, "ana.cruz");
    assert.equal(user.email, "invited@example.com");
    assert.equal(user.role, "cashier");
    assert.equal(await bcrypt.compare("supersecret", user.passwordHash), true);
  });

  it("rejects a missing token with 422", async () => {
    const { service } = harness();
    await assert.rejects(
      service.register({ ...VALID_REGISTER, token: undefined }),
      (err) => err.status === 422
    );
  });

  it("rejects non-string names/password/username with 422, not TypeError", async () => {
    const { service } = harness({ invitation: INVITE });
    for (const patch of [
      { firstName: {} },
      { lastName: [] },
      { password: 12345678 },
      { username: undefined },
      { username: { name: "ana" } },
    ]) {
      await assert.rejects(
        service.register({ ...VALID_REGISTER, ...patch }),
        (err) => err.status === 422
      );
    }
  });
});

describe("authService.login", () => {
  it("trims the identifier and accepts the stored password", async () => {
    const passwordHash = await bcrypt.hash("supersecret", 4);
    const { service } = harness({
      users: [
        {
          _id: "64b000000000000000000003",
          email: "ana@example.com",
          username: "ana",
          passwordHash,
          role: "cashier",
          status: "active",
        },
      ],
    });

    const out = await service.login(
      { identifier: "  ANA@example.com ", password: "supersecret" },
      sessionStub()
    );

    assert.equal(out.email, "ana@example.com");
    assert.equal(out.role, "cashier");
  });

  it("rejects non-string credentials with 422 instead of a bcrypt TypeError", async () => {
    const { service } = harness();
    for (const body of [
      { identifier: "ana", password: { value: "x" } },
      { identifier: 42, password: "supersecret" },
      { identifier: "ana", password: null },
    ]) {
      await assert.rejects(
        service.login(body, sessionStub()),
        (err) => err.status === 422
      );
    }
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
