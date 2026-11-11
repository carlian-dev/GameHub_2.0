# AGENTS.md — GameHub_2.0

Small static-frontend + Node/Express-API + MongoDB Atlas stack. No framework, no build, no test/lint/CI.

## Setup

- Prereqs: Node 18+ and network access to Atlas. Every runtime piece is Node/Express; PHP >= 8.1 + Composer 2.x are only needed to read the archived PHP tree in `archive/Backend/`.
- Install: `npm install`, then from `server/`: `npm install`. (No Composer step for normal use.)
- Secrets: `copy server\.env.example server\.env` (Windows) and fill `MONGODB_URI`, `MONGODB_DB`, `FRONTEND_URL`, `GOOGLE_CLIENT_ID`, `MAIL_USER`/`MAIL_PASS`/`MAIL_FROM`, `SESSION_SECRET`. Never commit `server/.env`; `node_modules/` and the archived `archive/Backend/.env` are also ignored. `MONGODB_DNS_SERVERS` is only needed when startup reports `querySrv ECONNREFUSED`.
- First admin has no endpoint — insert directly into `users` (`{ email, passwordHash (bcrypt), role: "admin", status: "active" }`). A super admin is created the same way with `role: "super_admin"`; that role can only turn API integrations on and off. Single-admin by design.

## Run

- `npm run dev` — backend `:8000` (Node/Express) + frontend `:5500` with live reload. Or `npm run dev:backend` / `npm run dev:frontend` alone.
- `npm run dev:backend:php` — starts the archived PHP tree from `archive/Backend/`; reference only, never the real backend.
- Backend: `cd server && npm run dev` (Node, `node --watch src/server.js`). Frontend: `live-server Frontend --host=localhost --port=5500`.
- Always open the frontend via `http://localhost:5500` (not `127.0.0.1`): session cookie is `Lax` on `localhost` and CORS allows exactly one `FRONTEND_URL` origin with credentials.
- Backend base URL lives only in `Frontend/js/config.js` (`API_BASE_URL`); change it there once if the port moves.

## Architecture

- Backend entry: `server/src/server.js` (loads `.env`, starts server, sets up graceful shutdown). Route table: `server/src/routes/index.js` — mounts route groups under `/api`. Only file mapping URL groups to code.
- Handlers: plain global functions in `server/src/controllers/index.js`. Controllers call services, services call models, models use native `mongodb` driver. Views serialize JSON. Errors: `api_abort(msg, code)` → `{ok:false, error}` with status. Shared: `server/src/config/env.js` (env validation, fail-fast), `server/src/config/db.js` (one `MongoClient` per process), `server/src/middleware/errorHandler.js` (error mapping), `server/src/middleware/notFound.js` (404 JSON), `server/src/middleware/auth.js` (requireLogin/requireAdmin/requireSuperAdmin).
- Frontend mirrors backend areas under `Frontend/src/function/<area>/` (paired 1:1), including `admin/` (credentials, staff, operations) and `super-admin/` (integration toggles only). Shared client: `Frontend/js/api.js` — all calls must use `credentials: "include"` or auth silently breaks; `staffHome(role)` is the single role landing map; `Frontend/js/dash.js` — `dashConfirm`/`dashPrompt`/`dashSelect`/`dashEditCashier` dialogs (no native popups) and the admin settings gear menu. Styles: `css/styles.css` (landing/auth), `css/dashboard.css` (staff shell), `css/settings.css` (admin settings/menu, integration cards).
- Entry pages: `/` (customer landing), `/login` (redirect shim in `login/index.html`), cashier registration at `/src/function/auth/register.html`.

## Auth / data rules (do not break)

- Account lifecycle: `pending → active → archived` (plus `decline → declined`, terminal). Only `active` logs in; `GET /api/me` re-reads Atlas every guarded page load.
- Cashier registration is invitation-only: admin invites by email (`/api/admin/invitations`), register requires matching `token + email`. Admin and super admin sign in via email+password or Google (the `googleAuth` setting's client ID is verified server-side). Cashier login is username+password only (no email codes).
- Role split for API integrations: `admin` owns credentials (`PUT /api/admin/settings/integrations/{key}`; sending `enabled` is rejected); `super_admin` owns on/off only (`GET/PUT /api/super-admin/settings/integrations...`; credentials are rejected and never returned). Server-enforced in `settings.service.js`, not just in the UI. `superAdminScope` (`server/src/middleware/auth.js`) also blocks `/api/admin/*`, `/api/cashier/*`, and the reservation list for this role, so endpoints that only check for a login stay closed.
- No OTP/email-code system: archive is one-step (confirm dialog → `POST /api/admin/cashiers/{id}/archive`). Login never issues codes.
- Role comes from the server session only — never trust request data. Every listing/state-changing endpoint re-checks `require_login`/`require_admin`/`require_super_admin`. Super admin is least-privilege: regular admin endpoints reject it, and the super-admin endpoints reject credentials. List endpoints project out password hashes; plain secrets never touch logs/responses, and private credential values are never returned (admin settings expose only `configured` + `masked`; super-admin responses omit credentials).
- Collections in `gamehub_2_0`: `users` (partial-unique `email`, sparse-unique `username`), `tables` (unique `name`), `rates`, `sessions`, `invitations`, `activityLogs`, `settings` (unique `key`), `healthcheck`, `authSessions` (Express session store). Approve/decline/archive/unarchive, sign-ins/sign-outs, credential updates (`integration_settings_update`) and toggles (`integration_toggle`) write `activityLogs`; admins read them at `GET /api/admin/activity-logs` (page: `Frontend/src/function/admin/activity.html`).
- Integration activation lives in `settings` (DB authoritative); credentials resolve per field as `*_OVERRIDE` env (written by Settings > API) → normal env key (`GOOGLE_CLIENT_ID`, `RECAPTCHA_*`, `GOOGLE_CALENDAR_*`, `PAYMONGO_*`, `GOOGLE_MAPS_API_KEY`, `GEMINI_API_KEY`) → settings document. Clearing an admin value falls back to the env default. Create the index/seed keys once with `npm run setup:settings`; never per request.

## Verify (no automated suite)

- Startup: `cd server && npm start` must print `node backend listening` and `API routes wired`. If it exits with `querySrv ECONNREFUSED`, Node's resolver cannot read Atlas SRV records — set `MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1` in `server/.env` (the OS resolver may still work fine; c-ares does not use it).
- Staff flow is manual: register (with invite token) → approve as admin → login → archive/unarchive; confirm in Atlas (`users`, `activityLogs`). Acceptance tables: `docs/Sprint_001-(E01).md`, `docs/Sprint02-report.md`.
- `node --watch` is single-threaded; 185–1200ms reads are normal (TLS/connection setup, not queries). Don't micro-optimize queries. Per-request index creation/rate seeding was already removed — keep seeding/index setup as one-time scripts, never per-request.

## Workflow

- Branches: `main` = stable/reviewed, `integration` = day-to-day; feature branches fork from `integration` and merge back for testing.
- Onboarding order: `README.md` → `architecture.md` → `docs/` sprint reports. If docs conflict with `routes/api.php` or scripts, trust the executable source.
- Migration branch: `migration/phase-0-contract` contains all Node/Express backend code (Phases 0-4 complete). Phase 5 (cutover) is in progress.