// Reservation service — customer (guest) reservations.
// CU-004..CU-014: select table/date/time, validate, prevent overlap,
// generate reference, view by ref + contact, cancel before start.
import crypto from "node:crypto";
import { HttpError } from "../utils/HttpError.js";
import { toObjectId } from "../models/bson.js";

const NAME_RE = /^.{2,60}$/;
const CONTACT_RE = /^[0-9+\-\s()]{7,25}$/;
const DURATIONS = [60, 120, 180, 240, 300, 360, 480, 720, 1440];

function throwErr(status, msg) {
  const e = new HttpError(status, msg);
  throw e;
}

function shape(doc) {
  return {
    ref: doc.ref,
    tableId: String(doc.tableId),
    tableName: doc.tableName ?? "",
    customerName: doc.customerName ?? "",
    contactNumber: doc.contactNumber ?? "",
    startTime: doc.startTime instanceof Date ? doc.startTime.toISOString() : null,
    endTime: doc.endTime instanceof Date ? doc.endTime.toISOString() : null,
    durationMinutes: doc.durationMinutes ?? 0,
    status: doc.status ?? "reserved",
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null,
  };
}

function genRef(start) {
  const d = start instanceof Date ? start : new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += chars[crypto.randomInt(chars.length)];
  }
  return `RS-${y}${m}${day}-${suffix}`;
}

export function reservationService({ reservationModel, tableModel, db }) {
  const activityLogs = db.collection("activityLogs");

  async function createReservation(input) {
    const tableId = String(input?.tableId || "").trim();
    if (!/^[0-9a-fA-F]{24}$/.test(tableId)) throwErr(422, "invalid table id");

    const customerName = String(input?.customerName || "").trim();
    if (!NAME_RE.test(customerName)) throwErr(422, "customer name is required (2-60 chars)");

    const contactNumber = String(input?.contactNumber || "").trim();
    if (!CONTACT_RE.test(contactNumber)) throwErr(422, "contact number is required");

    const startRaw = input?.startTime;
    const start = startRaw instanceof Date ? startRaw : new Date(startRaw);
    if (isNaN(start.getTime())) throwErr(422, "invalid reservation date/time");
    const now = new Date();
    if (start.getTime() < now.getTime() - 60 * 1000) throwErr(422, "reservation time must be in the future");

    let duration = Number(input?.durationMinutes);
    if (!Number.isFinite(duration) || duration <= 0) duration = 60;
    if (!DURATIONS.includes(duration)) {
      // allow any multiple of 60 up to 1440
      if (duration % 60 !== 0 || duration < 60 || duration > 1440) {
        throwErr(422, "duration must be 60-1440 minutes in 60-minute steps");
      }
    }
    const end = new Date(start.getTime() + duration * 60 * 1000);

    const table = await tableModel.findById(tableId);
    if (!table) throwErr(404, "table not found");
    if (table.archived) throwErr(422, "table is archived");
    if (table.status === "maintenance") throwErr(422, "table is under maintenance");

    const overlaps = await reservationModel.findOverlapping(tableId, start, end);
    if (overlaps && overlaps.length > 0) {
      throwErr(409, "selected table/time is unavailable");
    }

    // generate unique ref with retries
    let ref = null;
    for (let i = 0; i < 5; i++) {
      const candidate = genRef(start);
      const existing = await reservationModel.findByRef(candidate);
      if (!existing) { ref = candidate; break; }
    }
    if (!ref) throwErr(500, "could not generate reservation reference");

    const oid = toObjectId(tableId);
    const now2 = new Date();
    const id = await reservationModel.create({
      ref,
      tableId: oid || tableId,
      tableName: table.name ?? "",
      customerName,
      contactNumber,
      startTime: start,
      endTime: end,
      durationMinutes: duration,
      status: "reserved",
      createdAt: now2,
      updatedAt: now2,
    });

    const doc = await reservationModel.findById(id);
    try {
      await activityLogs.insertOne({
        actorId: null,
        action: "reservation_create",
        target: ref,
        at: now2,
      });
    } catch (_) { /* audit best-effort */ }

    return { ok: true, reservation: shape(doc) };
  }

  async function getByRef(ref, contactNumber) {
    const r = String(ref || "").trim();
    if (!r) throwErr(422, "reservation reference is required");
    const contact = String(contactNumber || "").trim();
    if (!contact) throwErr(422, "contact number is required");

    const doc = await reservationModel.findByRef(r);
    if (!doc) throwErr(404, "reservation not found");
    if (String(doc.contactNumber).trim().toLowerCase() !== contact.toLowerCase()) {
      throwErr(404, "reservation not found");
    }
    return { ok: true, reservation: shape(doc) };
  }

  async function cancel(ref, contactNumber) {
    const r = String(ref || "").trim();
    if (!r) throwErr(422, "reservation reference is required");
    const contact = String(contactNumber || "").trim();
    if (!contact) throwErr(422, "contact number is required");

    const doc = await reservationModel.findByRef(r);
    if (!doc) throwErr(404, "reservation not found");
    if (String(doc.contactNumber).trim().toLowerCase() !== contact.toLowerCase()) {
      throwErr(404, "reservation not found");
    }
    if (doc.status === "cancelled") throwErr(409, "reservation already cancelled");
    if (doc.startTime instanceof Date && doc.startTime.getTime() <= Date.now()) {
      throwErr(422, "cannot cancel after reservation time");
    }

    const now = new Date();
    await reservationModel.update(doc._id, {
      status: "cancelled",
      cancelledAt: now,
      updatedAt: now,
    });
    const fresh = await reservationModel.findByRef(r);
    return { ok: true, reservation: shape(fresh) };
  }

  // Cashier decision on a pending request. Accepting keeps the slot blocked;
  // rejecting releases it, because only reserved/accepted reservations block
  // overlaps (see reservationModel.findOverlapping).
  async function decide(ref, nextStatus, actorId, action) {
    const r = String(ref || "").trim();
    if (!r) throwErr(422, "reservation reference is required");

    const doc = await reservationModel.findByRef(r);
    if (!doc) throwErr(404, "reservation not found");
    if (doc.status === nextStatus) throwErr(409, `reservation already ${nextStatus}`);
    if (doc.status !== "reserved") throwErr(409, `reservation is ${doc.status}`);

    const now = new Date();
    const set = { status: nextStatus, updatedAt: now };
    if (nextStatus === "accepted") set.acceptedAt = now;
    else set.rejectedAt = now;
    await reservationModel.update(doc._id, set);

    try {
      await activityLogs.insertOne({ actorId: actorId || null, action, target: r, at: now });
    } catch (_) { /* audit best-effort */ }

    const fresh = await reservationModel.findByRef(r);
    return { ok: true, reservation: shape(fresh) };
  }

  async function accept(ref, actorId) {
    return decide(ref, "accepted", actorId, "reservation_accept");
  }

  async function reject(ref, actorId) {
    return decide(ref, "rejected", actorId, "reservation_reject");
  }

  async function listAll() {
    const docs = await reservationModel.list({ status: { $ne: "archived" } });
    return { ok: true, reservations: (docs || []).map(shape) };
  }

  return {
    createReservation,
    getByRef,
    cancel,
    accept,
    reject,
    listAll,
  };
}