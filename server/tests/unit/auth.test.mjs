// Unit tests for authService input handling.
// Regression: register() must build the invitation model from `db` (the
// module exports a factory, not an instance) and malformed JSON bodies must
// fail with 422 instead of a TypeError/500.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { authService } from "../../src/services/auth.service.js";

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
