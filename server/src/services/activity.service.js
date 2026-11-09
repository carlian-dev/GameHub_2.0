// Activity service — read-only audit trail for the admin (AD-026).
// Logs are written by the services that own each action; this service only
// filters them and joins actor/target user names for display.
import { isISODate } from "../utils/dates.js";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function manilaDay(value, field) {
  if (!isISODate(value)) throw httpError(422, `${field} must be YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(`${value}T00:00:00.000+08:00`);
  const check = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  // Date() rolls impossible days over (2026-02-30 -> Mar 2); reject them.
  if (
    Number.isNaN(date.getTime()) ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw httpError(422, `${field} must be a valid date`);
  }
  return date;
}

function dateFilter({ from, to }) {
  // The hall runs on Asia/Manila time (UTC+8, no DST). Calendar-day filters
  // must match the times the admin sees in the browser, not UTC boundaries.
  const range = {};
  if (from) range.$gte = manilaDay(from, "from");
  if (to) {
    // Exclusive next-day boundary so the whole `to` Manila day is included.
    range.$lt = new Date(manilaDay(to, "to").getTime() + DAY_MS);
  }
  if (range.$gte && range.$lt && range.$gte >= range.$lt) {
    throw httpError(422, "from must be on or before to");
  }
  return range;
}

function userLabel(doc) {
  if (!doc) return null;
  return doc.displayName || doc.username || doc.email || null;
}

function shape(doc, usersById) {
  const actorId = doc.actorId == null ? null : String(doc.actorId);
  const target = doc.target == null ? null : String(doc.target);
  const actor = actorId ? usersById.get(actorId) : null;
  const targetUser = target ? usersById.get(target) : null;

  // Extra fields (sessionTotal, method, productName, changedFields, meta, ...)
  // travel together so the UI can explain the action without extra queries.
  const meta = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === "_id" || key === "actorId" || key === "action" || key === "target" || key === "at") {
      continue;
    }
    if (key === "meta" && value && typeof value === "object") {
      Object.assign(meta, value);
    } else {
      meta[key] = value;
    }
  }

  let actorName = userLabel(actor) || actorId || "Guest";
  if (!actor && actorId === "system") actorName = "System";

  return {
    id: String(doc._id),
    action: doc.action ?? "",
    actorId,
    actorName,
    actorUsername: actor ? actor.username ?? null : null,
    actorEmail: actor ? actor.email ?? null : null,
    actorRole: actor ? actor.role ?? null : null,
    target,
    targetName: userLabel(targetUser),
    at: doc.at instanceof Date ? doc.at.toISOString() : null,
    meta,
  };
}

export function activityService({ activityModel, userModel }) {
  return {
    /** GET /api/admin/activity-logs — newest first. */
    async list({ action, actorId, from, to, limit } = {}) {
      const filter = {};

      const actionText = String(action ?? "").trim();
      if (actionText && actionText !== "all") filter.action = actionText;

      const actorText = String(actorId ?? "").trim();
      if (actorText && actorText !== "all") {
        if (actorText === "system") {
          filter.actorId = "system";
        } else if (actorText === "guest") {
          filter.$or = [
            { actorId: null },
            { actorId: { $exists: false } },
            { actorId: "" },
          ];
        } else {
          filter.actorId = actorText;
        }
      }

      const range = dateFilter({ from, to });
      if (Object.keys(range).length > 0) filter.at = range;

      const requested = Number(limit);
      const take = Number.isFinite(requested)
        ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT)
        : DEFAULT_LIMIT;

      const [docs, total] = await Promise.all([
        activityModel.list(filter, { limit: take }),
        activityModel.count(filter),
      ]);

      const ids = [
        ...new Set(
          docs
            .flatMap((doc) => [doc.actorId, doc.target])
            .filter((id) => id != null)
            .map((id) => String(id))
        ),
      ];
      const users = ids.length > 0 ? await userModel.findByIds(ids) : [];
      const usersById = new Map(users.map((user) => [String(user._id), user]));

      return {
        logs: docs.map((doc) => shape(doc, usersById)),
        total,
        limit: take,
      };
    },
  };
}
