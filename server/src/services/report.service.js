// Report service — daily income + CSV export.
// migration.md §13.5: daily report (count/gross/byMethod), CSV export.
import { round2 } from "../utils/numbers.js";

export function reportService({ transactionModel }) {
  return {
    /** GET /api/admin/reports/daily */
    async daily({ date } = {}) {
      const day = parseDay(date || new Date().toISOString().slice(0, 10), "date");
      const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);
      const docs = await transactionModel.list({
        paidAt: { $gte: day, $lt: next },
      });
      let count = 0;
      let gross = 0;
      const byMethod = {
        cash: { count: 0, gross: 0 },
        gcash: { count: 0, gross: 0 },
      };
      for (const d of docs) {
        const t = Number(d.total ?? 0);
        count += 1;
        gross += t;
        const m = String(d.method ?? "").toLowerCase();
        if (byMethod[m]) {
          byMethod[m].count += 1;
          byMethod[m].gross += t;
        }
      }
      gross = round2(gross);
      byMethod.cash.gross = round2(byMethod.cash.gross);
      byMethod.gcash.gross = round2(byMethod.gcash.gross);
      return {
        ok: true,
        date: day.toISOString().slice(0, 10),
        count: count,
        gross: gross,
        byMethod: byMethod,
      };
    },

    /** GET /api/admin/reports/export — returns CSV string + filename + headers. */
    async export({ from, to, method } = {}) {
      if (method && !["cash", "gcash"].includes(method)) {
        // fall back to 'all' for invalid method (PHP ignores invalid)
      }
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
      const docs = await transactionModel.list(filter, {
        limit: 5000,
        sort: { paidAt: 1 },
      });

      const fromLabel = from || "all";
      const toLabel = to || "all";
      const fname = `gamehub-transactions-${fromLabel}-to-${toLabel}.csv`.replace(
        /[^A-Za-z0-9._-]/g,
        "_"
      );

      const lines = [];
      lines.push(
        "ref,paidAt,table,customer,cashier,minutes,billedHours,rate,rateType,total,method,received,change"
      );
      for (const d of docs) {
        const paidAt =
          d.paidAt instanceof Date ? d.paidAt.toISOString() : "";
        lines.push([
          d.ref ?? "",
          paidAt,
          d.tableName ?? "",
          d.customerName ?? "",
          d.cashierName ?? "",
          d.minutes ?? 0,
          d.billedHours ?? 0,
          d.pricePerHour ?? 0,
          d.rateType ?? "",
          d.total ?? 0,
          d.method ?? "",
          d.received ?? 0,
          d.change ?? 0,
        ].join(","));
      }
      return {
        filename: fname,
        body: lines.join("\n") + "\n",
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fname}"`,
        },
      };
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
