// Unit tests: reservation email capture + ACCEPTED notification on approval.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reservationService } from "../../src/services/reservation.service.js";
import { reservationAcceptedMail } from "../../src/services/mail.service.js";

const TABLE_ID = "507f1f77bcf86cd799439011";

function makeEnv(overrides = {}) {
  const docs = [
    {
      _id: "id-1",
      ref: "RS-20261105-ABCD",
      tableId: TABLE_ID,
      tableName: "Table 3",
      customerName: "Maria Cruz",
      customerEmail: "maria@example.com",
      contactNumber: "09171234567",
      startTime: new Date("2026-11-05T11:00:00Z"),
      endTime: new Date("2026-11-05T13:00:00Z"),
      durationMinutes: 120,
      status: "reserved",
      createdAt: new Date(),
      ...overrides,
    },
  ];
  const find = (ref) => docs.find((d) => d.ref === ref) || null;
  const reservationModel = {
    findByRef: async (ref) => find(ref),
    findById: async (id) => docs.find((d) => d._id === id) || null,
    findOverlapping: async () => [],
    create: async (doc) => {
      const _id = `id-${docs.length + 1}`;
      docs.push({ _id, ...doc });
      return _id;
    },
    update: async (id, set) => {
      Object.assign(docs.find((d) => d._id === id), set);
    },
  };
  const tableModel = {
    findById: async () => ({ _id: TABLE_ID, name: "Table 3", status: "available" }),
  };
  const db = { collection: () => ({ insertOne: async () => ({}) }) };
  return { docs, reservationModel, tableModel, db };
}

function fakeMailer(impl = {}) {
  const calls = [];
  return {
    calls,
    sendReservationAccepted: async (doc) => {
      calls.push(doc.ref);
      if (impl.throw) throw new Error("smtp down");
      return true;
    },
  };
}

function service(env, mailer) {
  return reservationService({ ...env, mailer });
}

describe("reservation customer email", () => {
  it("requires a valid email and stores it normalized on create", async () => {
    const env = makeEnv();
    const svc = service(env);

    const created = await svc.createReservation({
      tableId: TABLE_ID,
      customerName: "Maria Cruz",
      contactNumber: "09171234567",
      customerEmail: "  Maria.Cruz@Example.COM ",
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      durationMinutes: 60,
    });

    assert.equal(created.ok, true);
    assert.equal(created.reservation.customerEmail, "maria.cruz@example.com");
    assert.equal(env.docs.at(-1).customerEmail, "maria.cruz@example.com");
  });

  it("rejects a reservation without a valid email", async () => {
    const svc = service(makeEnv());

    await assert.rejects(
      () =>
        svc.createReservation({
          tableId: TABLE_ID,
          customerName: "Maria Cruz",
          contactNumber: "09171234567",
          customerEmail: "not-an-email",
          startTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          durationMinutes: 60,
        }),
      /valid email is required/
    );
  });

  it("emails the customer when a reservation is accepted", async () => {
    const mailer = fakeMailer();
    const result = await service(makeEnv(), mailer).accept("RS-20261105-ABCD", "admin-1");

    assert.equal(result.reservation.status, "accepted");
    assert.equal(result.notified, true);
    assert.deepEqual(mailer.calls, ["RS-20261105-ABCD"]);
  });

  it("still accepts when the email fails", async () => {
    const mailer = fakeMailer({ throw: true });
    const result = await service(makeEnv(), mailer).accept("RS-20261105-ABCD", "admin-1");

    assert.equal(result.reservation.status, "accepted");
    assert.equal(result.notified, false);
  });

  it("reports not notified when the mailer skips delivery", async () => {
    const mailer = { sendReservationAccepted: async () => false };
    const result = await service(makeEnv(), mailer).accept("RS-20261105-ABCD", "admin-1");

    assert.equal(result.reservation.status, "accepted");
    assert.equal(result.notified, false);
  });

  it("does not email on reject", async () => {
    const mailer = fakeMailer();
    const result = await service(makeEnv(), mailer).reject("RS-20261105-ABCD", "admin-1");

    assert.equal(result.reservation.status, "rejected");
    assert.equal(mailer.calls.length, 0);
  });

  it("accepts legacy reservations that have no email", async () => {
    const mailer = fakeMailer();
    const env = makeEnv({ customerEmail: "" });
    const result = await service(env, mailer).accept("RS-20261105-ABCD", "admin-1");

    assert.equal(result.ok, true);
    assert.equal(result.notified, false);
    assert.equal(mailer.calls.length, 0);
  });
});

describe("reservationAcceptedMail", () => {
  const reservation = {
    ref: "RS-20261105-ABCD",
    tableName: "Table 3",
    customerName: "Maria Cruz",
    customerEmail: "maria@example.com",
    contactNumber: "09171234567",
    startTime: new Date("2026-11-05T11:00:00Z"), // 7:00 PM Manila
    endTime: new Date("2026-11-05T13:00:00Z"),
    durationMinutes: 120,
  };

  it("builds the ACCEPTED message with the booking details", () => {
    const mail = reservationAcceptedMail(reservation);

    assert.equal(mail.to, "maria@example.com");
    assert.match(mail.subject, /ACCEPTED/);
    assert.match(mail.text, /has been ACCEPTED/);
    assert.match(mail.text, /Reference: RS-20261105-ABCD/);
    assert.match(mail.text, /Table: Table 3/);
    assert.match(mail.text, /Duration: 2 hours/);
    assert.match(mail.html, /<strong[^>]*>ACCEPTED<\/strong>/);
  });

  it("escapes customer-provided values in the HTML body", () => {
    const mail = reservationAcceptedMail({
      ...reservation,
      customerName: '<script>alert("x")</script>',
    });

    assert.doesNotMatch(mail.html, /<script>/);
    assert.match(mail.html, /&lt;script&gt;/);
  });
});
