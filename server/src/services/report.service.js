// Report service — daily income + CSV export.
// migration.md §13.5: daily report (count/gross/byMethod), CSV export.
import { round2 } from "../utils/numbers.js";

function summarize(docs) {
  let count = 0;
  let gross = 0;
  let sessionGross = 0;
  let fnbGross = 0;
  const byMethod = {
    cash: { count: 0, gross: 0 },
    gcash: { count: 0, gross: 0 },
  };
  for (const d of docs) {
    const t = Number(d.total ?? 0);
    // Legacy transactions have no sessionTotal/fnbTotal split: the whole
    // amount is session income and F&B is zero.
    const st = Number(d.sessionTotal != null ? d.sessionTotal : t);
    const ft = Number(d.fnbTotal != null ? d.fnbTotal : 0);
    count += 1;
    gross += t;
    sessionGross += st;
    fnbGross += ft;
    const m = String(d.method ?? "").toLowerCase();
    if (byMethod[m]) {
      byMethod[m].count += 1;
      byMethod[m].gross += t;
    }
  }
  gross = round2(gross);
  sessionGross = round2(sessionGross);
  fnbGross = round2(fnbGross);
  byMethod.cash.gross = round2(byMethod.cash.gross);
  byMethod.gcash.gross = round2(byMethod.gcash.gross);
  return {
    count: count,
    gross: gross,
    sessionGross: sessionGross,
    fnbGross: fnbGross,
    byMethod: byMethod,
  };
}

/** One CSV field: quote only when needed; double embedded quotes. */
function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** "Coke x2 @35.00; Chips x1 @50.00" — empty for legacy transactions. */
function itemSummary(doc) {
  if (!Array.isArray(doc.items) || doc.items.length === 0) return "";
  return doc.items
    .map((item) => {
      const name = String(item.name ?? "");
      const qty = Number(item.qty ?? 0);
      const unit = Number(item.unitPrice ?? 0).toFixed(2);
      return `${name} x${qty} @${unit}`;
    })
    .join("; ");
}

export function reportService({ transactionModel }) {
  return {
    /** GET /api/admin/reports/daily */
    async daily({ date } = {}) {
      const day = parseDay(date || new Date().toISOString().slice(0, 10), "date");
      const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);
      const docs = await transactionModel.list({
        paidAt: { $gte: day, $lt: next },
      });
      return {
        ok: true,
        date: day.toISOString().slice(0, 10),
        ...summarize(docs),
      };
    },

    /** GET /api/admin/reports/monthly — income aggregated for a calendar month (YYYY-MM). */
    async monthly({ month } = {}) {
      const [start, end, label] = parseMonth(month, "month");
      const docs = await transactionModel.list({
        paidAt: { $gte: start, $lt: end },
      });
      return {
        ok: true,
        month: label,
        ...summarize(docs),
      };
    },

    /**
     * GET /api/admin/reports/income — totals for any from/to range
     * (YYYY-MM-DD, both inclusive). Drives the day/month/year income cards.
     */
    async income({ from, to } = {}) {
      const paidAt = {};
      if (from) paidAt.$gte = parseDay(from, "from");
      if (to) {
        paidAt.$lt = new Date(
          parseDay(to, "to").getTime() + 24 * 60 * 60 * 1000
        );
      }
      const docs = await transactionModel.list(
        Object.keys(paidAt).length ? { paidAt } : {}
      );
      return {
        ok: true,
        from: from || null,
        to: to || null,
        ...summarize(docs),
      };
    },

    /** GET /api/admin/reports/export — returns CSV string + filename + headers. */
    async export({ from, to, month, method } = {}) {
      if (method && !["cash", "gcash"].includes(method)) {
        // fall back to 'all' for an unknown method filter
      }
      const filter = {};
      const range = {};
      if (month && !from && !to) {
        const [start, end] = parseMonth(month, "month");
        range.$gte = start;
        range.$lt = end;
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
      const docs = await transactionModel.list(filter, {
        limit: 5000,
        sort: { paidAt: 1 },
      });

      const fromLabel = month || from || "all";
      const toLabel = month ? "month" : to || "all";
      const fname = `gamehub-transactions-${fromLabel}-to-${toLabel}.csv`.replace(
        /[^A-Za-z0-9._-]/g,
        "_"
      );

      const lines = [];
      lines.push(
        "ref,paidAt,table,customer,cashier,minutes,billedHours,rate,rateType,total,method,received,change,sessionTotal,fnbTotal,items"
      );
      for (const d of docs) {
        const paidAt =
          d.paidAt instanceof Date ? d.paidAt.toISOString() : "";
        const total = d.total != null ? d.total : 0;
        const sessionTotal = d.sessionTotal != null ? d.sessionTotal : total;
        const fnbTotal = d.fnbTotal != null ? d.fnbTotal : 0;
        lines.push(
          [
            d.ref ?? "",
            paidAt,
            d.tableName ?? "",
            d.customerName ?? "",
            d.cashierName ?? "",
            d.minutes ?? 0,
            d.billedHours ?? 0,
            d.pricePerHour ?? 0,
            d.rateType ?? "",
            total,
            d.method ?? "",
            d.received ?? 0,
            d.change ?? 0,
            sessionTotal,
            fnbTotal,
            itemSummary(d),
          ]
            .map(csvCell)
            .join(",")
        );
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

  function parseMonth(raw, field) {
    if (!/^\d{4}-\d{2}$/.test(String(raw))) {
      const err = new Error(`${field} must be YYYY-MM`);
      err.status = 422;
      throw err;
    }
    const y = Number(raw.slice(0, 4));
    const m = Number(raw.slice(5, 7));
    if (m < 1 || m > 12) {
      const err = new Error(`${field} month must be 01–12`);
      err.status = 422;
      throw err;
    }
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      const err = new Error(`${field} must be YYYY-MM`);
      err.status = 422;
      throw err;
    }
    return [start, end, `${y}-${String(m).padStart(2, "0")}`];
  }
}
