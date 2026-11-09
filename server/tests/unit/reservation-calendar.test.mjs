// Unit tests: accepted reservations reach Google Calendar, cancellations remove
// the event, and a calendar outage never fails the reservation itself.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reservationService } from "../../src/services/reservation.service.js";

function makeEnv() {
  // Keep the booking in the future so cancel() is allowed regardless of when
  // the suite runs (fixed dates went stale once that day passed).
  const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);
  const docs = [
    {
      _id: "id-1",
      ref: "RS-20261105-ABCD",
      tableId: "507f1f77bcf86cd799439011",
      tableName: "Table 3",
      customerName: "Maria Cruz",
      contactNumber: "09171234567",
      startTime,
      endTime,
      durationMinutes: 120,
      status: "reserved",
      createdAt: new Date(),
    },
  ];
  const find = (ref) => docs.find((d) => d.ref === ref) || null;
  const reservationModel = {
    findByRef: async (ref) => find(ref),
    update: async (id, set) => {
      Object.assign(docs.find((d) => d._id === id), set);
    },
  };
  const db = { collection: () => ({ insertOne: async () => ({}) }) };
  return { docs, reservationModel, db };
}

function fakeCalendar(impl = {}) {
  const calls = [];
  return {
    enabled: true,
    calls,
    createReservationEvent: async (doc) => {
      calls.push(["create", doc.ref]);
      if (impl.create) return impl.create(doc);
      return "evt-1";
    },
    deleteReservationEvent: async (id) => {
      calls.push(["delete", id]);
      if (impl.delete) return impl.delete(id);
      return true;
    },
  };
}

describe("reservationService + Google Calendar", () => {
  it("stores the event id when a reservation is accepted", async () => {
    const { docs, reservationModel, db } = makeEnv();
    const calendar = fakeCalendar();
    const svc = reservationService({ reservationModel, tableModel: {}, db, calendarService: calendar });

    const result = await svc.accept("RS-20261105-ABCD", "admin-1");

    assert.equal(result.ok, true);
    assert.equal(result.reservation.status, "accepted");
    assert.deepEqual(calendar.calls, [["create", "RS-20261105-ABCD"]]);
    assert.equal(docs[0].calendarEventId, "evt-1");
    assert.equal("calendarEventId" in result.reservation, false);
  });

  it("still accepts when the calendar call fails", async () => {
    const { docs, reservationModel, db } = makeEnv();
    const calendar = fakeCalendar({
      create: async () => {
        throw new Error("calendar down");
      },
    });
    const svc = reservationService({ reservationModel, tableModel: {}, db, calendarService: calendar });

    const result = await svc.accept("RS-20261105-ABCD", "admin-1");

    assert.equal(result.reservation.status, "accepted");
    assert.equal(docs[0].calendarEventId, undefined);
  });

  it("removes the event when a booked reservation is cancelled", async () => {
    const { docs, reservationModel, db } = makeEnv();
    Object.assign(docs[0], { status: "accepted", calendarEventId: "evt-1" });
    const calendar = fakeCalendar();
    const svc = reservationService({ reservationModel, tableModel: {}, db, calendarService: calendar });

    const result = await svc.cancel("RS-20261105-ABCD", "09171234567");

    assert.equal(result.reservation.status, "cancelled");
    assert.deepEqual(calendar.calls, [["delete", "evt-1"]]);
    assert.equal(docs[0].calendarEventId, null);
  });

  it("works with no calendar configured", async () => {
    const { docs, reservationModel, db } = makeEnv();
    const svc = reservationService({ reservationModel, tableModel: {}, db });

    const result = await svc.accept("RS-20261105-ABCD", "admin-1");

    assert.equal(result.reservation.status, "accepted");
    assert.equal(docs[0].calendarEventId, undefined);
  });
});
