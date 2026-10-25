// Session service — business rules for session lifecycle.
// migration.md §13.4: start/extend/end/cancel with table side effects,
// rate snapshot (18:00-23:59 Asia/Manila = special), per-hour billing.
import { ObjectId } from "mongodb";
import { round2 } from "../utils/numbers.js";

const RATE_FALLBACK = 140;
const MIN_DURATION = 60;
const MAX_DURATION = 1440;
const MAX_EXTRA = 720;
const MAX_PLANNED = 1440;

/** Get the hour (0-23) in Asia/Manila for a UTC Date. */
function manilaHour(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour");
  return hourPart ? parseInt(hourPart.value, 10) : 0;
}

function rateTypeForStart(start) {
  return manilaHour(start) >= 18 ? "special" : "regular";
}

function billedHours(secs) {
  if (secs < 0) secs = 0;
  return Math.max(1, Math.ceil(secs / 3600));
}

function charge(doc, until) {
  if (!doc.startTime) return 0;
  const secs = (until.getTime() - doc.startTime.getTime()) / 1000;
  const hours = billedHours(secs);
  const rate = doc.pricePerHour != null ? doc.pricePerHour : RATE_FALLBACK;
  return round2(hours * rate);
}

function actorName(userDoc, sessionUser) {
  if (userDoc) {
    const dn = String(userDoc.displayName ?? "").trim();
    if (dn !== "") return dn;
    if (userDoc.username) return String(userDoc.username);
    if (userDoc.email) return String(userDoc.email);
  }
  return sessionUser.username ?? sessionUser.email ?? "cashier";
}

export function sessionService({
  sessionModel,
  tableModel,
  userModel,
  rateModel,
  db,
}) {
  const sessionsColl = db.collection("sessions");
  const tablesColl = db.collection("tables");
  const usersColl = db.collection("users");
  const activityLogs = db.collection("activityLogs");

  return {
    /** GET /api/admin/sessions + GET /api/cashier/sessions */
    async list({ status = "active", limit = 200 } = {}) {
      const filter = {};
      if (status === "all") {
        // no status filter
      } else if (["active", "closed", "cancelled"].includes(status)) {
        filter.status = status;
      } else {
        // Unknown value: fall back to active (same convention as tables/cashiers).
        filter.status = "active";
      }
      const docs = await sessionModel.list(filter, { limit });
      const tableIds = [];
      const userIds = [];
      const tableMap = {};
      const userMap = {};
      for (const d of docs) {
        if (d.tableId instanceof ObjectId) tableIds.push(String(d.tableId));
        if (d.cashierId) userIds.push(String(d.cashierId));
      }
      if (tableIds.length) {
        const tables = await tablesColl.find({
          _id: { $in: tableIds.map((id) => new ObjectId(id)) },
        }).toArray();
        for (const t of tables) {
          tableMap[String(t._id)] = t.name ?? String(t._id);
        }
      }
      const validUserIds = userIds.filter((id) =>
        /^[0-9a-fA-F]{24}$/.test(id)
      );
      if (validUserIds.length) {
        const users = await usersColl
          .find(
            { _id: { $in: validUserIds.map((id) => new ObjectId(id)) } },
            { projection: { displayName: 1, username: 1, email: 1 } }
          )
          .toArray();
        for (const u of users) {
          const id = String(u._id);
          userMap[id] =
            String(u.displayName ?? "").trim() ||
            String(u.username ?? u.email ?? id);
        }
      }
      return {
        ok: true,
        sessions: docs.map((d) => ({
          id: String(d._id),
          tableId: d.tableId != null ? String(d.tableId) : null,
          tableName:
            d.tableName ??
            (d.tableId != null ? (tableMap[String(d.tableId)] ?? "—") : "—"),
          customerName: d.customerName ?? "",
          cashierId: d.cashierId != null ? String(d.cashierId) : null,
          cashierName:
            d.cashierName ??
            (d.cashierId != null ? (userMap[String(d.cashierId)] ?? "—") : "—"),
          startTime:
            d.startTime instanceof Date ? d.startTime.toISOString() : null,
          endTime: d.endTime instanceof Date ? d.endTime.toISOString() : null,
          plannedMinutes: d.plannedMinutes ?? 0,
          status: d.status ?? "",
          pricePerHour:
            d.pricePerHour != null ? d.pricePerHour : null,
          rateType: d.rateType ?? null,
          closedAt:
            d.closedAt instanceof Date ? d.closedAt.toISOString() : null,
        })),
      };
    },

    /** POST /api/cashier/sessions — start a walk-in session. */
    async start({ tableId, customerName, durationMinutes, hours, minutes },
      actor) {
      if (!tableId || !/^[0-9a-fA-F]{24}$/.test(String(tableId))) {
        const err = new Error("tableId is required");
        err.status = 422;
        throw err;
      }
      const customer = String(customerName ?? customer ?? "").trim();
      if (customer === "" || customer.length > 60) {
        const err = new Error("customer name is required (max 60 chars)");
        err.status = 422;
        throw err;
      }
      let dur = durationMinutes;
      if (dur == null && (hours != null || minutes != null)) {
        dur = Number(hours || 0) * 60 + Number(minutes || 0);
      }
      dur = Number.isFinite(Number(dur)) ? Number(dur) : 0;
      if (dur < MIN_DURATION || dur > MAX_DURATION) {
        const err = new Error(
          "duration must be 60 to 1440 minutes (1-hour minimum, per-hour)"
        );
        err.status = 422;
        throw err;
      }

      const oid = new ObjectId(tableId);
      const table = await tablesColl.findOne({ _id: oid });
      if (!table) {
        const err = new Error("table not found");
        err.status = 404;
        throw err;
      }
      if (table.archived) {
        const err = new Error("archived tables cannot start sessions");
        err.status = 422;
        throw err;
      }
      if ((table.status ?? "available") !== "available") {
        const err = new Error(
          `table is not available (current: ${table.status ?? "?"})`
        );
        err.status = 409;
        throw err;
      }
      const existing = await sessionsColl.findOne({
        tableId: oid,
        status: "active",
      });
      if (existing) {
        const err = new Error("table already has an active session");
        err.status = 409;
        throw err;
      }

      const actorId = actor && actor.id ? String(actor.id) : "";
      let actorDoc = null;
      if (actorId && /^[0-9a-fA-F]{24}$/.test(actorId)) {
        actorDoc = await usersColl.findOne({ _id: new ObjectId(actorId) });
      }
      const cashierName = actorName(actorDoc, actor);

      const start = new Date();
      const rateType = rateTypeForStart(start);
      const rateDoc = await rateModel.findByType(rateType);
      const price =
        rateDoc && rateDoc.pricePerHour != null
          ? rateDoc.pricePerHour
          : RATE_FALLBACK;
      const end = new Date(start.getTime() + dur * 60000);

      const insertedId = await sessionModel.insert({
        tableId: oid,
        tableName: table.name ?? tableId,
        customerName: customer,
        cashierId: actorId,
        cashierName: cashierName,
        startTime: start,
        endTime: end,
        plannedMinutes: dur,
        status: "active",
        pricePerHour: price,
        rateType: rateType,
        createdAt: start,
        updatedAt: start,
      });
      await tablesColl.updateOne(
        { _id: oid },
        { $set: { status: "occupied" } }
      );
      await activityLogs.insertOne({
        actorId,
        action: "session_start",
        target: String(insertedId),
        at: new Date(),
      });
      const doc = await sessionModel.findById(insertedId);
      return { ok: true, session: sessionShape(doc) };
    },

    /** POST /api/cashier/sessions/{id}/extend */
    async extend(id, extraMinutes, minutesParam, actor) {
      const extra =
        extraMinutes != null
          ? Number(extraMinutes)
          : Number(minutesParam ?? 0);
      if (
        !Number.isFinite(extra) ||
        extra < 60 ||
        extra > MAX_EXTRA ||
        extra % 60 !== 0
      ) {
        const err = new Error(
          "extraMinutes must be 60, 120, 180, up to 720 (1-hour minimum, per-hour only)"
        );
        err.status = 422;
        throw err;
      }
      const doc = await sessionModel.findById(id);
      if (!doc) {
        const err = new Error("session not found");
        err.status = 404;
        throw err;
      }
      if (doc.status !== "active") {
        const err = new Error("only active sessions can be extended");
        err.status = 422;
        throw err;
      }
      const newPlanned = (doc.plannedMinutes ?? 0) + extra;
      if (newPlanned > MAX_PLANNED) {
        const err = new Error(
          "total planned time cannot exceed 1440 minutes (24h)"
        );
        err.status = 422;
        throw err;
      }
      const curEnd = doc.endTime instanceof Date
        ? new Date(doc.endTime)
        : new Date(doc.startTime);
      const newEnd = new Date(curEnd.getTime() + extra * 60000);
      await sessionModel.update(id, {
        endTime: newEnd,
        plannedMinutes: newPlanned,
        updatedAt: new Date(),
      });
      const actorId = actor && actor.id ? String(actor.id) : "";
      await activityLogs.insertOne({
        actorId,
        action: "session_extend",
        target: String(doc._id),
        at: new Date(),
      });
      const fresh = await sessionModel.findById(id);
      return { ok: true, session: sessionShape(fresh) };
    },

    /** POST /api/cashier/sessions/{id}/end */
    async end(id, actor) {
      const doc = await sessionModel.findById(id);
      if (!doc) {
        const err = new Error("session not found");
        err.status = 404;
        throw err;
      }
      if (doc.status !== "active") {
        const err = new Error("only active sessions can be ended");
        err.status = 422;
        throw err;
      }
      const now = new Date();
      const chargeAmount = charge(doc, now);
      const secs = now.getTime() - doc.startTime.getTime();
      const hours = billedHours(secs);
      await sessionModel.update(id, {
        status: "closed",
        closedAt: now,
        updatedAt: now,
      });
      await freeTable(doc.tableId);
      const actorId = actor && actor.id ? String(actor.id) : "";
      await activityLogs.insertOne({
        actorId,
        action: "session_end",
        target: String(doc._id),
        at: new Date(),
      });
      const fresh = await sessionModel.findById(id);
      return {
        ok: true,
        amount: chargeAmount,
        billedHours: hours,
        session: sessionShape(fresh),
      };
    },

    /** POST /api/cashier/sessions/{id}/cancel */
    async cancel(id, actor) {
      const doc = await sessionModel.findById(id);
      if (!doc) {
        const err = new Error("session not found");
        err.status = 404;
        throw err;
      }
      if (doc.status !== "active") {
        const err = new Error("only active sessions can be voided");
        err.status = 422;
        throw err;
      }
      const now = new Date();
      await sessionModel.update(id, {
        status: "cancelled",
        closedAt: now,
        updatedAt: now,
      });
      await freeTable(doc.tableId);
      const actorId = actor && actor.id ? String(actor.id) : "";
      await activityLogs.insertOne({
        actorId,
        action: "session_cancel",
        target: String(doc._id),
        at: new Date(),
      });
      const fresh = await sessionModel.findById(id);
      return { ok: true, session: sessionShape(fresh) };
    },
  };

  async function freeTable(tableId) {
    if (!(tableId instanceof ObjectId)) return;
    const t = await tablesColl.findOne({ _id: tableId });
    if (!t || t.archived) return;
    if (t.status === "occupied") {
      await tablesColl.updateOne({ _id: tableId }, { $set: { status: "available" } });
    }
  }

  function sessionShape(doc) {
    return {
      id: String(doc._id),
      tableId: doc.tableId != null ? String(doc.tableId) : null,
      tableName: doc.tableName ?? "",
      customerName: doc.customerName ?? "",
      cashierId: doc.cashierId != null ? String(doc.cashierId) : null,
      cashierName: doc.cashierName ?? "",
      startTime:
        doc.startTime instanceof Date ? doc.startTime.toISOString() : null,
      endTime: doc.endTime instanceof Date ? doc.endTime.toISOString() : null,
      plannedMinutes: doc.plannedMinutes ?? 0,
      status: doc.status ?? "",
      pricePerHour:
        doc.pricePerHour != null ? doc.pricePerHour : null,
      rateType: doc.rateType ?? null,
      closedAt:
        doc.closedAt instanceof Date ? doc.closedAt.toISOString() : null,
    };
  }
}

export { billedHours, charge, rateTypeForStart, manilaHour };
