// Unit tests for the super-admin route scope and stateless JWT sign-in.
// Auth is JWT-based: login returns a signed token (the controller puts it in an
// HttpOnly cookie) and logout bumps users.tokenVersion instead of destroying a
// server-side session.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

// env.js reads JWT_SECRET when it is first imported, so pin a test value before
// the dynamic imports below (dotenv never overrides an existing env value).
process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-test-jwt-secret";

const { superAdminScope } = await import("../../src/middleware/auth.js");
const { authService } = await import("../../src/services/auth.service.js");
const { signAuthToken, verifyAuthToken } = await import(
  "../../src/utils/authToken.js"
);

const USER_ID = "64b7f0c2f1a2b3c4d5e6f7a8";

function scope({ role, method = "GET", path }) {
  const req = {
    authUser: role ? { id: "u1", role } : null,
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

/** Fake dependency graph; `calls` captures the audit/version writes. */
function serviceFor(user, calls = {}) {
  return authService({
    userModel: {
      findByEmail: async () => user,
      findByUsername: async () => null,
      findById: async () => user,
    },
    settingsModel: {},
    db: {
      collection: (name) => ({
        insertOne: async (doc) => {
          calls.log = { name, doc };
          return { insertedId: "log-1" };
        },
        updateOne: async (filter, update) => {
          calls.update = { name, filter, update };
          return { modifiedCount: 1 };
        },
      }),
    },
  });
}

describe("stateless JWT sign-in", () => {
  it("returns a signed token instead of creating a server session", async () => {
    const passwordHash = await bcrypt.hash("Secret123", 4);
    const user = {
      _id: USER_ID,
      email: "super@example.com",
      passwordHash,
      role: "super_admin",
      status: "active",
    };

    const result = await serviceFor(user).login({
      identifier: "super@example.com",
      password: "Secret123",
    });

    assert.equal(result.user.role, "super_admin");
    assert.equal(result.user.email, "super@example.com");
    assert.equal(result.twoFactorRequired, undefined);

    const claims = verifyAuthToken(result.token);
    assert.equal(claims.sub, USER_ID);
    assert.equal(claims.role, "super_admin");
    assert.equal(claims.ver, 0);
    assert.ok(claims.exp > claims.iat);
  });

  it("signs the tokenVersion so a logout can invalidate old tokens", () => {
    const token = signAuthToken({ _id: USER_ID, role: "cashier", tokenVersion: 4 });
    assert.equal(verifyAuthToken(token).ver, 4);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signAuthToken({ _id: USER_ID, role: "admin" });
    const claims = verifyAuthToken(token);
    assert.equal(claims.sub, USER_ID);
    // Only the signature check proves the token was minted by this backend.
    assert.throws(() => {
      const jwt = token.split(".");
      jwt[2] = "deadbeef";
      verifyAuthToken(jwt.join("."));
    });
  });

  it("logs out by bumping tokenVersion, not by destroying a session", async () => {
    const calls = {};
    const result = await serviceFor({}, calls).logout({
      id: USER_ID,
      role: "super_admin",
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.update.update.$inc.tokenVersion, 1);
    assert.equal(String(calls.update.filter._id), USER_ID);
    assert.equal(calls.log.doc.action, "logout");
  });

  it("treats a guest logout as a no-op", async () => {
    const calls = {};
    assert.deepEqual(await serviceFor({}, calls).logout(null), { ok: true });
    assert.equal(calls.update, undefined);
  });

  it("does not invalidate /api/me for a super admin with 2FA off", async () => {
    const user = {
      _id: USER_ID,
      email: "super@example.com",
      role: "super_admin",
      status: "active",
    };

    const me = await serviceFor(user).me(USER_ID);

    assert.equal(me.role, "super_admin");
    assert.equal(me.twoFactorEnabled, false);
  });

  it("still refuses /api/me for an account that is no longer active", async () => {
    const user = {
      _id: USER_ID,
      role: "cashier",
      status: "archived",
    };

    await assert.rejects(() => serviceFor(user).me(USER_ID), {
      status: 401,
      message: "not logged in",
    });
  });
});

describe("cashier registration security (username & password)", () => {
  const token = "invite-token-1234567890abcdef1234567890abcdef";
  const validInvite = {
    _id: "inv-1",
    email: "cashier@example.com",
    used: false,
    expiresAt: new Date(Date.now() + 86400000),
    createdBy: "admin-1",
  };

  function regService(userDoc = null, customInvite = null) {
    const users = [];
    const logs = [];
    return {
      svc: authService({
        userModel: {
          findByEmail: async (email) => (userDoc?.email === email ? userDoc : null),
          findByUsername: async (username) => (userDoc?.username === username ? userDoc : null),
          findById: async () => null,
        },
        invitationModel: {
          findByTokenHashAny: async () => customInvite || validInvite,
          markUsed: async () => true,
        },
        db: {
          collection: (name) => ({
            insertOne: async (doc) => {
              if (name === "users") users.push(doc);
              else logs.push(doc);
              return { insertedId: "new-user-1" };
            },
          }),
        },
      }),
      users,
      logs,
    };
  }

  it("rejects invalid or reserved usernames", async () => {
    const { svc } = regService();

    // Reserved username
    await assert.rejects(
      () =>
        svc.register({
          token,
          firstName: "Juan",
          lastName: "Dela Cruz",
          email: "cashier@example.com",
          username: "admin",
          password: "ValidPass123!",
        }),
      (err) => err.status === 422 && /reserved/i.test(err.message)
    );

    // Starts with dot
    await assert.rejects(
      () =>
        svc.register({
          token,
          firstName: "Juan",
          lastName: "Dela Cruz",
          email: "cashier@example.com",
          username: ".juan",
          password: "ValidPass123!",
        }),
      (err) => err.status === 422 && /start and end with a letter/i.test(err.message)
    );
  });

  it("rejects weak passwords (too short, only numbers, common, personal info)", async () => {
    const { svc } = regService();

    // Password containing username
    await assert.rejects(
      () =>
        svc.register({
          token,
          firstName: "Juan",
          lastName: "Dela Cruz",
          email: "cashier@example.com",
          username: "juan.cashier",
          password: "juan.cashier123",
        }),
      (err) => err.status === 422 && /weak/i.test(err.message)
    );

    // Common weak password
    await assert.rejects(
      () =>
        svc.register({
          token,
          firstName: "Juan",
          lastName: "Dela Cruz",
          email: "cashier@example.com",
          username: "juan.c",
          password: "password123",
        }),
      (err) => err.status === 422 && /weak/i.test(err.message)
    );
  });

  it("accepts valid registration with moderate or strong password", async () => {
    const { svc, users } = regService();

    const res = await svc.register({
      token,
      firstName: "Juan",
      lastName: "Dela Cruz",
      email: "cashier@example.com",
      username: "juan.cashier",
      password: "StrongPass#2026",
    });

    assert.equal(res.username, "juan.cashier");
    assert.equal(res.role, "cashier");
    assert.equal(users.length, 1);
    assert.equal(users[0].username, "juan.cashier");
    assert.equal(users[0].role, "cashier");
  });

  it("accepts valid co-admin registration when invitation has admin role", async () => {
    const adminInvite = {
      _id: "admin-invite-1",
      email: "coadmin@example.com",
      role: "admin",
      tokenHash: "hashed-token",
      used: false,
      expiresAt: new Date(Date.now() + 86400000),
      createdBy: "main-admin-id",
    };
    const { svc, users, logs } = regService(null, adminInvite);

    const res = await svc.register({
      token,
      firstName: "Maria",
      lastName: "Santos",
      email: "coadmin@example.com",
      username: "maria.admin",
      password: "StrongAdmin#2026",
    });

    assert.equal(res.username, "maria.admin");
    assert.equal(res.role, "admin");
    assert.equal(users.length, 1);
    assert.equal(users[0].username, "maria.admin");
    assert.equal(users[0].role, "admin");
    assert.equal(users[0].status, "active");

    const approvalLog = logs.find((l) => l.action === "approve_admin");
    assert.ok(approvalLog, "should log approve_admin");
    assert.equal(approvalLog.actorId, "main-admin-id");
  });
});
