// Shared bill math for sessions + F&B (Sprint 5).
// One source of truth so the order sheet, payment flow, receipts and reports
// all agree: session charge uses the existing per-hour rule (1-hour minimum),
// F&B totals sum the line snapshots, and the grand total is rounded once.
import { round2 } from "./numbers.js";

const RATE_FALLBACK = 140;

/** Billable whole hours: minimum 1, ceiling of elapsed time. */
export function billedHours(seconds) {
  const secs = seconds < 0 ? 0 : seconds;
  return Math.max(1, Math.ceil(secs / 3600));
}

/** Snapshot line list embedded on a session (never product lookups). */
export function fnbItems(session) {
  const lines = Array.isArray(session && session.fnbOrders)
    ? session.fnbOrders
    : [];
  return lines.map((line) => ({
    productId: line.productId != null ? String(line.productId) : null,
    name: String(line.name ?? ""),
    category: String(line.category ?? "other"),
    unitPrice: round2(Number(line.unitPrice ?? 0)),
    qty: Number(line.qty ?? 0),
    lineTotal: round2(Number(line.lineTotal ?? 0)),
  }));
}

/** Sum of stored line totals, rounded to centavos. */
export function fnbTotalOf(session) {
  return round2(fnbItems(session).reduce((sum, line) => sum + line.lineTotal, 0));
}

/**
 * Session charge for a closed (or closing) session. Mirrors the Sprint 3
 * payment math: elapsed seconds from startTime to closedAt, ceiling hours,
 * price snapshot (fallback 140).
 */
export function sessionCharge(session, until = null) {
  if (!session || !(session.startTime instanceof Date)) return 0;
  const end = until instanceof Date
    ? until
    : session.closedAt instanceof Date
      ? session.closedAt
      : new Date();
  const secs = (end.getTime() - session.startTime.getTime()) / 1000;
  const hours = billedHours(secs);
  const rate = session.pricePerHour != null ? session.pricePerHour : RATE_FALLBACK;
  return round2(hours * rate);
}

/** {sessionTotal, fnbTotal, total} for a closed session. */
export function billTotals(session, until = null) {
  const sessionTotal = sessionCharge(session, until);
  const fnbTotal = fnbTotalOf(session);
  return {
    sessionTotal,
    fnbTotal,
    total: round2(sessionTotal + fnbTotal),
  };
}
