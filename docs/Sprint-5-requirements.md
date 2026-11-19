# Sprint 5 — Food & Beverage: Functional Requirements

Date: 2026-11-04
Status: Draft for review — freeze before implementation
Base: `integration` branch
Depends on: Sprint 1 (identity/staff), Sprint 2 (tables/rates/sessions), Sprint 3 (billing/payments/receipts), Sprint 4 (reservations)
Source of truth for codes: `docs/01-requirements-matrix.md`

## 1. Goal

Add a food and beverage (F&B) capability to GameHub:

1. The administrator maintains a menu of F&B products (add, update, archive).
2. The cashier can view the menu, attach F&B items to a customer's open bill, and correct those items until the bill is paid.
3. The final bill, receipt, transaction record, and income reports include both the table/session charge and the F&B charge, with the F&B portion itemized.

Success means a cashier can run one complete walk-in flow — start a table session, add drinks/food while the customer plays, end the session, collect one payment covering table + F&B, and hand over an itemized receipt — without leaving the dashboard or using native browser popups.

## 2. Scope

### 2.1 In scope (traceability)

| Code | Requirement (matrix wording) | Sprint 5 behavior |
|---|---|---|
| AD-031 | Administrator should be able to add food and beverage products. | Admin creates a product with name, category, and price. |
| AD-032 | Administrator should be able to update food and beverage product information and prices. | Admin edits name/category/price; future orders use the new values. |
| AD-033 | Administrator should be able to archive food and beverage products. | Archived products leave the cashier menu and cannot be added to new orders; history is preserved. |
| CA-020 | Cashier should be able to create a customer bill containing applicable session charges and F&B orders. | Bill = session charge + F&B subtotal; paid in one transaction. |
| CA-026 | Cashier should be able to view available food and beverage products and prices. | Read-only cashier menu page, active products only. |
| CA-027 | Cashier should be able to add food and beverage items to a customer's bill. | Cashier adds product + quantity to a session's open bill. |
| CA-028 | Cashier should be able to update or remove unfinalized F&B items from a customer's bill. | Quantity can change and lines can be removed until payment is recorded. |
| AD-025 | Administrator should be able to view transaction records. | Transaction list/detail shows the F&B amount and item lines. |
| AD-019 | Administrator should be able to view daily income reports. | Income totals include F&B and split session vs. F&B revenue. |
| CA-025 | Cashier should be able to generate or print a customer receipt. | Receipt itemizes F&B lines, subtotals, and the combined total. |

| CA-033 | System should record important cashier actions. | Add/update/remove order actions and product catalogue changes are logged. |

Supporting requirements reused without change: role guards from the server session, `activityLogs`, CSV export, daily/monthly/income reports, jsPDF receipt, and the existing two-step close-out-then-pay flow.

### 2.2 Out of scope

* Inventory, stock counts, ingredients/recipes, suppliers, and purchase orders.
* Kitchen/bar display screens, order printers, and preparation status (queued/cooking/served).
* Discounts, vouchers, promotions, taxes, service charges, and split payments.
* F&B-only sales with no billiard session (walk-up counter sales).
* Post-payment refunds, voids, or edits to a finalized bill.
* Customer-facing online menu/ordering and reservation pre-orders.
* Product images, barcodes, variants, modifiers, and per-item notes.
* Multi-branch pricing, per-cashier price overrides, and cashier duty shifts.
* Redesign of the existing session lifecycle, table charge, payment methods, or report date model.

## 3. Assumptions to freeze before build

These defaults keep the sprint implementable. Each must be confirmed or changed before Step 1.

| # | Assumption | Default |
|---|---|---|
| A1 | Every F&B order belongs to an existing billiard session. | Yes; no standalone F&B sale. |
| A2 | Items may be added/changed after the session ends but before payment. | Yes; "unfinalized" means no transaction yet. |
| A3 | Products are never hard-deleted. | Archive only. |
| A4 | Product categories are a fixed list. | `food`, `beverage`, `other` (UI labels Food, Beverage, Other). |
| A5 | Prices are final peso amounts. | VAT-inclusive; no tax/discount/service charge. |
| A6 | One order line per product per session. | Adding the same product again increases that line's quantity. |
| A7 | Quantity limits. | Integer 1–99 per line. |
| A8 | Admin role on orders. | Admin may view F&B details but may not add/edit/remove order lines. |
| A9 | Receipt delivery. | Existing jsPDF preview + download; no email/print server. |
| A10 | Timezone. | Existing report day buckets (UTC) and Manila display are unchanged. |

If any answer differs, update §2 and the affected FRs before coding.

## 4. Actors and permissions

| Capability | Admin | Cashier | Guest |
|---|---|---|---|
| View product catalogue | Yes (all, including archived) | Yes (active only) | No (401) |
| Add/edit product | Yes | No (403) | No (401) |
| Archive/unarchive product | Yes | No (403) | No (401) |
| View a session's F&B lines | Yes, after payment (transaction/receipt) | Yes, while the bill is unfinalized | No (401) |
| Add/update/remove F&B lines | No (403) | Yes, while bill is unfinalized | No (401) |
| Record the combined payment | No | Yes | No (401) |
| View receipts | Yes | Yes | No (401) |
| View F&B in transactions/reports | Yes | Own payment flow only | No (401) |

Role always comes from the server session. The client never sends a role.

## 5. Definitions

* **Product** — a sellable menu item with a name, category, and current price.
* **Active product** — a product with `archived: false`; visible in the cashier menu and addable to bills.
* **Archived product** — a discontinued product; hidden from the cashier menu, retained for history.
* **Order line** — one product attached to one session, with a price snapshot, quantity, and line total.
* **Open bill / unfinalized** — a session with no `transactions` document. This includes an active session and a closed session awaiting payment.
* **Finalized bill** — a session with a recorded transaction. No further order changes are allowed.
* **Session charge** — the table charge produced by the existing session billing rule.
* **F&B subtotal** — sum of all order-line totals on the bill.
* **Grand total** — `session charge + F&B subtotal`, rounded to two decimals.

## 6. Functional requirements

### 6.1 Administrator — product catalogue

#### FR-5.01 Add a product (AD-031)

* The admin can open an "Add product" dialog from the Menu page.
* Required fields: name, category, price.
* Name: trimmed, 1–80 characters, required.
* Category: one of `food`, `beverage`, `other`.
* Price: number greater than 0, at most ₱100,000.00, at most two decimal places.
* A new product is created active (`archived: false`) and appears in the cashier menu on the next load.
* Product names are unique ignoring case and surrounding whitespace. A duplicate returns `409`.
* The action is written to `activityLogs` as `fnb_product_add`.

**Acceptance:** adding "Coke / beverage / 35.00" returns 201 and the cashier menu shows Coke at ₱35.00. Adding "coke" again returns 409. A zero, negative, three-decimal, or non-numeric price returns 422.

#### FR-5.02 View, search, and filter products (supports AD-032/AD-033)

* The admin Menu page lists name, category, price, status (Active/Archived), and last-updated time.
* Filters: status `active | archived | all` (default active), optional category, and a name search.
* Archived products remain visible under the archived/all filters and are visually distinguished.
* The page shows loading, empty, and error states. A failed request must not leave a spinner forever.
* No pagination is required for this sprint; the list may cap at 500 products.

#### FR-5.03 Update product information and price (AD-032)

* The admin can edit name, category, and price of any product, active or archived.
* The same validation and duplicate-name rules as FR-5.01 apply (a product does not conflict with itself).
* Updates change the product document only. Existing order lines retain their name/price snapshot; completed transactions are never rewritten.
* The action is written to `activityLogs` as `fnb_product_update`, including the changed fields and, when applicable, the old and new price.
* The updated price is used for order lines added after the update.

**Acceptance:** changing Coke from ₱35 to ₱40 leaves an open bill's existing Coke line at ₱35; a new Coke line added afterwards uses ₱40.

#### FR-5.04 Archive a product (AD-033)

* The admin can archive an active product after a confirmation dialog.
* Archiving sets `archived: true` and stamps `archivedAt`; it never deletes the document.
* An archived product disappears from the cashier menu and cannot be added to a new order.
* Existing order lines for that product remain visible, editable, and billable at their snapshot price, so an open bill can still be settled.
* History is unchanged: old transactions and receipts still show the product name and price at sale time.
* Archiving an already archived product is idempotent (returns success, no duplicate log entry required).
* The action is written to `activityLogs` as `fnb_product_archive`.

#### FR-5.05 Unarchive a product (supporting parity)

* The admin can restore an archived product after confirmation; it becomes active and returns to the cashier menu.
* The action is written to `activityLogs` as `fnb_product_unarchive`.
* If this requirement is dropped to protect the sprint scope, remove the UI and endpoint rather than leaving a dead control.

### 6.2 Cashier — menu and order lines

#### FR-5.06 View the available menu (CA-026)

* The cashier has a read-only Menu page showing all active products with name, category, and current price.
* Products are grouped by category (Food, Beverage, Other) or filterable by category, and searchable by name.
* Archived products never appear.
* The page shows a clear empty state ("No menu items yet — ask an administrator") and an error state with retry.
* The cashier cannot add/edit/archive products from this page.

#### FR-5.07 Open a session's F&B order sheet (context for CA-027/CA-028)

* On the cashier Sessions page, every unfinalized session (active, or closed and unpaid) offers an "Orders" / "Add F&B" action.
* Paid and cancelled sessions do not offer add/edit/remove actions.
* The sheet shows the session's table and customer, the current order lines, the F&B subtotal, and a searchable active-product list.
* Opening the sheet must not change session state or charge anything.
* The sheet follows the existing shared dialog behavior: focus trap, Escape/backdrop close, no native `alert`/`prompt`/`confirm`.

#### FR-5.08 Add an F&B item to a bill (CA-027)

* The cashier selects an active product and a quantity (default 1, integer 1–99) and confirms.
* The server resolves the product and price; any price sent by the client is ignored.
* The line stores a snapshot: product id, name, category, unit price, quantity, line total, added-by, and timestamps.
* Adding a product that already has a line on the same bill increases that line's quantity. The original unit-price snapshot is kept, and the resulting quantity must stay ≤ 99.
* Adding to a cancelled session, a session that does not exist, or a finalized bill is rejected: 422 for cancelled, 404 for missing, 409 for already paid.
* Adding an archived product is rejected with 409 ("product is not available").
* A successful add returns the updated bill summary: lines, F&B subtotal, and (when the session is closed) the session charge and grand total.
* The action is written to `activityLogs` as `fnb_order_add`.

**Acceptance:** adding 2 × Coke at ₱35 creates one line with qty 2 and line total ₱70.00. Adding Coke again with qty 1 makes it qty 3 at the same ₱35 snapshot. Adding 99 more when the line is already 99 returns 422 and changes nothing.

#### FR-5.09 Update an order line's quantity (CA-028)

* The cashier can increase or decrease quantity with stepper controls or by entering an integer.
* Quantity must be an integer from 1 to 99; invalid input returns 422.
* Only the quantity changes. The unit price, product name, and category stay at the snapshot taken when the line was added.
* The line total and F&B subtotal recalculate server-side; the response returns the fresh bill summary.
* Updating a line on a paid/cancelled session is rejected (409 paid, 422 cancelled). A missing line returns 404.
* The action is written to `activityLogs` as `fnb_order_update`.

#### FR-5.10 Remove an order line (CA-028)

* The cashier can remove a line after a confirmation dialog.
* Removing a line deletes it from the open bill and recalculates the F&B subtotal. If it was the last line, the subtotal becomes ₱0.00.
* Removing from a paid/cancelled session is rejected (409 paid, 422 cancelled). A missing line returns 404.
* The action is written to `activityLogs` as `fnb_order_remove`, recording the product name, quantity, and unit price that were removed.
* There is no "remove all" bulk action in this sprint.

#### FR-5.11 Session bill summary (supports CA-020)

* Any unfinalized session can return a bill summary: order lines, F&B subtotal, and session status.
* For an active session, the session charge is shown as "calculated when the session ends"; the F&B subtotal is live.
* For a closed session, the summary returns the final session charge, F&B subtotal, and grand total.
* The summary must not create a transaction or lock the bill.
* If no F&B lines exist, the summary behaves exactly like the existing session bill (F&B subtotal ₱0.00).

### 6.3 Billing, receipts, and records

#### FR-5.12 Collect one payment for session + F&B (CA-020, CA-022, CA-023, CA-024)

* The existing payment endpoint and flow remain the entry point; no second payment is introduced.
* The server computes the bill at payment time:
  * `sessionTotal` = existing session charge for the closed session.
  * `fnbTotal` = sum of the session's order-line totals.
  * `total` = round2(`sessionTotal + fnbTotal`).
* `received` must be ≥ `total` and must respect the existing ₱1,000,000 ceiling; otherwise 422 and no transaction is written.
* `change` = round2(`received - total`).
* Payment method remains exactly `cash | gcash`.
* The transaction stores the item snapshots plus `sessionTotal`, `fnbTotal`, and `total`, and keeps the existing unique `ref` (`GH-YYYYMMDD-XXXX`) and one-per-session rule.
* After the transaction is written, the bill is finalized: further add/update/remove attempts return 409.
* If the session has no F&B lines, the calculation and response are backward compatible with Sprint 3.
* The payment sheet must show item lines, session charge, F&B subtotal, and grand total before confirmation, and live change from the grand total.

**Acceptance:** session charge ₱240 + 2 × ₱35 Coke = ₱310. `received = 310` records ₱0 change; `received = 500` records ₱190 change; `received = 309.99` returns 422. A second payment for the same session returns 409.

#### FR-5.13 Itemized receipt (CA-025)

* The receipt displays an item table: item name, quantity, unit price, and line total.
* It displays the F&B subtotal (only when greater than zero), the session charge, and the grand total.
* Existing rows (table, customer, cashier, paid time, time played, billed hours, rate, method, received, change) remain.
* Legacy transactions with no item data render exactly as they do today, with no empty F&B section.
* The receipt must remain usable when the item list is longer than one page (paginate or continue the table on a new page).
* The PDF remains client-side jsPDF; no new server dependency.

#### FR-5.14 F&B in transaction records (AD-025)

* Admin transaction lists show the grand total and the F&B portion for each bill. A column or an expandable detail is acceptable.
* Opening a transaction's receipt from the admin list shows the itemized lines.
* The transaction API response includes `sessionTotal`, `fnbTotal`, and `items` for new transactions. For legacy documents it returns `sessionTotal = total`, `fnbTotal = 0`, `items = []`.
* No endpoint may expose internal or credential data; role guards remain in place.

#### FR-5.15 F&B in income reports (AD-019 supporting)

* `gross` remains the grand-total income and therefore includes F&B automatically.
* Daily, monthly, and income-range responses add `sessionGross` and `fnbGross`; `byMethod` continues to split cash/GCash grand totals.
* The admin income cards show the F&B portion next to the total (e.g., "₱1,240.00 · F&B ₱360.00").
* Existing consumers of `gross`/`count`/`byMethod` must keep working unchanged.

#### FR-5.16 CSV export

* The transaction CSV keeps its existing columns and appends `sessionTotal`, `fnbTotal`, and an item summary column (for example `Coke x2 @35.00; Chips x1 @50.00`).
* CSV fields are quoted/escaped correctly so commas, quotes, and line breaks in product names cannot corrupt the file.
* Legacy transactions export with `fnbTotal = 0` and an empty item summary.
* The export continues to download as an attachment using the existing URL/anchor approach.

### 6.4 Audit and integrity

#### FR-5.17 Activity logging (CA-033)

* The system records: `fnb_product_add`, `fnb_product_update`, `fnb_product_archive`, `fnb_product_unarchive`, `fnb_order_add`, `fnb_order_update`, `fnb_order_remove`.
* Each entry includes actor id (or `system`), target id, action, timestamp, and enough context to explain the change (product name; old/new price for updates; quantity and unit price for order changes).
* Logs never contain passwords, hashes, tokens, or other secrets.

#### FR-5.18 Concurrency and finalization guard

* A product price change, archive, or unarchive must never rewrite lines already on a bill or a completed transaction.
* Two cashiers adding the same product to the same bill must not create duplicate lines; the server merges the quantity.
* Payment and order edits must not race: once payment starts/succeeds, an order edit must fail with 409 and the paid transaction must remain consistent. The implementation must not leave a paid bill whose stored total disagrees with its item lines.
* One session can produce at most one transaction (existing unique `sessionId` rule stays).
* Cancelling/voiding a session with F&B lines is allowed under the existing session rules; the lines are never billed. The cancelled session remains visible for audit but offers no order actions.

## 7. Business rules

| Rule | Statement |
|---|---|
| BR-5.1 | F&B orders exist only as part of a session bill. |
| BR-5.2 | A line's unit price is the product price at the time the line is first added, stored as a snapshot. |
| BR-5.3 | Later product edits never change existing line prices or finalized transactions. |
| BR-5.4 | Only active products can be added. Archived products stay on existing bills but cannot be added. |
| BR-5.5 | One line per product per session; repeated adds increment quantity up to 99. |
| BR-5.6 | Quantity updates do not refresh the snapshot price; remove and re-add to pick up a new price. |
| BR-5.7 | Order edits are allowed only while the session has no transaction, including after the session ends. |
| BR-5.8 | The grand total is session charge + F&B subtotal, rounded to two decimals at each step using the existing `round2` helper. |
| BR-5.9 | One payment covers the whole bill; no partial or split payments. |
| BR-5.10 | Products and transactions are immutable history; products are archived, never deleted. |
| BR-5.11 | An order edit that would push the F&B subtotal above ₱1,000,000 is rejected with 422 so the existing payment cap stays reachable. |
| BR-5.12 | Reports continue to bucket by `paidAt` exactly as today; F&B does not change the reporting date model. |

## 8. Edge cases and error handling

| Situation | Expected result |
|---|---|
| Add/edit product while not logged in | `401` |
| Cashier calls a product mutation endpoint | `403` |
| Duplicate product name (case/whitespace-insensitive) | `409` |
| Invalid name/category/price | `422` with a field-specific message |
| Add to a missing session | `404` |
| Add an archived product | `409` ("product is not available") |
| Add/edit/remove on a paid bill | `409` ("bill already paid") |
| Add/edit/remove on a cancelled session | `422` ("session is cancelled") |
| Edit/remove a missing line | `404` |
| Quantity 0, negative, decimal, or > 99 | `422` |
| Short payment | `422`, no transaction, order lines untouched |
| Duplicate payment for the same session | `409`, no second transaction |
| Product archived while the order sheet is open | Add fails with `409`; existing line remains usable |
| Price changed while the order sheet is open | Server uses the current price for a new line, never the stale client value |
| No active products | Cashier menu shows an empty state; starting sessions and billing still work |
| Legacy transaction with no `items` | Lists, receipt, report, and CSV remain valid with F&B = 0 |
| Session auto-ended while ordering | The session becomes closed-unpaid; ordering and payment remain allowed |

## 9. Non-functional requirements

* **Security:** every endpoint uses the existing `requireLogin`/`requireAdmin` middleware. Role is derived from the server session only. No direct database access from the frontend. Responses never include password hashes, tokens, or secrets.
* **Data integrity:** money is stored as numbers rounded with `round2`; quantities are integers; item snapshots are immutable after payment. Index creation is a one-time script, never inside a request.
* **Backward compatibility:** existing sessions, transactions, receipts, reports, and CSV consumers must continue to work when no F&B data exists.
* **UI consistency:** use the existing dashboard shell, `js/api.js` for calls, `js/dash.js` for dialogs/toasts, and existing `dashboard.css`/`settings.css` patterns. No native popups, no new framework, no build step, no new runtime dependency.
* **Accessibility:** dialogs keep focus management and Escape/backdrop behavior; inputs have labels; status messages use the existing message roles; controls are keyboard reachable.
* **Safety:** render user-entered names with `textContent` (or equivalent), never unsanitized `innerHTML`.
* **Responsiveness:** the menu and order sheet must remain usable on the cashier's tablet/phone layout used by the existing dashboard.
* **Performance:** the menu is one query; avoid per-row queries. Reads in the 185–1200 ms range are normal for this stack and are not a reason to micro-optimize.
* **Observability:** failed mutations return a clear JSON error and are not silently swallowed.

## 10. Acceptance scenarios (manual, in order)

1. **Catalogue lifecycle**
   * Admin logs in → Menu → adds "Coke" (beverage, ₱35.00), "Chips" (food, ₱50.00), and "Water" (beverage, ₱20.00).
   * Cashier logs in → Menu shows all three at the correct prices, grouped/searchable.
   * Admin edits Coke to ₱40 → cashier menu shows ₱40.
   * Admin archives Water → cashier menu no longer shows Water; admin archived filter shows it; unarchive restores it.
2. **Ordering during a session**
   * Cashier starts a 1-hour session on an available table.
   * Opens the session's Orders sheet and adds 2 × Coke and 1 × Chips → lines show qty/unit/line totals, F&B subtotal ₱120.00.
   * Changes Coke to qty 3 → subtotal ₱170.00; removes Chips → subtotal ₱120.00.
   * Closes the sheet; reopens it and confirms the lines persisted.
3. **Ordering after the session ends**
   * Cashier ends the session → it moves to "To bill".
   * Cashier adds 1 × Water before paying → allowed; bill shows session charge + F&B.
4. **Combined payment**
   * Payment sheet shows itemized lines, session charge, F&B subtotal, grand total.
   * Entering less than the grand total disables confirm / returns 422.
   * Paying exact shows ₱0 change; paying more shows correct change; ref format is `GH-YYYYMMDD-XXXX`.
   * The bill disappears from "To bill", the table becomes available, and no further order edits are possible (409).
5. **Receipt and records**
   * Receipt shows lines, F&B subtotal, session charge, grand total, received, change.
   * Admin Transactions shows the bill with its F&B portion; receipt link opens the same itemization.
   * Daily/income totals include F&B and show the session/F&B split.
   * CSV downloads with quoted item summaries and correct totals.
6. **Snapshot rules**
   * While a bill has a Coke line at ₱35, admin changes Coke to ₱45 → the open line remains ₱35, a newly added Coke line uses ₱45.
   * Admin archives Coke while a line exists → line can still be adjusted/removed and paid; adding another Coke fails with 409.
7. **Regression**
   * Start → end → pay a session with no F&B: totals, receipt, transaction, and reports are identical to Sprint 3 behavior.
   * Legacy transactions still open their receipts and appear in reports/CSV.
   * `GET /api/health` still returns `{ok:true}`; logout → `/api/me` 401; cashier on an admin product route → 403.
8. **Data checks (Atlas)**
   * `products` document contains name/nameKey/category/price/archived/timestamps.
   * Session document contains the `fnbOrders` lines with snapshots.
   * Paid transaction contains `items`, `sessionTotal`, `fnbTotal`, `total`.
   * `activityLogs` contains the expected F&B actions.

## 11. Open decisions

Freeze these before Step 1; the defaults above apply until changed.

1. Fixed categories (`food`, `beverage`, `other`) or free-text categories? **Default: fixed.**
2. Allow F&B edits after the session ends but before payment? **Default: yes.**
3. Include unarchive (FR-5.05)? **Default: yes.**
4. Any tax, service charge, or discount? **Default: none.**
5. Can archived product names be reused for a new product? **Default: no; the name stays reserved (rename the archived item if needed).**
6. Is a standalone F&B sale without a table session needed? **Default: no.**
7. Should the customer landing page show the F&B menu? **Default: no, cashier-only this sprint.**
8. How are post-payment mistakes corrected? **Default: out of scope; do not add an edit/refund path in this sprint.**

## 12. Definition of done

* All seven in-scope matrix requirements (AD-031/032/033, CA-020/026/027/028) pass the acceptance scenarios.
* Supporting behavior is verified: itemized receipt, transaction F&B totals, report split, CSV export, activity logs.
* No-F&B bills and legacy bills remain fully backward compatible.
* All money values render to two decimals; no floating-point artifacts appear in bills or receipts.
* Role guards verified: guest 401, cashier 403 on admin product mutations, admin read-only on orders.
* No new runtime dependency, no build step, no native popups, no unsanitized HTML.
* Empty, loading, and error states exist on the admin Menu, cashier Menu, order sheet, and payment sheet.
* One-time index setup is documented and run outside the request path.
* `npm run dev` starts cleanly; `GET /api/health` is green; no console errors in the browser.
* Sprint report added under `docs/` with Atlas evidence and the manual test results.

---

## Appendix A — API contract (reference)

All routes are under `/api` and return the existing JSON envelope `{ok:true, ...}` or `{ok:false, error}`. All require a logged-in staff session unless stated; admin routes require the admin role.

### A.1 Admin product catalogue

| Method | Route | Body / query | Notes |
|---|---|---|---|
| GET | `/admin/products` | `?status=active\|archived\|all&category=&q=` | Returns `{ok, products:[...]}`. |
| POST | `/admin/products` | `{name, category, price}` | 201; 409 duplicate; 422 invalid. |
| PUT | `/admin/products/:id` | `{name?, category?, price?}` | 404 missing; 409 duplicate; 422 invalid. |
| POST | `/admin/products/:id/archive` | — | Idempotent; 404 missing. |
| POST | `/admin/products/:id/unarchive` | — | 404 missing. |

### A.2 Cashier menu and orders

| Method | Route | Body / query | Notes |
|---|---|---|---|
| GET | `/cashier/products` | `?q=&category=` | Active products only. |
| GET | `/cashier/sessions/:id/bill` | — | `{ok, bill:{session, items, sessionTotal?, fnbTotal, total?}}`; no write. |
| POST | `/cashier/sessions/:id/orders` | `{productId, qty}` | 201/200; merge duplicate product; 409 archived/paid; 422 invalid/cancelled. |
| PUT | `/cashier/sessions/:id/orders/:lineId` | `{qty}` | 200; 404 line; 409 paid; 422 invalid/cancelled. |
| DELETE | `/cashier/sessions/:id/orders/:lineId` | — | 200; 404 line; 409 paid; 422 cancelled. |

The existing `POST /cashier/transactions` keeps its body `{sessionId, method, received}` and now computes the combined total server-side. The existing `GET /cashier/transactions` and `GET /admin/transactions` (and `/:ref` twins) return the extended shape below.

### A.3 Report responses

Existing fields stay: `count`, `gross`, `byMethod.{cash,gcash}.{count,gross}`. Add:

```json
{
  "sessionGross": 1240.00,
  "fnbGross": 360.00
}
```

CSV appends `sessionTotal,fnbTotal,items` after the current columns.

## Appendix B — Data contract (reference)

### B.1 `products` (new collection)

```js
{
  name: "Coke",                 // display name, trimmed, 1-80 chars
  nameKey: "coke",              // name.trim().toLowerCase(), unique
  category: "beverage",         // food | beverage | other
  price: 35.00,                 // pesos, 2 decimals, > 0, <= 100000
  archived: false,
  createdAt: ISODate,
  updatedAt: ISODate,
  archivedAt: ISODate | null
}
```

Indexes (one-time setup, never per request):

* unique `{nameKey: 1}` — prevents case-insensitive duplicates.
* `{archived: 1, category: 1, name: 1}` — menu/list reads.

### B.2 `sessions.fnbOrders` (embedded array)

```js
{
  _id: ObjectId,                // line id used by update/remove
  productId: ObjectId,
  name: "Coke",                 // snapshot
  category: "beverage",         // snapshot
  unitPrice: 35.00,             // snapshot at first add
  qty: 2,
  lineTotal: 70.00,
  addedBy: "<userId>",
  addedAt: ISODate,
  updatedAt: ISODate
}
```

No new session index is required; the array is read with the session document.

### B.3 `transactions` (extended)

```js
{
  // ...existing fields: ref, sessionId, tableId, tableName, customerName,
  // cashierId, cashierName, minutes, billedHours, pricePerHour, rateType,
  // method, received, change, paidAt, createdAt
  sessionTotal: 240.00,
  fnbTotal: 70.00,
  total: 310.00,
  items: [
    {
      productId: ObjectId,
      name: "Coke",
      category: "beverage",
      unitPrice: 35.00,
      qty: 2,
      lineTotal: 70.00
    }
  ]
}
```

Read rule for legacy documents: if `sessionTotal`/`fnbTotal`/`items` are absent, return `sessionTotal = total`, `fnbTotal = 0`, `items = []`. Existing unique indexes on `ref` and `sessionId` stay.

### B.4 Finalization guard

The payment flow must mark/lock the session so an order edit cannot land after the total is computed. A practical implementation is a conditional update on the session (`billingLocked`/`paidTransactionRef`) plus a re-check before insert; the functional contract is that a paid bill can never disagree with its item lines. If the transaction insert fails, the lock must be released so the cashier can retry.

## Appendix C — UI surface (reference, non-binding)

* Admin nav: add **Menu** to every admin page; new `Frontend/src/function/admin/products.html` + `products.js` (or `menu.html`/`menu.js`).
* Cashier nav: add **Menu** to every cashier page; new `Frontend/src/function/cashiers/cashier-menu.html` + `cashier-menu.js`.
* `Frontend/src/function/cashiers/cashier-sessions.js`: order sheet for unfinalized sessions; extend the existing `billSheet` summary with item lines and subtotals.
* `Frontend/src/function/shared/receipt.js` + `receipt.html`: itemized lines, subtotals, pagination.
* `Frontend/src/function/admin/transactions.js` + `transactions.html`: F&B column/detail and itemized receipt link.
* `Frontend/js/api.js`: product CRUD, cashier menu, bill summary, order add/update/remove helpers.
* `server/src/routes/`, `controllers/index.js`, `services/`, `models/`: new product area plus order handling inside the session/transaction area, following the existing routes → controllers → services → models layout.
* `server/scripts/`: one-time product/index setup, guarded like the existing scripts; never create indexes inside a request.
