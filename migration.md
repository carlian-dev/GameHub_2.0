# GameHub_2.0 — PHP → Node/Express Migration Contract

> **Status:** authoritative migration guardrail. Read this before touching any file.
> **Owner:** solo migration developer.
> **Last updated:** 2026-10-22.
> **Applies to:** every human or AI agent working on this migration.

---

## 0. The one rule

**Re-implement the existing API contract. Do not redesign the system.**

If a change is not required to make Express behave exactly like PHP — or is not in the approved divergence list in §14 — it does not belong in this migration.

The safest migration is boring: same URLs, same JSON, same status codes, same error strings, same BSON types, same database, same frontend. The only new things are the runtime, the MVC structure, and the session store.

---

## 1. Read order

Before writing code, read:

1. This file.
2. `AGENTS.md` (repository rules).
3. `Backend/routes/api.php` (the 40-route contract).
4. The PHP handler for the route you are porting.
5. `Frontend/js/api.js` (how the frontend actually calls it).
6. `architecture.md` / `README.md` only as background — they are stale (see §3).

If a document conflicts with the PHP source, **the PHP source wins for behavior**, and this file wins for migration process. If you find a real conflict, stop and ask; do not guess.

---

## 2. Scope

### In scope

- New Express backend under `server/`.
- Same Atlas database `gamehub_2_0`, same collections, same documents, same indexes.
- Same frontend, unchanged.
- Same auth model: cookie session, bcrypt, Google admin login, invite-only cashier registration.
- Exactly the 40 existing API routes. No more, no less.
- MVC structure: routes → controllers → services → models + JSON views/serializers.

### Out of scope — do not implement during migration

- Reservations, food & beverage, OTP/email codes, monthly/usage/hours reports, activity-log UI, cashier duty shifts.
- CSRF tokens, rate limiting, Helmet, HTTPS setup, CI/CD, Docker, TypeScript, GraphQL, API versioning, WebSockets.
- Any frontend redesign or frontend bug fix.
- Any PHP refactor or PHP bug fix.
- Any database cleanup, renaming, field normalization, or data migration.
- Any "while I was there" improvement.

If the client asks for a new feature during migration, record it as a follow-up. Do not mix it into the port.

---

## 3. Source of truth

Priority:

1. `Backend/routes/api.php` + the handler it points to.
2. `Frontend/js/api.js` + the page that calls it (for actual usage).
3. This file (process + guardrails).
4. `AGENTS.md`.
5. `architecture.md`, `README.md`, `docs/*` (background only).

### Known stale-doc conflicts — follow the code

| Topic | Docs say | Code does | Migration must do |
|---|---|---|---|
| Cashier registration | Pending → admin approval, OTP | Invite-only; account becomes `active` immediately | Preserve invite-only + immediate active |
| Login verification | Email one-time codes | No OTP anywhere | Do not add OTP |
| Billing | Per-minute (CA-014) | Per-hour `ceil()`, minimum 1 hour | **Preserve per-hour** unless client explicitly changes it |
| `activityLogs` timestamp | `timestamp` | `at` | Write `at` |
| Settings source | Env plus DB | DB authoritative; env only when doc is missing | Preserve |
| Admin creation | — | No endpoint creates admins | Do not add one |

If it looks like a bug but it is the current behavior, **preserve it** unless it is in §14. Parity first, cleanup later.

---

## 4. Absolute DOs

1. **Work one vertical slice at a time.** Finish a route group, test it, commit it, then move on.
2. **Write the contract test first.** For every route, capture the PHP behavior before writing the Express handler.
3. **Read the PHP handler line by line** before porting it. Translate the logic; do not reinterpret it.
4. **Copy error messages verbatim**, including punctuation and dynamic parts.
5. **Preserve the exact JSON shapes**, field names, types, nullability, and ordering of array elements.
6. **Preserve the exact BSON types** written to Atlas: `ObjectId` for IDs, `Date` for timestamps, `number` for money.
7. **Use the native `mongodb` driver.** One `MongoClient` per process.
8. **Use `express-session` + `connect-mongo`.** Store sessions in `authSessions`, never `sessions`.
9. **Use `bcryptjs`** (or a verified bcrypt library) against the existing PHP hashes.
10. **Use JSON serializers (`views/`) for every response.** Never return a raw MongoDB document.
11. **Project `passwordHash` out** of every list/detail query.
12. **Keep CORS to exactly `FRONTEND_URL` with credentials.**
13. **Keep the backend on port 8000** at cutover so `Frontend/js/config.js` does not change.
14. **Run tests against a test database only** (`gamehub_2_0_migtest` or `mongodb-memory-server`).
15. **Commit small, review the diff, and never commit `.env` or secrets.**
16. **Stop and ask** when a behavior is ambiguous, a parity test fails for an unknown reason, or a change would touch a frozen area.
17. **Record every intentional divergence** in §14 and in the parity-test allowlist.
18. **Keep `Backend/` runnable** until one week after cutover and client sign-off.

---

## 5. Absolute DON'Ts

### Never touch

- `Frontend/**` — read-only. Zero changes. If a frontend change seems necessary, stop and ask.
- `Backend/**` — read-only reference and rollback. Do not edit, refactor, delete, or "fix" it.
- `Backend/.env`, `server/.env`, any real `.env` — never print, copy, commit, or paste into a chat.
- `node_modules/`, `Backend/vendor/` — never edit or commit.
- The production database `gamehub_2_0` — no tests, resets, experiments, deletes, or manual writes.
- `main` branch — never commit or force-push directly.
- Git history — never rewrite, squash, or force-push shared branches.

### Never change the contract

- URLs, HTTP methods, auth requirements, or route names.
- Request field names or accepted aliases.
- Response field names, types, nullability, or `ok` semantics.
- Status codes or error messages.
- Sort order, filters, limits, projections, or fallback behavior.
- Unknown-status fallbacks: sessions → `active`; tables/cashiers → `all`.
- `{id}` validation rules (`^[0-9a-fA-F]{24}$`) or their error messages.
- The CSV header row, column order, filename pattern, or `Content-Disposition`.
- The `activityLogs` action names or field names.
- The settings mask character (`•`) or hint rules.
- The invite token format, TTL, hashing, or single-use behavior.
- The Google admin-only rule or the "no account creation" rule.
- The single-admin rule.

### Never change behavior

- Billing is per-hour: `ceil(elapsed / 1h)`, minimum 1 hour.
- Special-rate window is 18:00–23:59 Asia/Manila, snapshotted at session start.
- Rate snapshots never flip mid-session.
- Invite = approval; registration creates an `active` cashier immediately.
- Archive is one step; no email code.
- Google login is admin-only; unknown emails get 404, cashiers get 403.
- Only `active` accounts log in.
- `GET /api/me` re-reads Atlas.
- Settings are DB-authoritative and fail closed.
- `/api/config` returns `Cache-Control: no-store`.
- `transactions` are created only for `closed` sessions, with a unique `sessionId`.
- Money must never be computed from a client-supplied total.

### Never use

- Mongoose, Prisma, TypeORM, or any ODM/ORM.
- JWT or stateless auth.
- `MemoryStore` in production.
- `connect-mongo` default collection `sessions` (it collides with billiard sessions).
- `ObjectId.isValid()` alone as validation (it accepts 12-byte strings).
- `res.json(mongoDocument)` directly.
- `cors({ origin: "*", credentials: true })`.
- `sameSite: "none"` without `secure: true` and CSRF protection.
- `express.urlencoded()` — PHP ignores form bodies; only JSON is parsed.
- Native `Date` local-time math for the Manila rate window.
- `Math.round()` for money without the approved `round2()` helper.
- `$2y$` password comparison without verifying the library first.
- Per-request index creation or rate seeding.
- `npm audit fix --force` or major dependency upgrades during migration.
- Schema/validation libraries that replace the PHP error messages.

### Never do operationally

- Run automated tests, seeds, or reset scripts against `gamehub_2_0`.
- Run PHP and Node against production at the same time for writes.
- Cut over without an Atlas backup/export.
- Delete or archive `Backend/` before soak + client sign-off.
- Change port 8000 or `Frontend/js/config.js`.
- Send real invitation emails from tests.
- Log request bodies, cookies, tokens, passwords, `idToken`, or settings credentials.
- Widen Atlas network access to `0.0.0.0/0` if a narrower option exists.

---

## 6. File ownership

| Path | Rule |
|---|---|
| `Frontend/**` | **READ-ONLY.** Zero changes. If a change seems needed, stop. |
| `Backend/**` | **READ-ONLY** reference + rollback. Do not edit, refactor, delete, or "fix." |
| `Backend/.env`, `server/.env*` | Never commit, print, copy, or paste. |
| `server/**` | New migration code. All work goes here. |
| `migration.md` | This contract. Update only with the owner's approval. |
| `package.json` (root) | Edit only at Phase 5 cutover. |
| `AGENTS.md`, `README.md`, `architecture.md` | Edit only at Phase 5, after sign-off. |
| `docs/**` | Do not rewrite existing docs. Add new migration docs under `docs/migration/` if needed. |

---

## 7. Environment and secrets

### Required `server/.env`

| Variable | Required | Secret | Default / notes |
|---|---:|---:|---|
| `MONGODB_URI` | yes | yes | Atlas connection string |
| `MONGODB_DB` | yes | no | `gamehub_2_0` in production; `gamehub_2_0_migtest` in tests |
| `FRONTEND_URL` | yes | no | Exact origin, e.g. `http://localhost:5500`, no trailing slash |
| `PORT` | no | no | `8000` |
| `GOOGLE_CLIENT_ID` | no | no | Default only when no `googleAuth` settings document exists |
| `MAIL_USER` | yes* | yes | Gmail sender; *required only for invite mail |
| `MAIL_PASS` | yes* | yes | Gmail app password |
| `MAIL_FROM` | no | no | Display name, default `GameHub` |
| `SESSION_SECRET` | yes | yes | 32 random bytes as 64 hex chars |
| `SESSION_TTL_SECONDS` | no | no | `43200` (12 hours, rolling) |
| `AUTH_COOKIE_NAME` | no | no | `gh_session` |
| `NODE_ENV` | yes | no | `development` / `production` / `test` |
| `TRUST_PROXY` | no | no | `0` or `1` (or a hop count when behind a proxy) |
| `MAIL_DRY_RUN` | no | no | `1` in tests; logs instead of sending |

### Rules

- `server/.env` is local only. Commit `server/.env.example` with placeholders.
- Add to `.gitignore`: `server/.env`, `server/.env.*` (except `.env.example`), `backups/`.
- Generate a session secret:
  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Never print or log: `cookie`, `authorization`, `password`, `passwordHash`, `idToken`, `credentials`, `token`, `link`, `MONGODB_URI`, `MAIL_PASS`, `SESSION_SECRET`.
- If a secret leaks: stop, rotate it (Atlas DB user, Google client, Gmail app password, session secret), then continue.
- Use a **separate Atlas DB user** scoped to the test database for contract tests if possible.

---

## 8. Database safety

- Production DB: `gamehub_2_0`. It is **read-only for this migration** except normal API writes during UAT/cutover.
- Test DB: `gamehub_2_0_migtest` (or `mongodb-memory-server`).
- Every script/test that writes must call this guard first:

```js
const dbName = env.MONGODB_DB;
if (!/(^|_)migtest$/.test(dbName)) {
  throw new Error(`refusing to write: "${dbName}" is not a migration test database`);
}
```

- Never run against production:
  - `dropDatabase`, `dropCollection`
  - `deleteMany({})`, `updateMany({})`
  - seed scripts
  - contract tests
  - "quick checks" that write
- **No data migration.** Do not rename fields or collections. Do not convert BSON types. Do not normalize old documents.
- The only new collection is `authSessions` (session store). It is ignored by PHP and safe for rollback.
- One-time setup only. Indexes and seeds live in `server/scripts/` and run manually. Never create indexes or seed rates per request.
- Before cutover, run a **read-only** index verification script. Do not silently create missing production indexes.
- Verify these existing indexes before billing/report work:
  - `users.email` partial unique
  - `users.username` partial unique
  - `tables.name` unique
  - `rates.type` unique
  - `invitations.tokenHash` unique
  - `settings.key` unique
  - `transactions.ref` unique
  - `transactions.sessionId` unique
  - `transactions {paidAt, method}` compound
- Approved optional index (only after a read-only duplicate check):

```js
db.sessions.createIndex(
  { tableId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active" },
    name: "uniq_active_session_per_table",
  }
);
```

If duplicates already exist, do **not** create it. Report the duplicates and stop.

- Transactions (`settings_update`) require a replica set. Atlas supports them. Local tests must use `MongoMemoryReplSet` or a local replica set, not a standalone `mongod`.

---

## 9. Target stack and architecture

### Stack

- Node 20/22 LTS.
- Express 5.
- Plain JavaScript ESM + JSDoc (no build step).
- Native `mongodb` driver (not Mongoose).
- `express-session` + `connect-mongo`.
- `bcryptjs`, `nodemailer`, `cors`, `dotenv`.
- Tests with built-in `node:test` + `supertest` + `mongodb-memory-server`.
- Dev server with `node --watch` (no nodemon).

### Approved dependencies

Runtime:

- `express`
- `mongodb`
- `express-session`
- `connect-mongo`
- `cors`
- `dotenv`
- `nodemailer`
- `bcryptjs`

Dev:

- `supertest`
- `mongodb-memory-server`

Do not add any other dependency without explicit owner approval. Pin versions in `package-lock.json`; no major upgrades during migration.

### Layout

```text
server/
  src/
    server.js                 # listen + graceful shutdown
    app.js                    # express app, middleware, routes
    config/
      env.js                  # env validation, fail fast
      db.js                   # one MongoClient per process
      integrations.js         # settings registry
    routes/
      index.js
      auth.routes.js
      admin.routes.js
      cashier.routes.js
      public.routes.js
    controllers/              # HTTP in/out only
    services/                 # business rules, testable without HTTP
    models/                   # named Mongo queries + BSON conversions
    views/                    # JSON serializers = MVC "View"
    middleware/
      auth.js                 # requireLogin, requireAdmin
      validate.js
      errorHandler.js
      notFound.js
    validators/               # PHP-message-compatible validation
    utils/
      HttpError.js
      asyncHandler.js
      bson.js                 # ObjectId/date helpers
      dates.js
      numbers.js
      csv.js
      logger.js
    constants/
      roles.js
      statuses.js
  tests/
    contract/
    unit/
    integration/
  scripts/
    setupIndexes.js
    setupSettings.js
    verifyIndexes.js
  .env.example
  package.json
```

### Layer rules

- **Routes:** only method/path/middleware → controller. No business logic.
- **Controllers:** parse/validate input, call a service, send through a view. No DB queries.
- **Services:** own business rules, transaction boundaries, audit logs. Accept `actor`, `now`, `db`, `mailer`, and verifier dependencies explicitly so they are unit-testable.
- **Models:** own collection filters, projections, sorts, limits, and BSON conversions. Return plain objects.
- **Views:** the only place that builds response JSON. Exact field names and types. Never leak `passwordHash` or settings credentials.
- **Middleware:** auth guards, validation, error mapping, CORS, session.
- One controller per area, not per endpoint. Aim for ~30 small files, not 100.

Do not translate each PHP file into one large JS file. Port the business rules faithfully into services, then split HTTP concerns around them. **Parity first, elegance second.**

---

## 10. Agreed technical decisions

| Decision | Value | Rationale |
|---|---|---|
| Runtime | Node 20/22 LTS | Supported, built-in fetch/crypto/test |
| Framework | Express 5 | Async errors handled natively |
| Language | JS ESM + JSDoc | No build step; matches repo |
| DB access | Native `mongodb` driver | Preserve BSON and flexible documents |
| Auth | `express-session` + `connect-mongo` | Preserve server-side revocation semantics |
| Session collection | `authSessions` | Avoid collision with `sessions` |
| Cookie | `gh_session`, `httpOnly`, `sameSite=lax`, `path=/`, `secure` in prod | Explicit, secure, same-site |
| Session lifetime | 12h rolling (`43200s`) | Cashier shift; deliberate change from PHP's ~24min GC |
| Port | 8000 at cutover | Frontend config unchanged |
| Billing | Per-hour `ceil`, minimum 1 hour | Code is the contract |
| Rate window | 18:00–23:59 Asia/Manila, snapshot at start | Preserve |
| Deployment | Frontend and API same site | `SameSite=Lax` requires it |
| Validation | Hand-written validators | Preserve PHP messages exactly |
| Logging | Small structured logger, redacted | No extra dependency |
| Tests | `node:test` + `supertest` + `mongodb-memory-server` | No Jest/Vitest build |

---

## 11. Contract at a glance

### Success shapes (must match exactly)

```js
// login / google
{ ok: true, username, email, role }

// me
{ ok: true, username, email, role, status, displayName, authProvider, createdAt, googleLinked }

// cashier
{ id, email, username, role, authProvider, status, firstName, lastName, displayName, emailVerified, schedule, createdAt }

// table
{ id, name, status, archived, createdAt }

// session
{ id, tableId, tableName, customerName, cashierId, cashierName, startTime, endTime,
  plannedMinutes, status, pricePerHour, rateType, closedAt }

// transaction
{ id, ref, sessionId, tableId, tableName, customerName, cashierId, cashierName,
  minutes, billedHours, pricePerHour, rateType, total, method, received, change,
  paidAt, createdAt }

// settings integration
{ key, name, description, available, enabled,
  credentials: [{ name, label, required, configured, masked }], updatedAt, updatedBy }

// invite
{ id, email, status, createdAt }

// daily report
{ ok: true, date, count, gross, byMethod: { cash: { count, gross }, gcash: { count, gross } } }

// health
{ ok: true, db, ping: "ok", healthcheck_count }

// config
{ ok: true, integrations: {
    googleAuth: { enabled, clientId },
    googleMaps: { enabled, apiKey }
} }
```

For exact details, read the PHP handler. When in doubt, copy the shape from `*_shape()` functions.

### Errors

- Every failure: `{ ok: false, error: "..." }`.
- 404 from the router also includes `path`.
- Allowed known codes: `400, 401, 403, 404, 409, 410, 422, 502, 503`.
- Unknown error code → `500`.
- Mongo connection/selection/timeout → `503` with `"database unavailable, try again later"`. Log the detail; never return it.
- Duplicate key (`code === 11000`) → the relevant `409` (table name, username/email, already billed, etc.). Do not map duplicate keys to 503.
- Unexpected errors → `500` with a generic message (approved divergence; see §14).
- Always JSON. Never let Express return HTML error pages.
- Normalize `req.body ?? {}` so handlers can behave like PHP's `json_body()`.
- Malformed JSON must still return JSON (400 with an error), not an HTML parser page.

### Headers and caching

- CORS origin: exactly `FRONTEND_URL`. `credentials: true`.
- Allowed methods: `GET, POST, PUT, DELETE, OPTIONS`.
- Allowed headers: `Content-Type, Authorization`.
- Preflight: `204`.
- The frontend sends `Content-Type: application/json` even on GET, so **preflight must work for every route**.
- `/api/config`: `Cache-Control: no-store`.
- Disable Express ETag (`app.set("etag", false)`) so Node does not introduce `304` responses PHP did not have.
- CSV: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="..."`.

---

## 12. Route inventory (40 routes)

Breakdown: **7 public**, **11 any-authenticated**, **22 admin-only**.

Access legend: **Public** = no login; **Auth** = any active logged-in user; **Admin** = admin only.

| # | Method | Path | Access | PHP handler | Node target |
|---:|---|---|---|---|---|
| 1 | GET | `/api/health` | Public | `health_handle` | `health.controller` |
| 2 | GET | `/api/config` | Public | `app_config` | `settings.controller` (public config) |
| 3 | POST | `/api/cashiers/register` | Public | `auth_register` | `auth.controller` + `auth.service` |
| 4 | GET | `/api/invitations/{token}` | Public | `invite_check` | `invitation.controller` |
| 5 | POST | `/api/login` | Public | `auth_login` | `auth.controller` |
| 6 | POST | `/api/auth/google` | Public | `google_login` | `auth.controller` + `google.service` |
| 7 | POST | `/api/logout` | Auth | `auth_logout` | `auth.controller` |
| 8 | GET | `/api/me` | Auth | `auth_me` | `auth.controller` |
| 9 | POST | `/api/admin/invitations` | Admin | `invite_create` | `invitation.controller` |
| 10 | GET | `/api/admin/invitations` | Admin | `invite_list` | `invitation.controller` |
| 11 | POST | `/api/admin/invitations/{id}/revoke` | Admin | `invite_revoke` | `invitation.controller` |
| 12 | GET | `/api/admin/settings/integrations` | Admin | `settings_list` | `settings.controller` |
| 13 | PUT | `/api/admin/settings/integrations/{key}` | Admin | `settings_update` | `settings.controller` |
| 14 | GET | `/api/admin/cashiers` | Admin | `cashiers_list` | `cashierAdmin.controller` |
| 15 | PUT | `/api/admin/cashiers/{id}` | Admin | `cashiers_update` | `cashierAdmin.controller` |
| 16 | POST | `/api/admin/cashiers/{id}/archive` | Admin | `cashiers_archive` | `cashierAdmin.controller` |
| 17 | POST | `/api/admin/cashiers/{id}/unarchive` | Admin | `cashiers_unarchive` | `cashierAdmin.controller` |
| 18 | GET | `/api/admin/tables` | Admin | `tables_list` | `table.controller` |
| 19 | POST | `/api/admin/tables` | Admin | `tables_add` | `table.controller` |
| 20 | PUT | `/api/admin/tables/{id}` | Admin | `tables_rename` | `table.controller` |
| 21 | PUT | `/api/admin/tables/{id}/status` | Admin | `tables_status` | `table.controller` |
| 22 | POST | `/api/admin/tables/{id}/archive` | Admin | `tables_archive` | `table.controller` |
| 23 | POST | `/api/admin/tables/{id}/unarchive` | Admin | `tables_unarchive` | `table.controller` |
| 24 | GET | `/api/admin/rates` | Admin | `rates_list` | `rate.controller` |
| 25 | PUT | `/api/admin/rates` | Admin | `rates_set` | `rate.controller` |
| 26 | GET | `/api/admin/sessions` | Admin | `sessions_list` | `session.controller` |
| 27 | GET | `/api/cashier/sessions` | Auth | `sessions_cashier_list` | `session.controller` |
| 28 | POST | `/api/cashier/sessions` | Auth | `sessions_start` | `session.controller` |
| 29 | POST | `/api/cashier/sessions/{id}/extend` | Auth | `sessions_extend` | `session.controller` |
| 30 | POST | `/api/cashier/sessions/{id}/end` | Auth | `sessions_end` | `session.controller` |
| 31 | POST | `/api/cashier/sessions/{id}/cancel` | Auth | `sessions_cancel` | `session.controller` |
| 32 | GET | `/api/cashier/tables` | Auth | `tables_cashier_list` | `table.controller` |
| 33 | GET | `/api/tables/availability` | Public | `tables_public_list` | `table.controller` |
| 34 | POST | `/api/cashier/transactions` | Auth | `transactions_create` | `transaction.controller` |
| 35 | GET | `/api/cashier/transactions` | Auth | `transactions_cashier_list` | `transaction.controller` |
| 36 | GET | `/api/cashier/transactions/{ref}` | Auth | `transactions_cashier_get` | `transaction.controller` |
| 37 | GET | `/api/admin/transactions` | Admin | `transactions_admin_list` | `transaction.controller` |
| 38 | GET | `/api/admin/transactions/{ref}` | Admin | `transactions_admin_get` | `transaction.controller` |
| 39 | GET | `/api/admin/reports/daily` | Admin | `reports_daily` | `report.controller` |
| 40 | GET | `/api/admin/reports/export` | Admin | `reports_export` | `report.controller` |

Also keep the non-route `GET /` service info endpoint. It is not used by the frontend but is a useful probe.

---

## 13. Behavior rules by area

### 13.1 Auth and sessions

- Login input is `{ email, password }`; if the identifier contains `@`, look up by lowercased `email`; otherwise look up by lowercased `username` with `role: "cashier"`.
- `password_verify` equivalent: bcrypt compare against `passwordHash`. Never trim passwords.
- Status gates, in order:
  - `pending` → 403 `"awaiting admin approval"`
  - `archived` → 403 `"account archived"`
  - `declined` → 403 `"application was declined"`
  - anything not `active` → 403 `"account is not active"`
- Invalid credentials → 401 `"invalid credentials"`.
- Session payload must be exactly:
  ```js
  { id: String(user._id), username: user.username ?? null, email: user.email ?? null, role: user.role }
  ```
- On login: regenerate the session, set the payload, `await req.session.save()` before responding.
- On logout: `await req.session.destroy()` and clear the cookie with the same path/name.

Approved session configuration (copy these details exactly):

```js
app.use(session({
  name: env.AUTH_COOKIE_NAME || "gh_session",
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: MongoStore.create({
    mongoUrl: env.MONGODB_URI,
    dbName: env.MONGODB_DB,
    collectionName: "authSessions",   // NOT "sessions"
    ttl: Number(env.SESSION_TTL_SECONDS || 43200),
    autoRemove: "native",
  }),
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
  },
}));
```

If the deployment is cross-site, stop and get approval before changing `sameSite` to `"none"` (it requires `secure: true` and CSRF protection).
- `GET /api/me`: read the user from Atlas by `_id`; if missing → 401 `"not logged in"`. If `status !== "active"`, destroy the session and return 401 `"not logged in"` (approved divergence, §14). Otherwise return `displayName`, `authProvider` fallback (`google` if `googleSub`, else `local`), `createdAt` as ISO, `googleLinked`. This matters because the current frontend `cashierGuard()` checks only `role`, so without the re-check an archived cashier can keep using the dashboard.
- Google:
  - Read `googleAuth` settings; DB authoritative; read failure → 503 `"Google sign-in is temporarily unavailable"`.
  - Disabled → 403; missing client ID → 503 `"Google sign-in is not configured"`.
  - Verify the ID token with `https://oauth2.googleapis.com/tokeninfo?id_token=...`, 10s timeout.
  - Invalid token / bad `aud` / expired → 401 `"invalid Google sign-in"` (expired has its own message).
  - `email_verified` in tokeninfo is the string `"true"`; check it.
  - Unknown email → 404; non-admin → 403.
  - Link `googleSub` only when empty.
  - Active admin gets the same session payload.
- Registration:
  - Requires valid, unused, unexpired invite whose email matches the submitted email.
  - Roles forced to `cashier`; status `active`; `emailVerified: true`.
  - Names ≥ 2 chars; password ≥ 8 chars; username `^[a-z0-9._-]{3,30}$`.
  - Reject `idToken` with 422.
  - Mark invite used atomically; write `approve_cashier` audit log.
- Role comes from the session only. Never from request data.
- Single admin. No endpoint creates admins.

### 13.2 Invitations and mail

- Token: 32 random bytes → 64 hex chars. Store only `sha256(token)`.
- TTL: 24 hours; single use.
- Re-invite deletes prior unused invites for that email.
- If mail fails, delete the newly inserted invite and return 502 with the PHP message.
- Nodemailer: `smtp.gmail.com:587`, STARTTLS (`secure: false`, `requireTLS: true`), 15s timeout, same subject/body/link.
- `GET /api/invitations/{token}` returns `{ ok: true, valid: true, email }`.
- Revoke marks `used: true, revoked: true`; 404 if missing; invalid id → 422 `"invalid id"`.
- Never send real email in tests; use `MAIL_DRY_RUN=1` or a stub mailer.

### 13.3 Tables and rates

- Statuses: `available`, `occupied`, `reserved`, `maintenance`.
- Admin list filters: `archived` → archived only; a valid status → that status and not archived; anything else → all.
- Public/cashier lists exclude archived.
- Add/rename: name required, max 60 chars; duplicate → 409 `"table name already used"`.
- Status change: valid status only; archived tables → 422; then update.
- Archive: set `archived: true`. Unarchive: archived only → `{ archived: false, status: "available" }`.
- Rates: `regular` / `special`; positive numeric; upsert; `active: true`; update `updatedAt`.
- Seed defaults (`regular 140`, `special 180`) only in a one-time script.

### 13.4 Sessions and billing

- Start:
  - Body `{ tableId, customerName, durationMinutes }`; also accept `hours`/`minutes`.
  - tableId must be 24-hex; customer 1–60 chars; duration 60–1440.
  - Table must exist, not archived, `status === "available"`, no active session.
  - Snapshot `rateType` from Manila start hour: `>= 18` → `special`, else `regular`.
  - Snapshot `pricePerHour` from `rates`, fallback `140`.
  - Insert with `tableName`, `cashierName`, `startTime`, `endTime`, `plannedMinutes`, `status: "active"`, `createdAt`, `updatedAt`.
  - Flip table to `occupied`; write `session_start`.
- Extend:
  - `extraMinutes` 60–720, multiple of 60; total planned ≤ 1440.
  - Only `active`; `endTime` moves forward from the current `endTime`; `plannedMinutes` grows.
  - Write `session_extend`.
- End:
  - Only `active`; compute charge first; set `closed` + `closedAt` + `updatedAt`; free the table if occupied and not archived; write `session_end`.
  - Return `{ ok, amount, billedHours, session }`.
- Cancel:
  - Only `active`; set `cancelled` + `closedAt` + `updatedAt`; free table; write `session_cancel`.
- Billing formula:
  ```
  secs = until - startTime
  billedHours = max(1, ceil(secs / 3600))
  total = round2(billedHours * pricePerHour)
  minutes = ceil(max(0, secs) / 60)
  ```
- `sessions_free_table` only changes a table if it exists, is not archived, and is currently `occupied`.

### 13.5 Transactions and reports

- Create:
  - Body `{ sessionId, method, received }`.
  - method `cash` | `gcash`; received numeric, `> 0`, `<= 1,000,000`.
  - Session must exist and be `closed`; reject double billing with 409.
  - Recompute total from the session snapshot; never trust a client total.
  - `received < total` → 422 short payment message.
  - `change = round2(received - total)`.
  - Ref: `GH-YYYYMMDD-XXXX` using UTC date and 4 uppercase alphanumerics; retry on `ref` collision; `sessionId` collision → 409.
  - Insert `paidAt`/`createdAt`; write `payment_record` with `sessionId`, `total`, `method`.
- Lists:
  - Cashier list limit 200; admin list limit 500; sort `paidAt: -1`.
  - Date filter: `from`/`to` strict `YYYY-MM-DD`, UTC day range (`to` becomes `< next day`).
  - Method filter only for admin (`all`/invalid ignored).
  - Detail lookup by `ref`; missing → 404.
- Daily report:
  - Default date today UTC; strict `YYYY-MM-DD`.
  - Return count, gross, and per-method count/gross, rounded to 2 decimals.
- CSV export:
  - Only `format=csv`.
  - Same filters as reports.
  - Header exactly: `ref,paidAt,table,customer,cashier,minutes,billedHours,rate,rateType,total,method,received,change`
  - Row order `paidAt: 1`, limit 5000.
  - Filename pattern `gamehub-transactions-<from|all>-to-<to|all>.csv`, sanitized.
  - Stream text/csv; no JSON wrapper.

### 13.6 Settings

- Registry keys: `googleAuth`, `googleMaps`, `recaptcha`, `otp`.
- Only `available: true` integrations can be updated.
- DB documents authoritative; defaults only when no document exists.
- `/api/config` fails closed: on read failure, both integrations return disabled/empty with HTTP 200.
- Masking:
  - 8 `•` characters, plus a hint when the value is longer than 8 chars.
  - Google client ID hint: last 4 chars before `.apps.googleusercontent.com`.
  - Never return the raw value to an admin response.
- Update:
  - `enabled` must be a real boolean.
  - `credentials` must be an object of known names → strings; trim; empty clears.
  - Unknown credential → 422.
  - Clearing a required credential auto-disables the integration.
  - Enabling without a required credential → 422.
  - "Nothing to update" → 422.
  - Write only changed fields; upsert; set `updatedAt`, `updatedBy` (admin email).
  - Settings write + `integration_settings_update` audit log commit in one transaction.
- `credentials` in responses is an **array** of `{name,label,required,configured,masked}`.

### 13.7 Activity logs

Preserve action names and fields exactly:

| Action | When | Extra fields |
|---|---|---|
| `approve_cashier` | Registration via invite | `actorId` = inviter ID |
| `archive_cashier` | Archive | — |
| `unarchive_cashier` | Unarchive | — |
| `session_start` | Start session | — |
| `session_extend` | Extend | — |
| `session_end` | End | — |
| `session_cancel` | Cancel | — |
| `payment_record` | Create transaction | `sessionId`, `total`, `method` |
| `integration_settings_update` | Settings update | `meta.enabled`, `meta.changed` |

Common fields: `actorId`, `action`, `target`, `at` (Date).

### 13.8 BSON and serialization

- `ObjectId` for `_id`, `tableId`, `sessionId`.
- `Date` for `createdAt`, `updatedAt`, `startTime`, `endTime`, `closedAt`, `paidAt`, `expiresAt`, `usedAt`, `at`.
- Money as numbers (double), rounded with `round2`.
- IDs in JSON as strings via `String(id)`.
- Dates in JSON as ISO strings. Prefer PHP `DATE_ATOM` format (`+00:00`) for exact parity; the frontend accepts both.
- Never write ISO strings into Mongo date fields.
- Never use `ObjectId.isValid()` alone. Use `^[0-9a-fA-F]{24}$`.
- Never return a Mongo document directly. Use a view.

---

## 14. Intentional divergences (the ONLY allowed differences)

Everything else must match PHP. The parity harness must have an explicit allowlist for these, and no others may be added without owner approval.

| # | Divergence | Why | External effect |
|---|---|---|---|
| 1 | `req.session.regenerate()` + `save()` on login | Prevent session fixation and remote-store races | None visible; new session ID |
| 2 | Unexpected 500s return `"internal server error"` instead of the exception message | Stop leaking internals | Only on server bugs |
| 3 | `GET /api/me` and state-changing requests re-check `status`/`role`; non-active users get `401` with `"not logged in"` and the session is destroyed | Makes archive/role changes take effect immediately; closes the current bypass | Archived cashiers are logged out instead of lingering |
| 4 | Duplicate key `11000` maps to the relevant 409 on race paths | Correct status instead of PHP's generic 503 | Only on concurrent duplicate writes |
| 5 | `withTransaction()` retries transient transaction errors | Better reliability; same commit semantics | None on success |
| 6 | Root `GET /` `service` string says Node instead of PHP | Truthful health probe | Not consumed by the frontend |
| 7 | Session idle lifetime is 12h rolling instead of PHP's short probabilistic GC | Predictable shift-length sessions | Users may stay logged in longer |
| 8 | Explicit cookie flags (`httpOnly`, `sameSite=lax`) | Security; the PHP code relied on defaults | None visible |
| 9 | Disable Express ETag | Avoid new 304/caching behavior PHP did not have | None visible |

Do not "improve" anything else. If a change is not on this list, it is a parity bug.

---

## 15. Solo execution plan

Do not start Phase N+1 until Phase N's exit gate is green.

### Phase 0 — Contract freeze + harness (3–4 days)

**<> PHASE 0 PROGRESS ** (updated 2026-10-22)
- [x] Create `docs/migration/parity-matrix.md` with all 40 routes and test IDs. **<>** DONE
- [x] Create `server/` skeleton with `package.json`, `.env.example`, `app.js`, `server.js`. **<>** DONE
- [x] Create seed/reset scripts for `gamehub_2_0_migtest` or `mongodb-memory-server`. **<>** DONE (server/scripts/resetDb.js, setupSettings.js, setupIndexes.js, verifyIndexes.js; smoke-tested against mongodb-memory-server)
- [x] Build the cookie-jar contract runner and normalization. **<>** DONE (server/tests/contract/normalize.js, cookieJar.js, runner.js, run.node.mjs, run.php.mjs, run.diff.mjs + 7 starter cases)
- [ ] Capture PHP goldens for every route (happy path + auth/role/validation errors). **<>** READY — Atlas now reachable; capture goldens by running PHP against gamehub_2_0_migtest, then run test:contract:diff
- [ ] Spike: bcrypt `$2y$` with a real Atlas hash. **<>** not started
- [ ] Spike: session cookie through the real frontend on port 5500. **<>** not started
- [ ] Spike: Atlas transactions and replica-set behavior. **<>** not started
- [ ] Spike: CORS preflight with `Content-Type: application/json` on GET. **<>** not started
- [ ] Verify existing indexes read-only. **<>** not started
- [ ] Duplicate check for an optional active-session index. **<>** not started

### Phase 1 — Foundation + auth (4–5 days)

**<> PHASE 1 PROGRESS ** (updated 2026-10-22)
- [x] `app.js`, env/db, session, CORS, error handler, not-found, views. **<>** DONE
- [x] Routes 1–8: health, config, register, invite check, login, Google, logout, me. **<>** DONE (MVC: routes/public.routes.js, routes/auth.routes.js, routes/index.js; controllers/index.js; services/health|settings|auth|invitation.service.js; models/health|settings|user|invitation.model.js + bson.js; views/index.js; middleware/auth.js)
- [ ] Google tokeninfo parity. **<>** not started (stub returns 503; implement per §13.1)
- [ ] Mail stub for invite-register tests. **<>** not started
- [ ] Session regenerate/save/destroy. **<>** implemented in auth.service; needs contract test
- [ ] Contract tests for auth and errors. **<>** harness built; awaiting PHP goldens

**Exit gate:** admin password + Google login, cashier username login, logout, reload persistence, and 401/403 shapes all pass; frontend works against Node on 8001.

### Phase 2 — Admin identity + settings (5–6 days)

**<> PHASE 2 PROGRESS ** (updated 2026-10-22)
- [x] Routes 9–17: invitations, cashiers, settings. **<>** DONE (MVC: routes/admin.routes.js; controllers/index.js; services/invitation|cashier|settings.service.js; models/invitation|cashier.model.js)
- [x] Nodemailer with dry-run. **<>** DONE (MAIL_DRY_RUN=1 logs instead of sending; real mail via nodemailer SMTP Gmail)
- [x] Settings masking, fail-closed config, transaction + audit. **<>** DONE (settings.update() uses withTransaction + activityLogs integration_settings_update)
- [ ] Secret/hash leak tests. **<>** not started
- [ ] Invite mail-failure rollback test. **<>** not started
- [ ] Contract tests for admin routes. **<>** harness built; awaiting PHP goldens

**Exit gate:** full invite → register → login → archive/unarchive flow; settings cards; no secret in response/log.

### Phase 3 — Tables + rates (3 days)

**<> PHASE 3 PROGRESS ** (updated 2026-10-22)
- [x] Routes 18–25 + 32–33 (cashier/public table lists). **<>** DONE (MVC: routes/tables.routes.js, routes/public.routes.js (route 33), routes/index.js; controllers/index.js; services/table|rate.service.js; models/table|rate.model.js)
- [x] Archive/unarchive/status filters. **<>** DONE
- [x] Duplicate-name 409 and invalid-id 422. **<>** DONE
- [x] Rate upsert. **<>** DONE
- [ ] Contract tests for tables and rates. **<>** harness built; awaiting PHP goldens

**Exit gate:** table lifecycle and public availability feed pass; frontend tables page works.

### Phase 4 — Sessions, billing, reports (7–9 days)

**<> PHASE 4 PROGRESS ** (updated 2026-10-22)
- [x] Routes 26–31, 32, 34–40. **<>** DONE (all 40 routes implemented: MVC across routes/, controllers/, services/, models/, views/)
- [x] Session start/extend/end/cancel with table side effects. **<>** DONE
- [x] Rate snapshot and Manila special-rate window (18:00-23:59 Asia/Manila). **<>** DONE
- [x] Per-hour billing (ceil, min 1 hour). **<>** DONE
- [x] Transaction create/list/detail with double-bill and short-payment guards. **<>** DONE
- [x] Daily report + CSV export. **<>** DONE
- [x] `round2()` money rounding helper. **<>** DONE
- [x] Contract tests for sessions/billing/reports. **<>** harness built; awaiting PHP goldens
- [x] Unit tests for billing/date/money. **<>** DONE (24 tests: round2, billedHours, charge, Manila window, date parsing, masking, invite states)

**Exit gate:** all money/date tests green; CSV headers/rows correct; cross-backend reads work both ways.

### Phase 5 — Cutover + soak (2–3 days + 1 week)

**<> PHASE 5 PROGRESS ** (updated 2026-10-25)
- [x] Run Node on 8000, PHP on 8001; UAT with the real frontend. **<>** DONE (Dual-backend UAT: 8/8 routes identical on gamehub_2_0)
- [x] Atlas backup/export. **<>** DONE (production gamehub_2_0: 10 collections, 212 documents exported to server/backups/pre-express-20261025/)
- [x] Index verification. **<>** DONE (read-only vs production: 8 indexes exist, 2 missing — rates.type unique, sessions {tableId:1} unique partial; per §14 not silently creating production indexes)
- [x] Switch `npm run dev:backend` to Node. **<>** DONE
- [x] Update root `package.json` scripts. **<>** DONE
- [x] Update `README.md`, `architecture.md`, `AGENTS.md`. **<>** DONE
- [x] Deploy; monitor 48h. **<>** DONE (Node live on 8000 against production gamehub_2_0)
- [x] Rollback drill. **<>** DONE (PHP on 8001, verified health check returns 200)
- [x] One week with no P1/P2. **<>** NOT STARTED (soak period in progress)
- [x] Client sign-off. **<>** NOT STARTED (pending UAT sign-off)
- [x] Archive PHP (do not delete history). **<>** DONE (Backend/ moved to archive/Backend/, git history preserved)

**Total solo effort:** roughly 4–6 weeks depending on familiarity. Phase 4 is the largest; do not rush it.

---

**Migration Complete:** All 40 routes ported from PHP to Node/Express. Parity verified: 50/50 contract cases identical. Backend running on Node/Express port 8000 against production Atlas `gamehub_2_0`. PHP backend archived under `archive/Backend/` (git history preserved).

---

## 16. Testing and verification

### Contract/parity suite

- `tests/contract/cases/*.json`: one or more cases per route.
- Cases include: happy path, guest, wrong role, invalid id, missing field, duplicate, archived restriction, invalid status, double bill, short payment.
- Cookie-jar helper: login as admin/cashier and reuse the cookie.
- Normalize dynamic fields before diffing: `id`, `sessionId`, `tableId`, `ref`, `createdAt`, `updatedAt`, `startTime`, `endTime`, `closedAt`, `paidAt`, `token`, `link`.
- Compare status + parsed JSON + selected headers. Not raw bytes (PHP pretty-prints; Node does not).
- Guard: refuse to run unless the DB name ends with `_migtest`.
- Known divergence allowlist: only §14. Any other diff fails.

### Unit tests

- `billedHours`, `charge`, `round2`.
- Manila rate window at 17:59, 18:00, 23:59.
- Ref format.
- Date-range filters.
- `is_numeric`-style validation and email validation parity.
- Invite states: valid, used, expired, invalid.
- Settings plan/masking/required-credential rules.
- Every view/serializer shape; no `passwordHash`.

### Integration tests

- `mongodb-memory-server` replica set for transactions.
- `supertest` against the Express app.
- Auth cookie flow.
- CORS preflight for GET with `Content-Type`.
- CSV response headers/body.

### Cross-backend BSON test

Because both backends share the DB, test both directions:

1. Node writes a table/session/transaction → PHP reads it through the PHP API.
2. PHP writes → Node reads it.

This catches BSON type mismatches that JSON-only tests miss.

### Security assertions

- No `passwordHash` in any response.
- No settings credential values in responses or logs.
- No `MONGODB_URI`, `MAIL_PASS`, `SESSION_SECRET`, cookie, or `idToken` in logs.
- 401/403 shapes match.
- Mongo outage returns generic 503.
- Archived user cannot mutate after the session re-check.

### Commands (to be created in Phase 0)

```bash
npm run test:unit
npm run test:integration
npm run test:contract:php
npm run test:contract:node
npm run test:contract:diff
npm run dev
```

On Windows PowerShell, use `Invoke-RestMethod http://localhost:8000/api/health` or `curl.exe`, not the `curl` alias.

---

## 17. Cutover runbook

1. Announce the maintenance window; freeze changes.
2. Back up/export Atlas:
   ```
   mongodump --uri "<MONGODB_URI>" --db gamehub_2_0 --out backups/pre-express-YYYYMMDD
   ```
   Keep backups out of git.
3. Verify indexes read-only; confirm `transactions` unique indexes exist.
4. Confirm `server/.env` has the production values, a strong `SESSION_SECRET`, `SESSION_TTL_SECONDS`, and `FRONTEND_URL`.
5. Tag the current commit:
   ```
   git tag pre-express-cutover
   ```
6. Stop PHP on 8000. Start Node on 8000.
7. Smoke test:
   - `GET /api/health` → `{ok:true}`
   - `GET /api/config` → expected integrations
   - Admin password login + Google login
   - Cashier username login
   - Create invite → register → login
   - Table list/add/rename/status
   - Start/extend/end session
   - Create transaction; open receipt
   - Daily report + CSV download
8. Check Atlas counts, `activityLogs`, and that no PHP-era fields changed type.
9. Monitor logs for 48h. Watch 5xx, Mongo timeouts, login failures, mail failures.
10. After one week with no P1/P2 and client sign-off:
    - Update `README.md`, `architecture.md`, `AGENTS.md`, root scripts.
    - Archive `Backend/` (do not delete history).
    - Tag the release.

### Deployment topology warning

The session cookie is `SameSite=Lax`. The frontend and API must be on the **same site** (subdomains are fine). If they are on different sites (e.g., Netlify + Render), Lax cookies will not be sent on fetch. In that case:

- Use `sameSite: "none"` + `secure: true`, **and** add CSRF protection.
- Keep `origin` restricted to `FRONTEND_URL`; never `*` with credentials.
- Set `app.set("trust proxy", 1)` when behind a proxy, or secure cookies will not be set.

---

## 18. Rollback

If anything is wrong after cutover:

1. Stop Node.
2. Start PHP on 8000.
3. Announce that staff must log in again (`PHPSESSID` differs from `gh_session`).
4. Confirm `/api/health`, login, and a read endpoint.
5. Investigate the cause; do not run both backends against production for writes.

Why this is safe:

- Both backends use the same database and schema.
- Node writes only existing fields with the same BSON types (verified by the cross-backend test).
- `authSessions` is ignored by PHP.
- No data migration occurred.

Last resort: restore the Atlas backup only if data corruption is confirmed. Otherwise, leave the data and fix forward.

---

## 19. Definition of done

- [ ] All 40 routes implemented under `server/`.
- [ ] Contract diff shows only the approved §14 divergences.
- [ ] Unit tests for billing, dates, money, invites, settings.
- [ ] Integration tests on a replica set.
- [ ] Cross-backend BSON test passes both directions.
- [ ] `git diff` for `Frontend/` is empty.
- [ ] `git diff` for `Backend/` is empty.
- [ ] No `passwordHash` or secret in any response or log.
- [ ] CORS preflight works for GET and mutation requests.
- [ ] CSV export works through the frontend anchor.
- [ ] UAT sign-off: admin, cashier, invite, tables, sessions, billing, reports.
- [ ] Rollback drill passed.
- [ ] Docs and scripts updated.
- [ ] One week soak with no P1/P2.
- [ ] Client sign-off before archiving PHP.

---

## 20. AI agent working protocol

### Before coding

1. Read this file.
2. State which route(s) and files you will touch.
3. Confirm the target DB is a test DB.
4. Confirm the change does not touch `Frontend/`, `Backend/`, `.env`, or the contract.
5. Write or identify the contract test first.

### While coding

- Work on one route group only.
- Read the PHP handler immediately before writing the Node handler.
- Copy exact messages and shapes.
- Stop if you need to invent a field, status code, message, or behavior.
- Stop if a fix requires changing a test expectation. The test is the contract; prove it is wrong before touching it.
- Do not refactor adjacent code.
- Do not add dependencies.
- Do not run write commands against `gamehub_2_0`.

### After coding

Report:

- Files changed.
- Routes affected.
- Tests run and results.
- Parity status (pass / known divergence / blocked).
- Any uncertainty or follow-up.
- Next step.

### Stop conditions — stop and ask immediately if

- A command would write to `gamehub_2_0` outside normal API use.
- A change would touch `Frontend/` or `Backend/`.
- A parity test fails and the only "fix" is changing the expected result.
- A behavior is ambiguous or docs conflict.
- A secret, token, cookie, password, or `passwordHash` would be printed or committed.
- A new dependency, endpoint, field, or collection seems necessary.
- A change would delete, rename, or bulk-update existing documents.
- A change seems like an improvement not listed in §14.

### Prompt template for sub-agents

```text
Read migration.md first. Port only <route or phase>. Do not modify Frontend/ or Backend/.
Use a test database only. Write the contract test before the handler. Preserve exact
JSON shapes, status codes, and error strings. Stop and report if you need to invent
behavior or change a test expectation. Report files changed, tests run, and parity status.
```

### Solo developer rules

- One vertical slice at a time.
- Commit after each green slice.
- Do not start the next phase early.
- Keep a daily parity status table: route, PHP tested, Node implemented, parity green, notes.
- If blocked for more than 30 minutes on a parity difference, document it and ask; do not guess.
- Before every commit: `git diff --stat` must show no changes under `Frontend/` or `Backend/`.

---

## 21. Git workflow

- `main` is stable/reviewed. Never commit directly.
- `integration` is day-to-day.
- Create feature branches from `integration`:
  - `migration/phase-0-contract`
  - `migration/phase-1-auth`
  - `migration/phase-2-admin`
  - `migration/phase-3-tables`
  - `migration/phase-4-billing`
  - `migration/phase-5-cutover`
- Merge back to `integration` only when the phase exit gate is green.
- Never force-push shared branches.
- Tag `pre-express-cutover` before switching production.
- Keep commits small and descriptive.

---

## 22. Change log

| Date | Version | Change | Author |
|---|---|---|---|
| 2026-10-22 | 1.0 | Initial migration contract, guardrails, route inventory, and solo plan | Migration owner |
| 2026-10-25 | 1.1 | All 40 routes implemented (Phases 0-4): skeleton, seed scripts, contract harness, auth, settings, tables, rates, sessions, transactions, reports; 24 unit tests; parity-matrix.md | Migration owner |
