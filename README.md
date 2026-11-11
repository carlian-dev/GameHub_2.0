# GameHub_2.0

Billiard-hall management system for GameHub (Rooftop, Paz Building,
San Isidro St, Malaybalay City, Bukidnon). It covers staff identity and
access, cashier account administration, billiard-table and rate management,
customer sessions, reservations, billing and payments, reporting, and audit
logging across four roles: Super Administrator, Administrator, Cashier, and
walk-in Customer. The super administrator is intentionally limited to turning
API integrations on and off; administrators configure credentials and run the
hall.

The system is intentionally built with a small, explainable stack: a
Node/Express JSON API backed by MongoDB Atlas, and a dependency-free
HTML/CSS/JS frontend. Express is the one and only backend; the former PHP
backend was archived under `archive/Backend/` and is not used at runtime.

## Features (by delivery)

* **Sprint 1 — Identity & staff administration.** Cashier self-registration
  (username accounts), Google sign-in for the administrator account, email
  one-time codes for sensitive steps, administrator approval / decline of
  applicants, archiving with re-verification, role-based dashboards.
* **Sprint 2 — Tables, rates, sessions foundation.** Billiard-table
  add/rename/archive/maintenance/status views, regular (₱120/h) and special
  (₱180/h) hourly rates, and an active-sessions view (session lifecycle
  operations follow in a later sprint).
* **Super administrator — API integration control.** A least-privilege account
  that can only turn the configured API integrations on or off. Integration
  credentials stay with the administrator.
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
   `SESSION_SECRET`, `SESSION_TTL_SECONDS`, `AUTH_COOKIE_NAME`,
   `MAIL_USER`/`MAIL_PASS`/`MAIL_FROM` (for invite mail),
   and `TRUST_PROXY` if behind a proxy. Only used by the Express backend.
   Optional Google Calendar sync uses `GOOGLE_CALENDAR_ID`,
   `GOOGLE_CALENDAR_CLIENT_EMAIL`, `GOOGLE_CALENDAR_PRIVATE_KEY` (see
   `server/.env.example` and the steps below); leave them blank to disable it.
   After filling them, run `cd server && npm run check:calendar` to verify the
   service-account key, Calendar API enablement, and calendar sharing.
   Optional reCAPTCHA uses `RECAPTCHA_SITE_KEY`/`RECAPTCHA_SECRET_KEY`, or the
   admin Settings > API page (recommended). Saving a credential there writes it
   to the matching `*_OVERRIDE` key in `server/.env`; when an override is empty,
   the normal env key above is used. Set `SETTINGS_ENCRYPTION_KEY` before
   saving any secret key; generate one with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   PayMongo is configured in Admin > Settings > API too: add the secret key
   (plus the webhook signing secret for automatic production confirmation),
   then enable the card. The webhook endpoint is
   `POST /api/paymongo/webhook`; for local development expose it with a public
   tunnel or rely on the cashier page's checkout-status polling (no webhook
   required for a manual test).

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
    src/function/super-admin/ Integration on/off control (no credentials)
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
* The super administrator's only feature is turning API integrations on or
  off at `/src/function/super-admin/integrations.html`. Administrators manage
  the credentials on Admin > Settings > API but cannot send the on/off flag;
  the server rejects it.
* One-time email codes protect account creation verification and
  destructive approvals (archiving). Day-to-day login is direct session
  authentication after the status gates.
* Sessions are server-side `express-session` stored in MongoDB
  `authSessions` collection (not `sessions`, to avoid collision with
  billing sessions). Cookie `gh_session` is `httpOnly`, `sameSite=lax`,
  `path=/`, `secure` in production, rolling 12h TTL.
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
| `PAYMONGO_SECRET_KEY` / `PAYMONGO_WEBHOOK_SECRET` | Optional PayMongo defaults; admin values use `PAYMONGO_SECRET_KEY_OVERRIDE` / `PAYMONGO_WEBHOOK_SECRET_OVERRIDE` |
| `*_OVERRIDE` (all integrations) | Filled automatically by Admin > Settings > API. Precedence: override, then the normal env key, then the settings document. Clearing an admin value falls back to the normal env key |
| `SETTINGS_ENCRYPTION_KEY` | 32 random bytes as 64 hex chars; required before saving secret credentials (reCAPTCHA secret key, Calendar private key, PayMongo keys). Stored secrets use AES-256-GCM |
| `MAIL_USER` / `MAIL_PASS` | Gmail sender + app password (cashier invitations and accepted-reservation emails) |
| `MAIL_FROM` | Display name on outgoing mail |
| `SESSION_SECRET` | 32 random bytes as 64 hex chars |
| `SESSION_TTL_SECONDS` | Session rolling TTL (default 43200 = 12h) |
| `AUTH_COOKIE_NAME` | Session cookie name (default `gh_session`) |
| `TRUST_PROXY` | `0`, `1`, or hop count when behind a proxy |
| `MAIL_DRY_RUN` | `1` to log instead of sending mail (tests) |

### PayMongo

PayMongo is optional and disabled by default. Configure it in
**Admin > Settings > API > PayMongo**:

* **Secret key** — from the PayMongo dashboard (test or live mode).
* **Webhook signing secret** *(optional but recommended for production)* —
  created when you add a webhook endpoint at
  `<backend-public-url>/api/paymongo/webhook` with the
  `checkout_session.payment.paid` event. Without it, the webhook endpoint
  rejects requests; the cashier page still confirms payments by polling the
  checkout status, so local testing does not need a public tunnel.

Only GCash is enabled in the hosted checkout for now. When a cashier selects
**GCash online** in a closed session’s bill sheet, the server locks the bill,
creates a PayMongo Checkout Session for the exact total, and shows the hosted
payment page. Payment is recorded automatically by the signed webhook or by the
cashier’s status check (polling works without a public tunnel). Cancelling the
link releases the bill lock after asking PayMongo to expire the session.

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
  directly in the database and is limited to integration on/off.