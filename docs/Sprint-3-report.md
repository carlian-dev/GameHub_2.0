# Sprint 3 — Report: Transactions & Payments (with Session Visibility)

Date: 2026-10-15
Plan: `docs/Sprint-3-plan.md` (frozen, 15 items)
Base: `integration`. Previous: Sprint 1 (identity/staff), Sprint 2 (tables/rates/sessions).

## 1. Result

Cash loop closed: cashier ends a session → billing dialog (method + received +
live change preview) → `GH-YYYYMMDD-XXXX` bill → printable receipt
(print-to-PDF, no new dep). Admin has Transactions page (date-range + method
filter, daily-income cards, CSV export, per-row receipt link). Session
visibility hardened only (no rebuild, no schema change to sessions/tables).

## 2. What was built (plan §4–§6)

**Backend (new)**
- `Backend/src/function/cashiers/transactions.php` — `transactions_create`
  (`POST /api/cashier/transactions`, body `{sessionId, method, received}`),
  `transactions_cashier_list` (`GET /api/cashier/transactions?from&to`),
  `transactions_cashier_get` (`GET /api/cashier/transactions/{ref}`),
  `transactions_admin_list` (`GET /api/admin/transactions?from&to&method`),
  `transactions_admin_get` (`GET /api/admin/transactions/{ref}`),
  `transactions_ref()` (date prefix + 4-char upper alnum, retry on collision),
  `transactions_shape()`. Guards: `require_login` (cashier),
  `require_admin` (admin); session must exist + `status=closed` else 422;
  duplicate `sessionId` → 409; `method` allow-list `cash|gcash` else 422;
  `received` numeric > 0 / ≤ 1,000,000 else 422; `received < total` → 422.
  Total reuses `sessions_charge()` math
  (`round(elapsedSecs/3600*pricePerHour_snapshot,2)`, `closedAt-startTime`,
  `minutes=ceil` for display). Writes `activityLogs {action:"payment_record"}`.
- `Backend/src/function/admin/reports.php` — `reports_daily`
  (`GET /api/admin/reports/daily?date=YYYY-MM-DD`, default today UTC →
  `{date, count, gross, byMethod:{cash:{count,gross},gcash:{count,gross}}}`),
  `reports_export`
  (`GET /api/admin/reports/export?format=csv&from&to&method`, streams
  `text/csv` + `Content-Disposition: attachment`, header
  `ref,paidAt,table,customer,cashier,minutes,rate,total,method,received,change`).
  Strict `YYYY-MM-DD` parsing, invalid → 422.
- `Backend/scripts/setup_transactions_indexes.php` — one-time: unique `ref`,
  unique `sessionId`, compound `{paidAt:1, method:1}`. Ran once against Atlas
  (output `uniq_ref, uniq_sessionId, paidAt_method`). Never in request path.
- `Backend/routes/api.php` — 2 requires + 7 routes (plan said 5; the 2
  single-`{ref}` receipt lookups are included as the plan's "optional if time").

**Frontend (new/extend)**
- `Frontend/js/api.js` — `createTransaction()`, `listTransactions(params,admin)`,
  `getTransaction(ref,admin)`, `getDailyReport(date)`, `exportReportUrl()`
  (export stays URL/anchor-based, not `api()` JSON).
- `Frontend/src/function/cashiers/cashier-dashboard.js` (extend, HTML
  untouched) — End now opens billing via shared dialogs only
  (`dashSelect` method → `dashPrompt` received → live change in `dashConfirm`
  → `createTransaction()` → success `dashConfirm` with `ref + change` + Print
  opening `receipt.html?ref=...`). Plus JS-rendered `To bill (closed, unpaid)`
  + `Recent bills` panels (closed-minus-billed logic, client-estimated totals,
  Bill buttons) so a deferred/skipped billing is recoverable. Refresh/30s
  behavior unchanged.
- `Frontend/src/function/admin/transactions.html + .js` (new) — admin guard,
  daily-income cards (`getDailyReport`, follows From date), `From/To/Method`
  filter, table `ref|paid|table|customer|total|method|change`, Export CSV via
  anchor (cookies sent), per-row receipt link (`receipt.html?ref=...`).
- `Frontend/src/function/shared/receipt.html + .js` (new) — `?ref=` (+`&admin=1`
  twin), `window.print()` → Save-as-PDF, `@media print` hides nav/actions.
- Nav: disabled `Reports · Soon` replaced with live `Transactions` link in
  `admin-dashboard.html`, `cashiers.html`, `tables.html`, `rates.html`,
  `sessions.html`.
- `CU-002` / `CA-011`: no change needed — landing already has empty state
  ("All tables are in play" / "Nothing open right now"), error + Retry, 30s
  refresh; cashier Tables tabs already include `reserved`. Verified only.

**Deviations from plan (minor, within frozen scope):** single transactions file
instead of two (plan allowed "or single file if small"); 7 routes not 5 (the 2
receipt singles); cashier To-bill/Recent-bills panels added via JS wiring so
skipped payments are recoverable without touching `cashier-dashboard.html`.

## 3. Verification (manual, no automated suite per AGENTS.md)

Live against local backend + Atlas, 2026-10-15:
- `GET /api/health` → `{ok:true, db:gamehub_2_0, ping:ok}` — pass.
- Unauth guards: `GET /api/cashier/transactions`, `/api/admin/transactions`,
  `/api/admin/reports/daily`, `/api/admin/reports/export?format=csv` → 401
  (`not logged in`) — pass (cashier-on-admin → 403 by `require_admin`, same
  helper as all other admin routes, unchanged).
- Pure functions: `transactions_ref()` ×3 match `GH-YYYYMMDD-XXXX` — pass;
  `reports_day('not-a-date')` → 422, `reports_day('2026-10-15')` → ok — pass;
  `transactions_shape()` returns ref/total, no `passwordHash` key — pass.
- Authenticated read QA (fake admin session, read-only): `transactions_admin_list`
  → `{ok:true, n=0}` (empty collection on first run); `reports_daily(today)` →
  `{count:0, gross:0}`; bad `date`/`from` → 422 — pass.
- `php -l` on all 4 backend files — pass; `node --check` on `api.js`,
  `transactions.js`, `receipt.js`, `cashier-dashboard.js` — pass.
- Indexes script ran once: `uniq_ref, uniq_sessionId, paidAt_method` — pass.

**Not exercised in this run (no seeded closed session / staff credentials in
scope):** live `end → create {method:cash, received:exact} → change 0`,
duplicate `sessionId` → 409, short payment → 422, `method:card` → 422, CSV
download opening in Sheets, receipt Save-as-PDF dialog. Operator steps (§5)
cover them; server was left running on `:8000` for that.

## 4. Done-criteria mapping (plan §9)

1. Health baseline — pass (above).
2. Start/double-start-409/extend/timer — regression only, code untouched — OK.
3. Billing codes (200/409/422/422) — implemented + unit-verified; live-write
   left to operator (§5) — partial, code-complete.
4. Admin lists + daily gross + CSV + receipt print — lists/daily verified live;
   CSV guard + format verified; receipt page built — code-complete, download/
   print dialog left to operator.
5. Landing count + reserved tab + archived-hidden — verified in existing code.
6. Atlas `transactions {ref/sessionId/total/method/received/change/paidAt}` +
   `activityLogs payment_record` + no hash in lists — by construction + shape
   test; first live write pending.
7. Logout → `/api/me` 401; cashier on admin route 403 — existing helpers,
   unchanged.

## 5. Operator re-check (5 min, needs admin + cashier logins)

1. Cashier: start on available table → 200; double-start same table → 409;
   extend +60 → endTime pushed; end → note `amount`.
2. Billing: `POST /api/cashier/transactions {method:cash, received:exact}` →
   200 `ref GH-*`, `change 0`; repeat same `sessionId` → 409;
   new session, `received < total` → 422; `method:card` → 422.
3. Admin Transactions page: filter `from/to/method`, daily card `gross` equals
   row sum, Export CSV opens in Sheets, per-row Print → receipt → Save-as-PDF.
4. Atlas: `transactions` doc + `activityLogs payment_record` present;
   no `passwordHash` in any list response.

## 6. Risks / notes

- `paidAt`/daily buckets are UTC (Asia/Manila `?tz` cut deferred to next
  sprint per plan).
- `php -S` single-threaded: 185–1200 ms reads normal; no query tuning done.
- Frontend must open via `http://localhost:5500` (session cookie `Lax`).
- Backend dev server left running on `:8000` after this run; restart via
  `npm run dev:backend` if the port is busy.

## 7. Files changed

- New: `Backend/src/function/cashiers/transactions.php`,
  `Backend/src/function/admin/reports.php`,
  `Backend/scripts/setup_transactions_indexes.php`,
  `Frontend/src/function/admin/transactions.html`,
  `Frontend/src/function/admin/transactions.js`,
  `Frontend/src/function/shared/receipt.html`,
  `Frontend/src/function/shared/receipt.js`.
- Edited: `Backend/routes/api.php`, `Frontend/js/api.js`,
  `Frontend/src/function/cashiers/cashier-dashboard.js`,
  `Frontend/src/function/admin/admin-dashboard.html`,
  `Frontend/src/function/admin/cashiers.html`,
  `Frontend/src/function/tables/tables.html`,
  `Frontend/src/function/tables/rates.html`,
  `Frontend/src/function/tables/sessions.html`.
