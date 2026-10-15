# Sprint 3 — Plan: Transactions & Payments (with Session Visibility)

Date: 2026-10-15
Status: planned, frozen
Base: `integration` branch. Previous sprints: Sprint 1 (identity/staff), Sprint 2 (tables/rates/sessions foundation).

## 1. Goal

Close the cash loop: cashier ends a session → creates a bill → records cash/GCash payment with change → receipt (print-to-PDF). Admin sees transactions, daily income, date filter, CSV export. Session visibility (available/reserved/timer) is hardened, not rebuilt.

## 2. Frozen scope (15 items)

User-requested (10 + AD-11/17/19):

| Code | Requirement (user wording wins) | Matrix mapping |
|---|---|---|
| AD-011 | Administrator should be able to archive billiard tables. | matrix AD-011 — done, regression only |
| AD-017 | Administrator should be able to configure special hourly table rates. | matrix AD-017 — done, regression only |
| AD-019 | Administrator should be able to view daily income reports. | matrix AD-019 — new, built here |
| CU-002 | Customer should be able to view available tables | matrix CU-002 — polish only |
| CA-004 | Cashier should be able to start a customer session | matrix CA-006 — backend done, harden |
| CA-005 | Cashier should be able to extend a customer session | matrix CA-009 — backend done, harden |
| CA-006 | Cashier should be able to view the running timer | matrix CA-010 — UI done, harden |
| AD-020 | Administrator should be able to view transactions | matrix AD-025 — new |
| AD-021 | Administrator should be able to export reports | matrix AD-024 — new (CSV + print-PDF) |
| CA-011 | Cashier should be able to view reserved tables | matrix CA-017 subset — polish only |

Added (5, payment-closers from matrix CA-020..CA-025):

| Code | Requirement |
|---|---|
| CA-020 | Cashier should be able to create a customer bill containing session charges (no F&B yet) |
| CA-022 | Cashier should be able to record the payment method and amount received (`cash` / `gcash` only) |
| CA-023 | System should calculate and display change when received exceeds total; reject short payment (422) |
| CA-024 | System should generate a unique transaction reference for a completed payment (`GH-YYYYMMDD-XXXX`) |
| CA-025 | Cashier should be able to generate/print a customer receipt (print CSS → Save-as-PDF, no new dep) |

Supporting (no new code, reused): CA-013 session history, CA-014 per-minute charge, AD-023 date-range filter (implemented as `?from&to` on lists), CA-033 activity logging.

Out: reservations overlap (CU-008), F&B catalog, monthly/usage/hours reports, server-side PDF lib (`dompdf` stays in `docs/02-API-integration.md` backlog).

## 3. Design decisions (frozen)

1. `transactions` is a new collection, one doc per paid `sessionId`. No F&B fields yet (forward-compatible: `items: []` reserved, unused).
2. Billing = close-out then pay (two steps): `POST /api/cashier/sessions/{id}/end` → `POST /api/cashier/transactions`. Prevents double-billing.
3. Total reuses `sessions_charge()`: `round(elapsedSecs / 3600 * pricePerHour_snapshot, 2)`. Snapshot rate stored on session at start; transaction copies it.
4. Receipt PDF = printable HTML + `window.print()` → Save-as-PDF. No Composer/NPM dep, keeps no-build rule.
5. Role from session only. Cashier creates, admin reads. `GET /api/me` guard on every page.

### 3.1 `transactions` schema

```js
{
  ref: "GH-20261015-A3F9",      // unique, generated server-side
  sessionId: ObjectId,           // unique (one bill per session)
  tableId: ObjectId,
  tableName: string,             // denormalized
  customerName: string,
  cashierId: string,
  cashierName: string,           // denormalized
  minutes: number,               // actual elapsed, ceil minutes for display
  pricePerHour: number,          // snapshot copy
  total: number,                 // computed
  method: "cash" | "gcash",
  received: number,
  change: number,                // received - total
  paidAt: UTCDateTime,
  createdAt: UTCDateTime
}
```

Indexes (one-time setup script, never per-request): unique `ref`, unique `sessionId`, compound `{paidAt: 1, method: 1}`.

## 4. Routes

Existing (reuse, no change): `Backend/routes/api.php:66-76` — `GET /api/cashier/sessions`, `POST /api/cashier/sessions`, `POST .../extend`, `POST .../end`, `POST .../cancel`, `GET /api/cashier/tables`, `GET /api/tables/availability`, `GET /api/admin/sessions`.

New (add to `routes/api.php` + `Frontend/js/api.js`):

* `POST /api/cashier/transactions` → `transactions_create` (`Backend/src/function/cashiers/transactions.php`, new). Body `{sessionId, method, received}`. Guards: `require_login`; session must exist + `status=closed` else 422; duplicate `sessionId` → 409; `method` allow-list else 422; `received < total` → 422; else insert + `activityLogs {action:"payment_record"}`.
* `GET /api/cashier/transactions?from&to` → `transactions_cashier_list` (same file, `require_login`).
* `GET /api/admin/transactions?from&to&method` → `transactions_list` (`Backend/src/function/admin/transactions.php` or same file with `require_admin`). Shape identical.
* `GET /api/admin/reports/daily?date=YYYY-MM-DD` → `reports_daily` (`Backend/src/function/admin/reports.php`, new). Returns `{date, count, gross, byMethod:{cash,gross,count}}` aggregated from `transactions.paidAt` (UTC day).
* `GET /api/admin/reports/export?format=csv&from&to&method` → `reports_export` (same file). CSV with header `ref,paidAt,table,customer,cashier,minutes,rate,total,method,received,change`. `Content-Disposition: attachment`.
* Receipt: no new API; frontend reuses transaction object + `GET` single (`GET /api/cashier/transactions/{ref}` and admin twin, optional if time).

## 5. Backend tasks

1. `Backend/src/function/cashiers/transactions.php` (new): `transactions_create`, `transactions_cashier_list`, `transactions_ref()` generator (date prefix + 4-char upper alnum, retry on collision), `transactions_shape()`.
2. `Backend/src/function/admin/reports.php` (new): `reports_daily`, `reports_export`. Date parsing strict `YYYY-MM-DD`; invalid → 422. CSV streamed with `fputcsv(php://output)`.
3. One-time script `Backend/scripts/setup_transactions_indexes.php` (new, run once): create the three indexes above. Never in request path (per AGENTS.md).
4. `activityLogs` writes for `payment_record` (CA-033). List endpoints project no secrets (no hashes in this domain anyway).
5. Validation allow-list: `method` exactly `cash|gcash`; `received` numeric > 0, max 1,000,000; `sessionId` 24-hex else 422.

## 6. Frontend tasks

1. `Frontend/src/function/cashiers/cashier-dashboard.js` (extend): End → billing modal via `dashConfirm`/`dashPrompt`/`dashSelect` (no native popups): show `total`, select method, input received, live change preview, confirm → `createTransaction()` → success panel with `ref + change` + Print button. Existing start form + timer + tabs (`cashier-dashboard.html:62-148`) untouched except wiring.
2. `Frontend/src/function/admin/transactions.html` (new) + `.js`: guard `getMe()` admin-only, date-range + method filter, daily-income header card (`getDailyReport()`), table `ref|paid|table|customer|total|method|change`, Export CSV button (builds `API_BASE_URL + /api/admin/reports/export?...` with `credentials:include` — use anchor, not `api()` JSON parse), receipt print link per row.
3. `Frontend/src/function/shared/receipt.html` (new) + `.js`: renders one transaction printable, `window.print()` button, print CSS in `dashboard.css` (hide nav on `@media print`).
4. `Frontend/js/api.js` (extend): `createTransaction(sessionId, method, received)`, `listTransactions(params, admin=true)`, `getDailyReport(date)`. Export stays URL-based.
5. `CU-002` polish (`Frontend/index.html:58-67` + `js/tables-public.js`): empty state ("No tables right now"), error state, 30s refresh keep. `CA-011` verify `?status=reserved` tab.

## 7. Execution order

1. Step 1 — Billing create (`CA-020/022/023/024`): backend `transactions_create` + indexes script + curl verify.
2. Step 2 — Lists + daily (`AD-020/019`, `AD-023` filter): both list endpoints + `reports_daily` + admin page shell.
3. Step 3 — Export + receipt (`AD-021/CA-025`): CSV endpoint + print receipt.
4. Step 4 — Harden visibility/lifecycle (`CU-002/CA-004/005/006/CA-011`, `AD-011/017` regression): no schema change, UI/validation only.
5. Step 5 — QA + merge (see §9).

## 8. File ownership (no overlap)

* Backend transactions: `src/function/cashiers/transactions.php` + `src/function/admin/transactions.php` (or single file if small).
* Backend reports: `src/function/admin/reports.php`.
* Frontend cashier: `cashier-dashboard.js` billing modal only.
* Frontend admin: `admin/transactions.html/.js` + `shared/receipt.html/.js`.
* Shared: `js/api.js` additions, `routes/api.php` 5 lines.

## 9. Verify + Done criteria

Manual (no automated suite, per AGENTS.md):

1. `GET /api/health` → `{ok:true}` baseline unbroken.
2. Start session on available table → 200; double-start same table → 409; extend +60 → `endTime` pushed; timer ticks down, overtime red.
3. End → `amount` returned; `POST /api/cashier/transactions {method:cash, received: exact}` → 200 with `ref GH-*`, `change 0`; duplicate same `sessionId` → 409; `received < total` → 422; `method:card` → 422.
4. `GET /api/admin/transactions?from&to` shows bill; `GET /api/admin/reports/daily?date=today` `gross` equals sum; CSV downloads and opens in Sheets; receipt prints to PDF via dialog.
5. `CU-002` landing shows available count; cashier Tables tab `reserved` filters; archived tables never appear in play flows.
6. Atlas: `transactions` doc has `ref/sessionId/total/method/received/change/paidAt`; `activityLogs` has `payment_record`; `users.passwordHash` never in any list response.
7. Logout → `/api/me` 401; cashier on admin route 403.

Accept `ref` format `GH-YYYYMMDD-XXXX` and per-second billing (display ceil minutes) unless changed before Step 1.

## 10. Risks

* Timezone: `paidAt` stored UTC; daily buckets UTC. If hall wants Asia/Manila day cut, add `?tz` next sprint — out for now.
* `php -S` single-threaded: 185–1200ms reads normal; don't optimize queries.
* Open frontend via `http://localhost:5500` only (session cookie `Lax` on `localhost`).
