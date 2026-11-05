// Transaction service — billing + payment close-out.
// Sprint 3 flow extended with F&B (Sprint 5): one payment covers
// session charge + F&B subtotal, and the transaction stores item snapshots.
// Guards: closed session, one transaction per session (unique sessionId),
// short payment (422), duplicate payment (409), and a session-level billing
// lock so an order edit can never land after the total is computed.
import { ObjectId } from "mongodb";
import { round2 } from "../utils/numbers.js";
import { billedHours, billTotals, fnbItems } from "../utils/billing.js";

const REF_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_REF_RETRIES = 5;
const LOCK_STALE_MS = 5 * 60 * 1000;

function refOnce() {
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += REF_CHARS[Math.floor(Math.random() * 36)];
  }
  return `GH-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${suffix}`;
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
  sessionService,
  db,
}) {
  const sessionsColl = db.collection("sessions");
  const transactionsColl = db.collection("transactions");
  const usersColl = db.collection("users");
  const activityLogs = db.collection("activityLogs");

  async function releaseLock(oid) {
    await sessionsColl.updateOne(
      { _id: oid, paidTransactionRef: { $exists: false } },
      { $set: { billingLocked: false, billingLockedAt: null } }
    );
  }

  async function lockSession(oid, now) {
    const staleBefore = new Date(now.getTime() - LOCK_STALE_MS);
    return await sessionsColl.updateOne(
      {
        _id: oid,
        status: "closed",
        $or: [
          { billingLocked: { $ne: true } },
          { billingLockedAt: { $lt: staleBefore } },
        ],
      },
      { $set: { billingLocked: true, billingLockedAt: now } }
    );
  }

  async function explainLockFailure(oid) {
    const fresh = await sessionsColl.findOne({ _id: oid });
    if (!fresh) {
      const err = new Error("session not found");
      err.status = 404;
      throw err;
    }
    if (fresh.status !== "closed") {
      const err = new Error(
        "session must be closed before billing (end it first)"
      );
      err.status = 422;
      throw err;
    }
    const dup = await transactionsColl.findOne({ sessionId: oid });
    if (dup) {
      const err = new Error(`session already billed (${dup.ref ?? "billed"})`);
      err.status = 409;
      throw err;
    }
    const err = new Error("payment is in progress, try again");
    err.status = 409;
    throw err;
  }

  return {
    /** POST /api/cashier/transactions — bill session + F&B in one payment. */
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

      // Converge an expired session before billing (auto-end edge case).
      try {
        if (sessionService && typeof sessionService.autoEndExpired === "function") {
          await sessionService.autoEndExpired();
        }
      } catch {
        // fall through: the read below reports the truth
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
        const err = new Error(`session already billed (${dup.ref ?? "billed"})`);
        err.status = 409;
        throw err;
      }

      const now = new Date();
      const lock = await lockSession(oid, now);
      if (lock.modifiedCount !== 1) {
        await explainLockFailure(oid);
      }

      // Once the lock is held no order edit can change the bill, so the
      // totals computed from this fresh read are exactly what gets stored.
      const locked = await sessionsColl.findOne({ _id: oid });
      if (!locked) {
        await releaseLock(oid);
        const err = new Error("session not found");
        err.status = 404;
        throw err;
      }

      let insertedId = null;
      let insertedRef = "";
      let sessionTotal = 0;
      let fnbTotal = 0;
      let grandTotal = 0;
      let hours = 0;
      let secs = 0;
      let price = 0;
      let items = [];

      try {
        const start = locked.startTime instanceof Date ? locked.startTime : null;
        if (!start) {
          const err = new Error(
            "session has no start time and cannot be billed"
          );
          err.status = 422;
          throw err;
        }
        const until =
          locked.closedAt instanceof Date
            ? new Date(locked.closedAt)
            : new Date();
        secs = (until.getTime() - start.getTime()) / 1000;
        price = locked.pricePerHour != null ? locked.pricePerHour : 140;
        hours = billedHours(secs);
        const totals = billTotals(locked, until);
        sessionTotal = totals.sessionTotal;
        fnbTotal = totals.fnbTotal;
        grandTotal = totals.total;
        items = fnbItems(locked);

        if (received < grandTotal) {
          const err = new Error(
            `short payment: received ${received} < total ${grandTotal}`
          );
          err.status = 422;
          throw err;
        }
        const change = round2(received - grandTotal);
        const rateType = locked.rateType ?? null;

        for (let i = 0; i < MAX_REF_RETRIES; i++) {
          const ref = refOnce();
          if ((await transactionsColl.findOne({ ref })) !== null) continue;
          try {
            const res = await transactionsColl.insertOne({
              ref,
              sessionId: oid,
              tableId: locked.tableId ?? null,
              tableName: locked.tableName ?? "",
              customerName: locked.customerName ?? "",
              cashierId: actor && actor.id ? String(actor.id) : "",
              cashierName: await actorName(actor, usersColl),
              minutes: Math.ceil(Math.max(0, secs) / 60),
              billedHours: hours,
              pricePerHour: price,
              rateType: rateType,
              sessionTotal,
              fnbTotal,
              total: grandTotal,
              items,
              method: method,
              received: received,
              change: change,
              paidAt: now,
              createdAt: now,
            });
            insertedId = res.insertedId;
            insertedRef = ref;
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

        if (!insertedId) {
          const err = new Error(
            "could not generate a unique reference, try again"
          );
          err.status = 500;
          throw err;
        }
      } catch (e) {
        if (!insertedId) await releaseLock(oid);
        throw e;
      }

      await sessionsColl.updateOne(
        { _id: oid },
        {
          $set: {
            billingLocked: true,
            paidTransactionRef: insertedRef,
            updatedAt: now,
          },
        }
      );
      await activityLogs.insertOne({
        actorId: actor && actor.id ? String(actor.id) : "",
        action: "payment_record",
        target: String(insertedId),
        sessionId: sessionId,
        sessionTotal,
        fnbTotal,
        total: grandTotal,
        method: method,
        at: new Date(),
      });
      const doc = await transactionModel.findById(insertedId);
      return { ok: true, transaction: transactionShape(doc) };
    },

    /** GET /api/cashier/transactions + GET /api/admin/transactions */
    async list({ from, to, month, method, limit = 200 } = {}) {
      const filter = {};
      const range = {};
      if (month) {
        const [y, m] = String(month).split("-").map(Number);
        if (m < 1 || m > 12) {
          const err = new Error("month must be YYYY-MM");
          err.status = 422;
          throw err;
        }
        range.$gte = new Date(Date.UTC(y, m - 1, 1));
        range.$lt = new Date(Date.UTC(y, m, 1));
      } else {
        if (from) {
          const d = parseDay(from, "from");
          if (d) range.$gte = d;
        }
        if (to) {
          const d = parseDay(to, "to");
          if (d) range.$lt = new Date(d.getTime() + 24 * 60 * 60 * 1000);
        }
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
  const total = doc.total != null ? doc.total : 0;
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
    sessionTotal: doc.sessionTotal != null ? doc.sessionTotal : total,
    fnbTotal: doc.fnbTotal != null ? doc.fnbTotal : 0,
    total: total,
    items: Array.isArray(doc.items)
      ? doc.items.map((item) => ({
          productId:
            item.productId != null ? String(item.productId) : null,
          name: item.name ?? "",
          category: item.category ?? "",
          unitPrice: item.unitPrice != null ? item.unitPrice : 0,
          qty: item.qty != null ? item.qty : 0,
          lineTotal: item.lineTotal != null ? item.lineTotal : 0,
        }))
      : [],
    method: doc.method ?? "",
    received: doc.received != null ? doc.received : 0,
    change: doc.change != null ? doc.change : 0,
    paidAt: doc.paidAt instanceof Date ? doc.paidAt.toISOString() : null,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null,
  };
}
