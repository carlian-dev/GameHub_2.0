# Sprint by Carl — What We Built (detailed explanation)

All 10 requirements implemented, tested, and passing. Solo sprint, Steps 0–8
from `Sprint Plan by Carl.md`.

## The 10 requirements and where each lives

| CODE | Requirement | Backend | Frontend |
|---|---|---|---|
| CA-001.1 | Cashier creates account with personal email | `POST /api/cashiers/register` → `AuthController::register` | `register.html` + `register()` |
| CA-001 | Cashier logs in with personal email | `POST /api/login` → `AuthController::login` | `login.html` + `login()` |
| CA-002 | Cashier logs out | `POST /api/logout` → `AuthController::logout` | Logout buttons + `logout()` |
| AD-001 | Admin logs in | Same `POST /api/login` (role=admin) | Same `login.html`, redirects to `admin/cashiers.html` |
| AD-002 | Admin logs out | Same `POST /api/logout` | Same logout button |
| AD-003 | Admin approves email applications | `POST /api/admin/cashiers/{id}/approve` → `CashierController::approve` | Approve button in `admin/cashiers.html` |
| AD-004 | Admin views cashier accounts | `GET /api/admin/cashiers` → `CashierController::list` | Table + filters in `admin/cashiers.html` |
| AD-005 | Admin updates cashier info | `PUT /api/admin/cashiers/{id}` → `CashierController::update` | Edit button, `updateCashier()` |
| AD-006 | Admin archives cashier | `POST /api/admin/cashiers/{id}/archive` → `CashierController::archive` | Archive button, `archiveCashier()` |
| CU-001 | Landing page | (static, no route) | `index.html` rewritten with hall info + links |

## Account lifecycle (the heart of the sprint)

```
register (pending) --approve--> active --archive--> archived
     |                              |                   |
     X login (403)              login OK            X login (403)
```

* New cashiers start `pending` and see "awaiting admin approval" if they try to log in.
* Admin approves → `active` → login works.
* Admin archives → `archived` → login blocked forever, but the record stays for history.
* Login identifier is the personal email (lowercased, unique index in Atlas).
* Passwords: minimum 8 characters, bcrypt hash only. The plain password is never
  stored and never returned by any endpoint.

## New and changed files

**Backend/ (PHP):**
* `src/Controllers/AuthController.php` (new) — `register`, `login`, `logout`, `me`.
  Register validates email format, uniqueness (409), password length (422), inserts
  `pending`. Login checks credentials (401), then status gates (403 pending/archived),
  then writes `$_SESSION['user']`. `me` re-reads the user from Atlas so archived
  users lose access immediately even with a live session cookie.
* `src/Controllers/CashierController.php` (new) — `list` (filter by status, never
  returns `passwordHash`), `approve` (pending→active only, else 422), `update`
  (only `displayName` + `schedule` may change — role/email/passwordHash are
  deliberately excluded so nobody escalates via edit forms), `archive`
  (idempotent, sets `archived`). Approve/archive write to `activityLogs`.
* `src/Helpers/request.php` (new) — `json_body()` reads `php://input` because PHP
  does not fill `$_POST` for JSON fetch bodies.
* `src/Helpers/auth.php` (new) — `current_user()`, `require_login()` (401),
  `require_admin()` (401 guest / 403 cashier).
* `src/Helpers/response.php` — added `api_abort($msg, $code)` so controllers throw
  `400/401/403/404/409/422` and `index.php` converts them to JSON.
* `public/index.php` — added `session_start()`, `Access-Control-Allow-Credentials`,
  route patterns with `{id}` placeholders, error-code mapping (unknown → 500).
  Open the Frontend via `http://localhost:PORT` (same-site) so the session cookie
  is sent; `.env` `FRONTEND_URL` changed from `127.0.0.1` to `localhost` for this.
* `routes/api.php` — 8 new lines for the routes above; health route untouched.
* `.env` / `.env.example` — `FRONTEND_URL=http://localhost:5500` (was 127.0.0.1).

**Frontend/ (pure HTML/CSS/JS):**
* `register.html` (new) — email + password + confirm, client-side match check,
  shows exact Backend messages (409/422) and "awaiting admin approval" on success.
* `login.html` (new) — role redirect (admin → `admin/cashiers.html`, cashier →
  home), shows 401/403 messages verbatim.
* `admin/cashiers.html` (new) — guarded by `getMe()` (non-admin bounced to login),
  status filter buttons, table with Approve (pending only), Edit (prompts),
  Archive (confirm dialog, greyed rows for archived).
* `js/api.js` — added `api()` helper (always `credentials:"include"` + JSON) and
  8 functions: `register/login/logout/getMe/listCashiers/approveCashier/
  updateCashier/archiveCashier`. Without `credentials:"include"`, login would
  succeed but the next call would look like a stranger (401).
* `index.html` — CU-001 landing content + links to register/login.

**Atlas `gamehub_2_0` (auto-created on first write):**
* `users` — `{email unique, passwordHash, role, status, displayName, schedule,
  createdAt}` + unique index on `email`. Seeded `admin@gamehub.local` / `Admin123!`.
* `activityLogs` — `{actorId, action, target, at}` for approve/archive.

## Status codes used (for the whole team)

400 bad request · 401 not logged in / wrong password · 403 not allowed
(pending/archived/cashier-on-admin-route) · 404 not found · 409 duplicate email ·
422 invalid data (bad email, short password, bad id, nothing to update).

## Verification results (all 16 passed 2026-09-25, then test user deleted)

health 200 · register 200 pending+id · duplicate 409 · short-pw 422 ·
pending-login 403 · admin-login 200 · list-pending shows user, no hash ·
approve→active · cashier-login 200 · cashier-on-admin-route 403 ·
update persists · bad-id 422 · archive→archived · archived-login 403 ·
wrong-pw 401 · logout→/api/me 401. Compass confirms only
`admin@gamehub.local (admin, active)` remains.

## How to run — `npm run dev` (one command)

From `C:\GameHub_2.0`, run `npm run dev` (after a one-time `npm install`).
It starts both servers at once and opens the Frontend in your browser:

* Backend (PHP): `http://localhost:8000` — same `php -S localhost:8000 -t Backend/public` as before.
* Frontend (live-reload): `http://localhost:5500` — edit any file in `Frontend/` and the browser refreshes itself.
* Stop everything with `Ctrl+C` (`--kill-others` stops both servers together).

Files added for this (dev tooling only — the 10 features are untouched):
* `package.json` — scripts `dev` (both), `dev:backend`, `dev:frontend`; devDependencies `concurrently` + `live-server`.
* `.gitignore` (repo root) — ignores `node_modules/`, `Backend/vendor/`, `Backend/.env`.

Verified 2026-09-25: one `npm run dev` → Backend `/api/health` returns
`{ok:true, db:gamehub_2_0}` and Frontend `/` returns 200 with the landing page.
Ports stay 8000/5500 to match `API_BASE_URL`, `.env` `FRONTEND_URL`, and the
localhost-only session cookie rule. If a port is busy, change it in
`package.json` AND the matching config (Backend port → `Frontend/js/config.js`;
Frontend port → `Backend/.env` `FRONTEND_URL`).

Legacy manual way still works: `php -S localhost:8000 -t Backend/public` plus
any static server or VSCode Live Server on `http://localhost:5500`.

1. Log in as `admin@gamehub.local` / `Admin123!` → change the password after first login.

## What's next (not built)

Remaining matrix items (tables, rates, sessions, reservations, F&B, reports),
`displayName`/`schedule` fields on registration, password change/reset, and
replacing the `prompt()`/`confirm()` dialogs with styled modals.
