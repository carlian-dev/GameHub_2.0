// Transaction service — billing + payment close-out.
// migration.md §13.5: two-step flow (end session → create transaction),
// double-bill guard (409), short-payment guard (422), ref GH-YYYYMMDD-XXXX
// with retry on collision, per-hour billing from session snapshot.
import { ObjectId } from "mongodb";
import { round2 } from "../utils/numbers.js";

const REF_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_REF_RETRIES = 5;

function refOnce() {
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += REF_CHARS[Math.floor(Math.random() * 36)];
  }
  return `GH-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${suffix}`;
}

function billedHours(secs) {
  if (secs < 0) secs = 0;
  return Math.max(1, Math.ceil(secs / 3600));
}

function actorName(sessionUser, usersColl) {
  const idRaw = sessionUser && sessionUser.id ? String(sessionUser.id) : "";
  if (idRaw && /^[0-9a-fA-F]{24}$/.test(idRaw)) {
    return usersColl
      .findOne({ _id: new ObjectId(idRaw) })
      .then((u) => {
        if (!u) return sessionUser.username ?? sessionUser.email ?? "cashier";
        const dn = String(u.displayName ?? "").trim();
        if (dn !== "") return dn;
        if (u.username) return String(u.username);
        if (u.email) return String(u.email);
        return sessionUser.username ?? sessionUser.email ?? "cashier";
      });
  }
  return Promise.resolve(
    sessionUser.username ?? sessionUser.email ?? "cashier"
  );
}

export function transactionService({
  transactionModel,
  sessionModel,
  db,
}) {
  const sessionsColl = db.collection("sessions");
  const transactionsColl = db.collection("transactions");
  const usersColl = db.collection("users");
  const activityLogs = db.collection("activityLogs");

  return {
    /** POST /api/cashier/transactions — create a bill for a closed session. */
    async create({ sessionId, method, received }, actor) {
      if (!sessionId || !/^[0-9a-fA-F]{24}$/.test(String(sessionId))) {
        const err = new Error("sessionId is required");
        err.status = 422;
        throw err;
      }
      if (!["cash", "gcash"].includes(method)) {
        const err = new Error("method must be cash or gcash");
        err.status = 422;
        throw err;
      }
      if (typeof received !== "number" || !Number.isFinite(received)) {
        const err = new Error("received must be a number");
        err.status = 422;
        throw err;
      }
      if (!(received > 0) || received > 1000000) {
        const err = new Error("received must be > 0 and <= 1000000");
        err.status = 422;
        throw err;
      }

      const oid = new ObjectId(sessionId);
      const session = await sessionsColl.findOne({ _id: oid });
      if (!session) {
        const err = new Error("session not found");
        err.status = 404;
        throw err;
      }
      if (session.status !== "closed") {
        const err = new Error(
          "session must be closed before billing (end it first)"
        );
        err.status = 422;
        throw err;
      }
      const dup = await transactionsColl.findOne({ sessionId: oid });
      if (dup) {
        const err = new Error(
          `session already billed (${dup.ref ?? "billed"})`
        );
        err.status = 409;
        throw err;
      }

      const start = session.startTime instanceof Date ? session.startTime : null;
      if (!start) {
        const err = new Error(
          "session has no start time and cannot be billed"
        );
        err.status = 422;
        throw err;
      }
      const until =
        session.closedAt instanceof Date
          ? new Date(session.closedAt)
          : new Date();
      const secs = (until.getTime() - start.getTime()) / 1000;
      const price =
        session.pricePerHour != null ? session.pricePerHour : 140;
      const hours = billedHours(secs);
      const total = round2(hours * price);
      const rateType = session.rateType ?? null;
      if (received < total) {
        const err = new Error(
          `short payment: received ${received} < total ${total}`
        );
        err.status = 422;
        throw err;
      }
      const change = round2(received - total);

      const now = new Date();
      let inserted = null;
      for (let i = 0; i < MAX_REF_RETRIES; i++) {
        const ref = refOnce();
        if ((await transactionsColl.findOne({ ref })) === null) {
          try {
            const res = await transactionsColl.insertOne({
              ref,
              sessionId: oid,
              tableId: session.tableId ?? null,
              tableName: session.tableName ?? "",
              customerName: session.customerName ?? "",
              cashierId: actor && actor.id ? String(actor.id) : "",
              cashierName: await actorName(actor, usersColl),
              minutes: Math.ceil(Math.max(0, secs) / 60),
              billedHours: hours,
              pricePerHour: price,
              rateType: rateType,
              total: total,
              method: method,
              received: received,
              change: change,
              paidAt: now,
              createdAt: now,
            });
            inserted = res.insertedId;
            break;
          } catch (e) {
            const msg = String(e && e.message ? e.message : e);
            if (msg.includes("sessionId")) {
              const err = new Error("session already billed");
              err.status = 409;
              throw err;
            }
            continue;
          }
        }
      }
      if (!inserted) {
        const err = new Error(
          "could not generate a unique reference, try again"
        );
        err.status = 500;
        throw err;
      }

      await activityLogs.insertOne({
        actorId: actor && actor.id ? String(actor.id) : "",
        action: "payment_record",
        target: String(inserted),
        sessionId: sessionId,
        total: total,
        method: method,
        at: new Date(),
      });
      const doc = await transactionModel.findById(inserted);
      return { ok: true, transaction: transactionShape(doc) };
    },

    /** GET /api/cashier/transactions + GET /api/admin/transactions */
    async list({ from, to, method, limit = 200 } = {}) {
      const filter = {};
      const range = {};
      if (from) {
        const d = parseDay(from, "from");
        if (d) range.$gte = d;
      }
      if (to) {
        const d = parseDay(to, "to");
        if (d) range.$lt = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      }
      if (Object.keys(range).length > 0) filter.paidAt = range;
      if (method && ["cash", "gcash"].includes(method)) {
        filter.method = method;
      }
      const docs = await transactionModel.list(filter, { limit });
      return { ok: true, transactions: docs.map(transactionShape) };
    },

    /** GET /api/cashier/transactions/{ref} + GET /api/admin/transactions/{ref} */
    async get(ref) {
      if (!ref) {
        const err = new Error("ref is required");
        err.status = 422;
        throw err;
      }
      const doc = await transactionModel.findByRef(ref);
      if (!doc) {
        const err = new Error("transaction not found");
        err.status = 404;
        throw err;
      }
      return { ok: true, transaction: transactionShape(doc) };
    },
  };

  function parseDay(raw, field) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
      const err = new Error(`${field} must be YYYY-MM-DD`);
      err.status = 422;
      throw err;
    }
    const d = new Date(Date.UTC(
      Number(raw.slice(0, 4)),
      Number(raw.slice(5, 7)) - 1,
      Number(raw.slice(8, 10))
    ));
    if (isNaN(d.getTime())) {
      const err = new Error(`${field} must be YYYY-MM-DD`);
      err.status = 422;
      throw err;
    }
    return d;
  }
}

function transactionShape(doc) {
  return {
    id: doc._id != null ? String(doc._id) : null,
    ref: doc.ref ?? "",
    sessionId: doc.sessionId != null ? String(doc.sessionId) : null,
    tableId: doc.tableId != null ? String(doc.tableId) : null,
    tableName: doc.tableName ?? "—",
    customerName: doc.customerName ?? "",
    cashierId: doc.cashierId != null ? String(doc.cashierId) : null,
    cashierName: doc.cashierName ?? "—",
    minutes: doc.minutes != null ? doc.minutes : 0,
    billedHours: doc.billedHours != null ? doc.billedHours : 0,
    pricePerHour: doc.pricePerHour != null ? doc.pricePerHour : 0,
    rateType: doc.rateType ?? null,
    total: doc.total != null ? doc.total : 0,
    method: doc.method ?? "",
    received: doc.received != null ? doc.received : 0,
    change: doc.change != null ? doc.change : 0,
    paidAt: doc.paidAt instanceof Date ? doc.paidAt.toISOString() : null,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null,
  };
}
