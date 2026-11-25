// Unit tests for invite state logic.
// migration.md §16: Invite states: valid, used, expired, invalid.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

function inviteState(doc, nowMs) {
  if (!doc) return "invalid";
  if (!empty(doc.used)) return "used";
  if (inviteExpiresMs(doc) < nowMs) return "expired";
  return "valid";
}

function empty(v) {
  return v === null || v === undefined || v === false || v === 0 || v === "";
}

function inviteExpiresMs(doc) {
  const exp = doc.expiresAt;
  if (exp instanceof Date) return exp.getTime();
  return 0;
}

describe("invite states", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();

  it("null doc -> invalid", () => {
    assert.strictEqual(inviteState(null, now), "invalid");
  });

  it("valid unused unexpired -> valid", () => {
    const doc = { used: false, expiresAt: new Date("2026-01-02T12:00:00Z") };
    assert.strictEqual(inviteState(doc, now), "valid");
  });

  it("used -> used", () => {
    const doc = { used: true, expiresAt: new Date("2026-01-02T12:00:00Z") };
    assert.strictEqual(inviteState(doc, now), "used");
  });

  it("expired -> expired", () => {
    const doc = { used: false, expiresAt: new Date("2025-12-31T12:00:00Z") };
    assert.strictEqual(inviteState(doc, now), "expired");
  });
});

import { invitationService } from "../../src/services/invitation.service.js";

describe("invitationService co-admin and cashier invites", () => {
  function makeMockService() {
    const createdDocs = [];
    const logs = [];
    const invitations = [];
    const mailSent = [];

    const mockModel = {
      async findByTokenHashAny(tokenHash) {
        return invitations.find((i) => i.tokenHash === tokenHash) || null;
      },
      async create(doc) {
        const id = `inv-${createdDocs.length + 1}`;
        const record = { _id: id, ...doc };
        createdDocs.push(record);
        invitations.push(record);
        return id;
      },
      async list() {
        return invitations;
      },
      async findById(id) {
        return invitations.find((i) => String(i._id) === String(id)) || null;
      },
      async revoke(id) {
        const item = invitations.find((i) => String(i._id) === String(id));
        if (item) {
          item.used = true;
          item.revoked = true;
        }
        return true;
      },
    };

    const mockDb = {
      collection: (name) => {
        if (name === "activityLogs") {
          return {
            insertOne: async (doc) => logs.push(doc),
          };
        }
        if (name === "invitations") {
          return {
            deleteMany: async () => {},
            deleteOne: async () => {},
          };
        }
        return {};
      },
    };

    const mockMailer = {
      async sendInvite(email, link, role) {
        mailSent.push({ email, link, role });
      },
    };

    const svc = invitationService({
      invitationModel: mockModel,
      db: mockDb,
      mailer: mockMailer,
    });

    return { svc, createdDocs, logs, mailSent, invitations };
  }

  it("creates a cashier invitation by default", async () => {
    const { svc, createdDocs, logs, mailSent } = makeMockService();
    const res = await svc.create({
      email: "cashier@test.com",
      actorId: "admin-1",
      frontendUrl: "http://localhost:5500",
    });

    assert.equal(res.ok, true);
    assert.equal(res.role, "cashier");
    assert.equal(createdDocs[0].role, "cashier");
    assert.equal(logs[0].action, "approve_cashier");
    assert.equal(mailSent[0].role, "cashier");
  });

  it("creates a co-admin invitation when role is admin", async () => {
    const { svc, createdDocs, logs, mailSent } = makeMockService();
    const res = await svc.create({
      email: "coadmin@test.com",
      role: "admin",
      actorId: "admin-1",
      frontendUrl: "http://localhost:5500",
    });

    assert.equal(res.ok, true);
    assert.equal(res.role, "admin");
    assert.equal(createdDocs[0].role, "admin");
    assert.equal(logs[0].action, "approve_admin");
    assert.equal(mailSent[0].role, "admin");
  });

  it("rejects an invalid role", async () => {
    const { svc } = makeMockService();
    await assert.rejects(
      () =>
        svc.create({
          email: "super@test.com",
          role: "super_admin",
          actorId: "admin-1",
          frontendUrl: "http://localhost:5500",
        }),
      (err) => err.status === 422 && /role must be cashier or admin/i.test(err.message)
    );
  });

  it("checks token and returns role", async () => {
    const { svc, invitations } = makeMockService();
    const token = "a".repeat(64);
    const crypto = await import("node:crypto");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    invitations.push({
      _id: "inv-admin-99",
      email: "admin2@test.com",
      role: "admin",
      tokenHash,
      used: false,
      expiresAt: new Date(Date.now() + 86400000),
    });

    const checkRes = await svc.check(token);
    assert.equal(checkRes.valid, true);
    assert.equal(checkRes.email, "admin2@test.com");
    assert.equal(checkRes.role, "admin");
  });

  it("lists invitations including role", async () => {
    const { svc, invitations } = makeMockService();
    invitations.push({
      _id: "inv-1",
      email: "cashier@test.com",
      role: "cashier",
      used: false,
      createdAt: new Date(),
    });
    invitations.push({
      _id: "inv-2",
      email: "admin@test.com",
      role: "admin",
      used: false,
      createdAt: new Date(),
    });

    const res = await svc.list();
    assert.equal(res.ok, true);
    assert.equal(res.invitations.length, 2);
    assert.equal(res.invitations[0].role, "cashier");
    assert.equal(res.invitations[1].role, "admin");
  });
});
