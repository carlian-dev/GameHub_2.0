# GameHub_2.0

Billiard-hall management system for GameHub (Rooftop, Paz Building,
San Isidro St, Malaybalay City, Bukidnon). It covers staff identity and
access, cashier account administration, billiard-table and rate management,
customer sessions, reservations, billing and payments, reporting, and audit
logging across four roles: Super Administrator, Administrator, Cashier, and
walk-in Customer. The super administrator is intentionally limited to
managing API integrations and their credentials (plus their own
authenticator-app 2FA); administrators run the hall.

The system is intentionally built with a small, explainable stack: a
Node/Express JSON API backed by MongoDB Atlas, and a dependency-free
HTML/CSS/JS frontend. Express is the one and only backend; the former PHP
backend was archived under `archive/Backend/` and is not used at runtime.

## Features (by delivery)

* **Sprint 1 — Identity & staff administration.** Cashier self-registration
  (username accounts), Google sign-in for the administrator account,
  invitation-only registration, administrator approval / decline of applicants,
  archiving with a confirmation step, role-based dashboards.
* **Sprint 2 — Tables, rates, sessions foundation.** Billiard-table
  add/rename/archive/maintenance/status views, regular (₱120/h) and special
  (₱180/h) hourly rates, and an active-sessions view (session lifecycle
  operations follow in a later sprint).
* **Super administrator — API integration control.** A least-privilege account
  that owns integration activation and credentials; administrators see
  integration state read-only.
* **Planned next.** Session start/extend/end with per-minute billing,
  reservations with overlap protection, accepted-reservation email alerts, food & beverage ordering, cash/GCash
  payments with receipts, daily/monthly/usage reports with export.

## Prerequisites

* Node.js 18+ and npm (runs the Express backend and the dev frontend).
* Network access to the MongoDB Atlas cluster (connection string is private).
* Optional, archive reference only: PHP >= 8.1 with the `mongodb` extension
  and Composer 2.x, if you ever need to inspect `archive/Backend/`.

## Quickstart (5 minutes)

1. Install dependencies:
   ```
   npm install
   cd server
   npm install
   ```
   (No Composer install is needed for normal use; `archive/Backend/vendor/`
   already exists if you only want to read the archived PHP code.)

2. Configure secrets (never commit these files):
   ```
   copy server\.env.example server\.env       # Node/Express backend
   ```
   Fill in `MONGODB_URI`, `MONGODB_DB`, `FRONTEND_URL`, `NODE_ENV`
   (required — the backend refuses to start without it), `GOOGLE_CLIENT_ID`,
   `SESSION_SECRET`, `JWT_SECRET`, `JWT_TTL_SECONDS`, `AUTH_COOKIE_NAME`,
   `MAIL_USER`/`MAIL_PASS`/`MAIL_FROM` (for invite mail),
   and `TRUST_PROXY` if behind a proxy. Only used by the Express backend.
   Optional Google Calendar sync uses `GOOGLE_CALENDAR_ID`,
   `GOOGLE_CALENDAR_CLIENT_EMAIL`, `GOOGLE_CALENDAR_PRIVATE_KEY` (see
   `server/.env.example` and the steps below); leave them blank to disable it.
   After filling them, run `cd server && npm run check:calendar` to verify the
   service-account key, Calendar API enablement, and calendar sharing.
   Optional reCAPTCHA uses `RECAPTCHA_SITE_KEY`/`RECAPTCHA_SECRET_KEY`, or the
   super-admin API Integrations page (recommended). Saving a credential there writes it
   to the matching `*_OVERRIDE` key in `server/.env`; when an override is empty,
   the normal env key above is used. Set `SETTINGS_ENCRYPTION_KEY` before
   saving any secret key; generate one with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

3. Create the first administrator directly in the `users` collection
   (MongoDB Compass): `{ email, passwordHash (bcrypt), role: "admin",
   status: "active" }`. The system is single-administrator by design; no
   endpoint creates administrators. To use the integration on/off controls,
   create a second account the same way with `role: "super_admin"`. Generate a
   bcrypt hash from `server/` with:
   `node -e "console.log(require('bcryptjs').hashSync('YourPassword',10))"`.
   If you used archive/Backend/scripts/seed_local.php, the seeded admin signs
   in with email jamespepito833@gmail.com and password AdminPass123!.

4. Run everything with one command (from the repository root):
   ```
   npm run dev
   ```
   Backend (Node/Express) serves on `http://localhost:8000`, the Frontend on
   `http://localhost:5500` with live reload. Open the Frontend address
   (localhost, not 127.0.0.1 — login sessions depend on it).

   The archived PHP server is not part of the app anymore; it lives in
   `archive/Backend/` for historical reference only.

5. Staff entry points: customer landing at `/`, staff login at `/login`,
   cashier registration at `/src/function/auth/register.html`.

## Project structure

```
GameHub_2.0/
  server/
    src/
      server.js           listen + graceful shutdown
      app.js              Express app, middleware, routes
      config/
        env.js            env validation, fail-fast, assertTestDb guard
        db.js             one MongoClient per process (native driver)
      routes/             route groups under /api
      controllers/        HTTP in/out only
      services/           business rules, transactions, audit logs
      models/             named Mongo queries + BSON conversions
      views/              JSON serializers (MVC View)
      middleware/         auth guards, error mapping, not-found, CORS, session
      utils/              HttpError, asyncHandler, mask, numbers, logger, dates
    tests/                unit + contract tests
    scripts/              one-time setup (resetDb, setupSettings, setupIndexes, verifyIndexes)
    .env / .env.example   Secrets (ignored) / safe template (committed)
    package.json          ESM, Express 5, native mongodb driver
  archive/Backend/        Former PHP backend (archived, not used at runtime)
    public/index.php      Old single entry point (historical reference)
    routes/api.php        Old route table: METHOD + PATH -> handler function
    src/Config/           Old database connection singleton
    src/Helpers/          Old JSON responses, request parsing, auth guards
    src/function/auth/    Old login, registration, Google, one-time codes
    src/function/admin/   Old staff (applicant/cashier) administration
    src/function/cashiers/ Old cashier-role endpoints
    src/function/tables/  Old tables, rates, sessions reads
    src/function/shared/  Old health check
    .env / .env.example   Archived secrets (ignored) / old template
  Frontend/
    index.html              Customer landing (hero, location map)
    login/index.html        Redirect so bare /login resolves
    src/function/auth/      Login, registration pages + logic
    src/function/admin/     Admin dashboard, staff, credentials, operations
    src/function/super-admin/ Integration activation and credentials
    src/function/cashiers/  Cashier dashboard
    src/function/tables/    Tables, sessions pages
    src/function/shared/    Landing status logic
    js/                     Shared config, API wrapper, shell behavior
    css/                    Landing styles + dashboard shell theme
  docs/                     Requirements, sprint plans, build reports
```

## Roles and account lifecycle

* Accounts are `pending` at creation, then `active`, `archived`, or
  `declined` by administrator action. Only `active` accounts can log in.
* Cashiers register with a chosen username and password (no email required).
  The single administrator and the super administrator sign in with
  email + password or Google.
* The super administrator owns API integration activation and credentials on
  the API Integrations page
  (`/src/function/super-admin/integrations.html`); failed-login limits live on
  the Login protection page and authenticator devices on the Security page.
  Administrators can view
  integration state on Admin > Settings > API but cannot change credentials or
  toggle a service; the server rejects both. Super-admin sign-in is
  single-step; an authenticator app (TOTP) is only required to add, replace or
  clear an integration credential. Up to five devices can be paired at once
  (Security page): each has its own secret and any one can approve a change, so
  a backup phone keeps working if the first is lost. Remove a single device
  there. If every device is lost, run `npm run reset:2fa -- --email
  <super-admin email> --yes` from `server/` (dry run without `--yes`), reload
  the Security page, and pair a new app — no old code is required. There is no
  in-app bypass by design (see AGENTS.md).
* There is no OTP or email-code step: cashier signup is invitation-only
  (the emailed invite link carries the token) and archiving is a one-step
  administrator action with a confirmation dialog. Day-to-day login is direct
  JWT authentication after the status gates.
* Authentication is stateless JWT (HS256, `JWT_SECRET`): login and Google
  sign-in return a token that is also set as the `AUTH_COOKIE_NAME`
  (`gh_token`) HttpOnly cookie — `sameSite=lax`, `path=/`, `secure` in
  production, `JWT_TTL_SECONDS` (12h default). There is no server-side session
  store; `Authorization: Bearer <jwt>` works too. Logging out clears the cookie
  and bumps `users.tokenVersion`, which rejects every older token.
* `GET /api/me` re-reads the account from Atlas on every guarded page load,
  so an archive or role change takes effect immediately.

## Configuration

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string (secret) |
| `MONGODB_DB` | Database name (`gamehub_2_0` production, `gamehub_2_0_migtest` for tests) |
| `MONGODB_DNS_SERVERS` | Optional resolver(s) for Atlas SRV lookups, e.g. `8.8.8.8,1.1.1.1` (only if startup says `querySrv ECONNREFUSED`) |
| `FRONTEND_URL` | Allowed CORS origin for the Frontend |
| `PORT` | Backend listen port (`8000`) |
| `GOOGLE_CLIENT_ID` | Google OAuth web client (public identifier); the admin value is mirrored to `GOOGLE_AUTH_CLIENT_ID_OVERRIDE` |
| `GOOGLE_MAPS_API_KEY` | Optional Google Maps key for the landing page; the admin value is mirrored to `GOOGLE_MAPS_API_KEY_OVERRIDE` |
| `GOOGLE_CALENDAR_ID` / `GOOGLE_CALENDAR_CLIENT_EMAIL` / `GOOGLE_CALENDAR_PRIVATE_KEY` | Optional service-account sync: accepted reservations become events on this shared calendar (blank = disabled); admin values use the matching `*_OVERRIDE` keys |
| `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` | Optional reCAPTCHA v2 defaults, used whenever the matching admin value is empty; admin values use `RECAPTCHA_SITE_KEY_OVERRIDE` / `RECAPTCHA_SECRET_KEY_OVERRIDE` |
| `*_OVERRIDE` (all integrations) | Filled automatically by the super-admin API Integrations page. Precedence: override, then the normal env key, then the settings document. Clearing an admin value falls back to the normal env key |
| `SETTINGS_ENCRYPTION_KEY` | 32 random bytes as 64 hex chars; required before saving secret credentials (reCAPTCHA secret key, Calendar private key, super-admin 2FA secrets). Stored secrets use AES-256-GCM |
| `MAIL_USER` / `MAIL_PASS` | Gmail sender + app password (cashier invitations and accepted-reservation emails) |
| `MAIL_FROM` | Display name on outgoing mail |
| `SESSION_SECRET` | 32 random bytes as 64 hex chars (also derives the 2FA encryption key when `SETTINGS_ENCRYPTION_KEY` is blank) |
| `JWT_SECRET` | Signs the stateless auth JWT (HS256); blank = reuse `SESSION_SECRET` |
| `JWT_TTL_SECONDS` | Auth token lifetime (default 43200 = 12h) |
| `AUTH_COOKIE_NAME` | HttpOnly JWT cookie name (default `gh_token`) |
| `TRUST_PROXY` | `0`, `1`, or hop count when behind a proxy |
| `RATE_LIMIT_ENABLED` | `0` disables all request rate limiting (default on) |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | Global per-IP `/api` budget (default 300 requests per 60s) |
| `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX` | Default failed auth limit (10 per 15 min); Super Admin > Login protection can override it at runtime, per IP |
| `WRITE_RATE_LIMIT_MAX` | POST/PUT/PATCH/DELETE budget per user/IP per `RATE_LIMIT_WINDOW_MS` (default 60) |
| `ACTION_RATE_LIMIT_WINDOW_MS` / `ACTION_RATE_LIMIT_MAX` | Per-action cooldown for every mutation: how many identical clicks are allowed and how long (ms) the action stays locked afterwards, keyed by user/IP + method + path + payload hash (default 1 request per 1s) |
| `RESERVATION_RATE_LIMIT_WINDOW_MS` / `RESERVATION_RATE_LIMIT_MAX` | Guest reservation create/lookup/cancel per IP (default 10 per 10 min) |
| `MAIL_DRY_RUN` | `1` to log instead of sending mail (tests) |

## Billing

Session bills are settled manually at the counter. Cash and counter GCash are
recorded as payment entries; no online checkout or payment-provider webhook is
involved.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Backend (Node, 8000) + Frontend (5500) with live reload |
| `npm run dev:backend` | Node/Express backend alone |
| `npm run dev:frontend` | Frontend alone |
| `npm run seed` | Seed `gamehub_2_0_migtest` (test DB only) |
| `npm run setup:settings` | Idempotent settings document seed (test DB only) |
| `npm run setup:indexes` | One-time index creation (test DB only) |
| `npm run verify:indexes` | Read-only index verification (test DB only) |
| `npm run reset:2fa -- --email <email> [--yes]` | Operator recovery for a lost super-admin authenticator (run in `server/`; writes the configured DB, dry run without `--yes`) |
| `npm run test:unit` | Unit tests |
| `npm run test:contract` | Contract tests against Node backend |

Backend has no build step; npm manages all runtime dependencies.
The archived PHP tree under `archive/Backend/` is read-only history and is
never started by any npm script.

## Testing basics

* Health: `GET http://localhost:8000/api/health` must return `ok:true`.
* Staff flow: register (with invite token) → approve as administrator → log in →
  archive / unarchive, checking Atlas (`users`, `activityLogs`) at each step.
* Per-sprint acceptance tables live in `docs/Sprint_001-(E01).md` and
  `docs/Sprint02-report.md`.

## Documentation index

* `docs/01-requirements-matrix.md` — the tracked requirement table.
* `docs/03-sprint-plan.md`, `docs/Sprint_001-(P01).md` — sprint plans.
* `docs/Sprint_001-(E01).md`, `docs/Sprint02-report.md`,
  `docs/Google-Auth-report.md` — what was built, per sprint/feature.
* `architecture.md` — system design (start there for onboarding).
* `AGENTS.md` — repository rules for agents and contributors.
* `migration.md` — PHP → Node migration contract and progress.

## Branching and team

* `main` — stable, reviewed code. `integration` — day-to-day team work;
  feature work branches from `integration` and merges back for testing.
* Secrets (`.env`, `vendor/`, `node_modules/`) are ignored and never committed.
* Migration work is on `migration/phase-0-contract` (Phases 0-4 complete).
  Phase 5 (cutover) is in progress.

## Limitations (current)

* Cashier login is password-only (cashier accounts carry no email for codes).
* Exactly one administrator account exists; none can be created or archived
  through the application. A super administrator account is also created
  directly in the database and is limited to integration activation and
  credentials.