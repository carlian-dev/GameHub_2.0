# AGENTS.md — GameHub_2.0

Small static-frontend + Node/Express-API + MongoDB Atlas stack. No framework, no build, no test/lint/CI.

## Setup

- Prereqs: PHP >= 8.1 with `mongodb` extension (for rollback only), Composer 2.x (for rollback only), Node 18+, network access to Atlas.
- Install: `npm install`, then from `Backend/`: `composer install` (rollback only), then from `server/`: `npm install`.
- Secrets: `copy Backend\.env.example Backend\.env` (Windows) for PHP rollback; `copy server\.env.example server\.env` for Node and fill `MONGODB_URI`, `MONGODB_DB`, `FRONTEND_URL`, `GOOGLE_CLIENT_ID`, `MAIL_USER`/`MAIL_PASS`/`MAIL_FROM`, `SESSION_SECRET`. Never commit `Backend/.env` or `server/.env`; `Backend/vendor/` and `node_modules/` are also ignored.
- First admin has no endpoint — insert directly into `users` (`{ email, passwordHash (bcrypt), role: "admin", status: "active" }`). Single-admin by design.

## Run

- `npm run dev` — backend `:8000` (Node/Express) + frontend `:5500` with live reload. Or `npm run dev:backend` / `npm run dev:frontend` alone.
- `npm run dev:backend:php` — run PHP backend on `:8000` for rollback testing.
- Backend: `cd server && npm run dev` (Node, `node --watch src/server.js`). Frontend: `live-server Frontend --host=localhost --port=5500`.
- Always open the frontend via `http://localhost:5500` (not `127.0.0.1`): session cookie is `Lax` on `localhost` and CORS allows exactly one `FRONTEND_URL` origin with credentials.
- Backend base URL lives only in `Frontend/js/config.js` (`API_BASE_URL`); change it there once if the port moves.

## Architecture

- Backend entry: `server/src/server.js` (loads `.env`, starts server, sets up graceful shutdown). Route table: `server/src/routes/index.js` — mounts route groups under `/api`. Only file mapping URL groups to code.
- Handlers: plain global functions in `server/src/controllers/index.js`. Controllers call services, services call models, models use native `mongodb` driver. Views serialize JSON. Errors: `api_abort(msg, code)` → `{ok:false, error}` with status. Shared: `server/src/config/env.js` (env validation, fail-fast), `server/src/config/db.js` (one `MongoClient` per process), `server/src/middleware/errorHandler.js` (error mapping), `server/src/middleware/notFound.js` (404 JSON), `server/src/middleware/auth.js` (requireLogin/requireAdmin).
- Frontend mirrors backend areas under `Frontend/src/function/<area>/` (paired 1:1). Shared client: `Frontend/js/api.js` — all calls must use `credentials: "include"` or auth silently breaks; `Frontend/js/dash.js` — `dashConfirm`/`dashPrompt`/`dashSelect`/`dashEditCashier` dialogs (no native popups) and the admin settings gear menu. Styles: `css/styles.css` (landing/auth), `css/dashboard.css` (staff shell), `css/settings.css` (admin settings/menu).
- Entry pages: `/` (customer landing), `/login` (redirect shim in `login/index.html`), cashier registration at `/src/function/auth/register.html`.

## Auth / data rules (do not break)

- Account lifecycle: `pending → active → archived` (plus `decline → declined`, terminal). Only `active` logs in; `GET /api/me` re-reads Atlas every guarded page load.
- Cashier registration is invitation-only: admin invites by email (`/api/admin/invitations`), register requires matching `token + email`. Admin signs in via email+password or Google (the `googleAuth` setting's client ID is verified server-side). Cashier login is username+password only (no email codes).
- No OTP/email-code system: archive is one-step (confirm dialog → `POST /api/admin/cashiers/{id}/archive`). Login never issues codes.
- Role comes from the server session only — never trust request data. Every listing/state-changing endpoint re-checks `require_login`/`require_admin`. List endpoints project out password hashes; plain secrets never touch logs/responses, and private credential values are never returned (admin settings expose only `configured` + `masked`).
- Collections in `gamehub_2_0`: `users` (partial-unique `email`, sparse-unique `username`), `tables` (unique `name`), `rates`, `sessions`, `invitations`, `activityLogs`, `settings` (unique `key`), `healthcheck`, `authSessions` (Node session store, ignored by PHP). Approve/decline/archive/unarchive and integration updates write `activityLogs`.
- Integration state lives in `settings` (DB authoritative); env `GOOGLE_CLIENT_ID` is only the default when no `googleAuth` document exists. Create the index/seed keys once with `npm run setup:settings`; never per request.

## Verify (no automated suite)

- Health: `GET http://localhost:8000/api/health` → `{ok:true}`.
- Staff flow is manual: register (with invite token) → approve as admin → login → archive/unarchive; confirm in Atlas (`users`, `activityLogs`). Acceptance tables: `docs/Sprint_001-(E01).md`, `docs/Sprint02-report.md`.
- `node --watch` is single-threaded; 185–1200ms reads are normal (TLS/connection setup, not queries). Don't micro-optimize queries. Per-request index creation/rate seeding was already removed — keep seeding/index setup as one-time scripts, never per-request.

## Workflow

- Branches: `main` = stable/reviewed, `integration` = day-to-day; feature branches fork from `integration` and merge back for testing.
- Onboarding order: `README.md` → `architecture.md` → `docs/` sprint reports. If docs conflict with `routes/api.php` or scripts, trust the executable source.
- Migration branch: `migration/phase-0-contract` contains all Node/Express backend code (Phases 0-4 complete). Phase 5 (cutover) is in progress.