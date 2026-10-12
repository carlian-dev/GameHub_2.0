# GameHub_2.0

Billiard-hall management system for GameHub (Rooftop, Paz Building,
San Isidro St, Malaybalay City, Bukidnon). It covers staff identity and
access, cashier account administration, billiard-table and rate management,
customer sessions, reservations, billing and payments, reporting, and audit
logging across three roles: Administrator, Cashier, and walk-in Customer.

The system is intentionally built with a small, explainable stack: a PHP
JSON API backed by MongoDB Atlas, and a dependency-free HTML/CSS/JS frontend.

## Features (by delivery)

* **Sprint 1 — Identity & staff administration.** Cashier self-registration
  (username accounts), Google sign-in for the administrator account, email
  one-time codes for sensitive steps, administrator approval / decline of
  applicants, archiving with re-verification, role-based dashboards.
* **Sprint 2 — Tables, rates, sessions foundation.** Billiard-table
  add/rename/archive/maintenance/status views, regular (₱120/h) and special
  (₱180/h) hourly rates, and an active-sessions view (session lifecycle
  operations follow in a later sprint).
* **Planned next.** Session start/extend/end with per-minute billing,
  reservations with overlap protection, food & beverage ordering, cash/GCash
  payments with receipts, daily/monthly/usage reports with export.

## Prerequisites

* PHP >= 8.1 with the `mongodb` extension enabled.
* Composer 2.x.
* Node.js 18+ and npm (development servers only).
* Network access to the MongoDB Atlas cluster (connection string is private).

## Quickstart (5 minutes)

1. Install dependencies:
   ```
   npm install
   cd Backend
   composer install
   ```
2. Configure secrets (never commit this file):
   ```
   copy Backend\.env.example Backend\.env
   ```
   Fill in `MONGODB_URI`, `MONGODB_DB=gamehub_2_0`, `FRONTEND_URL`,
   `GOOGLE_CLIENT_ID`, and the `MAIL_*` Gmail sender keys.
3. Create the first administrator directly in the `users` collection
   (MongoDB Compass): `{ email, passwordHash (bcrypt), role: "admin",
   status: "active" }`. The system is single-administrator by design; no
   endpoint creates administrators.
4. Run everything with one command (from the repository root):
   ```
   npm run dev
   ```
   Backend serves on `http://localhost:8000`, the Frontend on
   `http://localhost:5500` with live reload. Open the Frontend address
   (localhost, not 127.0.0.1 — login sessions depend on it).
5. Staff entry points: customer landing at `/`, staff login at `/login`,
   cashier registration at `/src/function/auth/register.html`.

## Project structure

```
GameHub_2.0/
  Backend/
    public/index.php        Single entry point (routing, CORS, sessions)
    routes/api.php          Route table: METHOD + PATH -> handler function
    src/Config/             Database connection singleton
    src/Helpers/            JSON responses, request parsing, auth guards
    src/function/auth/      Login, registration, Google, one-time codes
    src/function/admin/     Staff (applicant/cashier) administration
    src/function/cashiers/  Reserved for cashier-role endpoints
    src/function/tables/    Tables, rates, sessions reads
    src/function/shared/    Health check
    .env / .env.example     Secrets (ignored) / safe template (committed)
  Frontend/
    index.html              Customer landing (hero, location map)
    login/index.html        Redirect so bare /login resolves
    src/function/auth/      Login, registration pages + logic
    src/function/admin/     Admin dashboard, applicants/staff table
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
  The single administrator signs in with email + password or Google.
* One-time email codes protect account creation verification and
  destructive approvals (archiving). Day-to-day login is direct session
  authentication after the status gates.

## Configuration

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string (secret) |
| `MONGODB_DB` | Database name (`gamehub_2_0`) |
| `FRONTEND_URL` | Allowed CORS origin for the Frontend |
| `PORT` | Backend listen port (`8000`) |
| `GOOGLE_CLIENT_ID` | Google OAuth web client (public identifier) |
| `MAIL_USER` / `MAIL_PASS` | Gmail sender + app password (secrets) |
| `MAIL_FROM` | Display name on one-time-code mails |

## Scripts

* `npm run dev` — Backend (8000) + Frontend with live reload (5500) together.
* `npm run dev:backend` / `npm run dev:frontend` — either server alone.
* Backend has no build step; Composer manages PHP dependencies.

## Testing basics

* Health: `GET http://localhost:8000/api/health` must return `ok:true`.
* Staff flow: register → approve as administrator → log in → archive /
  unarchive, checking Atlas (`users`, `activityLogs`) at each step.
* Per-sprint acceptance tables live in `docs/Sprint_001-(E01).md` and
  `docs/Sprint02-report.md`.

## Documentation index

* `docs/01-requirements-matrix.md` — the tracked requirement table.
* `docs/03-sprint-plan.md`, `docs/Sprint_001-(P01).md` — sprint plans.
* `docs/Sprint_001-(E01).md`, `docs/Sprint02-report.md`,
  `docs/Google-Auth-report.md` — what was built, per sprint/feature.
* `architecture.md` — system design (start there for onboarding).

## Branching and team

* `main` — stable, reviewed code. `integration` — day-to-day team work;
  feature work branches from `integration` and merges back for testing.
* Secrets (`.env`, `vendor/`, `node_modules/`) are ignored and never committed.

## Limitations (current)

* Cashier login is password-only (cashier accounts carry no email for codes).
* Exactly one administrator account exists; none can be created or archived
  through the application.
* Special-rate trigger conditions and session lifecycle operations are
  scheduled for upcoming sprints (see the sprint plans in `docs/`).
