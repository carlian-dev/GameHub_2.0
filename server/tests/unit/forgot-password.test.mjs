// Unit tests for the forgot password and reset password flow.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

// Ensure JWT_SECRET is set for any dependent imports
process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-test-jwt-secret";

const { authService } = await import("../../src/services/auth.service.js");
const { passwordResetMail } = await import("../../src/services/mail.service.js");

const USER_ID = "64b7f0c2f1a2b3c4d5e6f7a8";

function makeTestEnv(initialUser = null, options = {}) {
  let user = initialUser
    ? { ...initialUser }
    : {
        _id: USER_ID,
        email: "staff@example.com",
        username: "staff",
        role: "admin",
        status: "active",
        tokenVersion: 0,
        passwordHash: "$2a$04$somehash",
      };

  const logs = [];
  const mailCalls = [];

  const userModel = {
    findByEmail: async (email) => {
      if (user && user.email === String(email).toLowerCase()) return user;
      return null;
    },
    findByUsername: async (username) => {
      if (user && user.username === String(username).toLowerCase()) return user;
      return null;
    },
    findById: async (id) => {
      if (user && String(user._id) === String(id)) return user;
      return null;
    },
    findByResetTokenHash: async (tokenHash) => {
      if (user && user.resetPassword && user.resetPassword.tokenHash === tokenHash) {
        return user;
      }
      return null;
    },
  };

  const db = {
    collection: (name) => {
      if (name === "users") {
        return {
          updateOne: async (filter, update) => {
            if (update.$set) {
              Object.assign(user, update.$set);
            }
            if (update.$unset) {
              for (const k of Object.keys(update.$unset)) {
                delete user[k];
              }
            }
            if (update.$inc) {
              for (const [k, v] of Object.entries(update.$inc)) {
                user[k] = (user[k] || 0) + v;
              }
            }
            return { modifiedCount: 1 };
          },
        };
      }
      if (name === "activityLogs") {
        return {
          insertOne: async (doc) => {
            logs.push(doc);
            return { insertedId: `log-${logs.length}` };
          },
        };
      }
      return {};
    },
  };

  const mailer = {
    sendPasswordReset: async (email, link) => {
      mailCalls.push({ email, link });
      if (options.mailerThrows) throw new Error("SMTP failure");
      return true;
    },
  };

  const svc = authService({
    userModel,
    settingsModel: {},
    invitationModel: {},
    db,
    mailer,
    frontendUrl: "http://localhost:5500",
    mailerDryRun: Boolean(options.mailerDryRun),
  });

  return { svc, getUser: () => user, setUser: (u) => { user = u; }, logs, mailCalls };
}

describe("passwordResetMail", () => {
  it("builds email with reset link and security notice", () => {
    const mail = passwordResetMail({
      email: "staff@example.com",
      link: "http://localhost:5500/src/function/auth/reset-password.html?token=abc123token",
    });

    assert.equal(mail.to, "staff@example.com");
    assert.match(mail.subject, /Reset your GameHub password/i);
    assert.match(mail.text, /abc123token/);
    assert.match(mail.text, /1 hour/i);
    assert.match(mail.html, /Reset Password/);
    assert.match(mail.html, /abc123token/);
  });

  it("escapes html entities in reset link", () => {
    const mail = passwordResetMail({
      email: "staff@example.com",
      link: 'http://localhost:5500/reset?token=abc&foo="bar"',
    });
    assert.doesNotMatch(mail.html, /"bar"/);
    assert.match(mail.html, /&quot;bar&quot;/);
  });
});

describe("forgotPassword", () => {
  it("rejects an invalid email format with 422", async () => {
    const { svc } = makeTestEnv();
    await assert.rejects(
      () => svc.forgotPassword({ email: "not-an-email" }),
      (err) => err.status === 422 && /valid email is required/i.test(err.message)
    );
  });

  it("returns generic success for non-existent email and does not send mail", async () => {
    const { svc, mailCalls } = makeTestEnv();
    const result = await svc.forgotPassword({ email: "unknown@example.com" });

    assert.equal(result.ok, true);
    assert.match(result.message, /If an account with that email exists/i);
    assert.equal(mailCalls.length, 0);
  });

  it("returns generic success for inactive/archived account and does not send mail", async () => {
    const { svc, mailCalls } = makeTestEnv({
      _id: USER_ID,
      email: "archived@example.com",
      role: "cashier",
      status: "archived",
    });
    const result = await svc.forgotPassword({ email: "archived@example.com" });

    assert.equal(result.ok, true);
    assert.equal(mailCalls.length, 0);
  });

  it("generates a secure reset token, sets 1-hour expiry, sends mail, and logs audit", async () => {
    const { svc, getUser, mailCalls, logs } = makeTestEnv();
    const result = await svc.forgotPassword({ email: "STAFF@EXAMPLE.COM" });

    assert.equal(result.ok, true);
    assert.equal(mailCalls.length, 1);
    assert.equal(mailCalls[0].email, "staff@example.com");
    assert.match(mailCalls[0].link, /token=[0-9a-f]{64}/);

    const user = getUser();
    assert.ok(user.resetPassword);
    assert.ok(user.resetPassword.tokenHash);
    assert.equal(user.resetPassword.tokenHash.length, 64);
    assert.ok(user.resetPassword.expiresAt.getTime() > Date.now());

    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, "password_reset_request");
    assert.equal(logs[0].actorId, USER_ID);
  });
});

describe("verifyResetToken", () => {
  it("rejects empty token with 400", async () => {
    const { svc } = makeTestEnv();
    await assert.rejects(
      () => svc.verifyResetToken(""),
      (err) => err.status === 400
    );
  });

  it("rejects invalid token with 404", async () => {
    const { svc } = makeTestEnv();
    await assert.rejects(
      () => svc.verifyResetToken("invalid-token-12345"),
      (err) => err.status === 404
    );
  });

  it("rejects expired token with 410", async () => {
    const rawToken = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const { svc } = makeTestEnv({
      _id: USER_ID,
      email: "staff@example.com",
      status: "active",
      resetPassword: {
        tokenHash,
        expiresAt: new Date(Date.now() - 5000), // expired 5s ago
      },
    });

    await assert.rejects(
      () => svc.verifyResetToken(rawToken),
      (err) => err.status === 410 && /expired/i.test(err.message)
    );
  });

  it("returns valid and user email for active user with valid token", async () => {
    const rawToken = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const { svc } = makeTestEnv({
      _id: USER_ID,
      email: "staff@example.com",
      status: "active",
      resetPassword: {
        tokenHash,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });

    const result = await svc.verifyResetToken(rawToken);
    assert.equal(result.valid, true);
    assert.equal(result.email, "staff@example.com");
  });
});

describe("resetPassword", () => {
  it("rejects password shorter than 8 chars with 422", async () => {
    const { svc } = makeTestEnv();
    await assert.rejects(
      () => svc.resetPassword({ token: "token123", password: "short" }),
      (err) => err.status === 422 && /at least 8 characters/i.test(err.message)
    );
  });

  it("completes password reset, unsets token, bumps tokenVersion, and updates hash", async () => {
    const rawToken = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const oldPasswordHash = await bcrypt.hash("OldPassword123", 4);

    const { svc, getUser, logs } = makeTestEnv({
      _id: USER_ID,
      email: "staff@example.com",
      username: "staff",
      status: "active",
      tokenVersion: 2,
      passwordHash: oldPasswordHash,
      resetPassword: {
        tokenHash,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });

    const result = await svc.resetPassword({
      token: rawToken,
      password: "NewBrandPassword123!",
    });

    assert.equal(result.ok, true);

    const user = getUser();
    assert.equal(user.resetPassword, undefined);
    assert.equal(user.tokenVersion, 3); // revoked all active sessions!

    const matchesNew = await bcrypt.compare("NewBrandPassword123!", user.passwordHash);
    assert.equal(matchesNew, true);

    const matchesOld = await bcrypt.compare("OldPassword123", user.passwordHash);
    assert.equal(matchesOld, false);

    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, "password_reset");
    assert.equal(logs[0].actorId, USER_ID);
  });
});
