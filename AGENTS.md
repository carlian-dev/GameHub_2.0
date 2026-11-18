# AGENTS.md — GameHub_2.0

Small static-frontend + Node/Express-API + MongoDB Atlas stack. No framework, no build, no test/lint/CI.

## Setup

- Prereqs: Node 18+ and network access to Atlas. Every runtime piece is Node/Express; PHP >= 8.1 + Composer 2.x are only needed to read the archived PHP tree in `archive/Backend/`.
- Install: `npm install`, then from `server/`: `npm install`. (No Composer step for normal use.)
- Secrets: `copy server\.env.example server\.env` (Windows) and fill `MONGODB_URI`, `MONGODB_DB`, `FRONTEND_URL`, `GOOGLE_CLIENT_ID`, `MAIL_USER`/`MAIL_PASS`/`MAIL_FROM`, `SESSION_SECRET`. Never commit `server/.env`; `node_modules/` and the archived `archive/Backend/.env` are also ignored. `MONGODB_DNS_SERVERS` is only needed when startup reports `querySrv ECONNREFUSED`.
- First admin has no endpoint — insert directly into `users` (`{ email, passwordHash (bcrypt), role: "admin", status: "active" }`). A super admin is created the same way with `role: "super_admin"`; that role owns API integrations (on/off and credentials) plus an authenticator app used only for credential changes. Single-admin by design.

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
- Role split for API integrations: `super_admin` owns activation and credentials (`GET/PUT /api/super-admin/settings/integrations...`; `PUT` accepts `enabled` and/or `credentials`, and responses expose only masked hints); `admin` is read-only (`GET /api/admin/settings/integrations` returns `enabled`/`updatedAt`/`updatedBy`, no credentials; the admin `PUT` route was removed). Server-enforced in `settings.service.js`, not just in the UI. `superAdminScope` (`server/src/middleware/auth.js`) also blocks `/api/admin/*`, `/api/cashier/*`, and the reservation list for this role, so endpoints that only check for a login stay closed.
- Every credential added or replaced in Settings > API is validated **with its provider before it is stored** (`server/src/services/integrationValidation.service.js`, wired into `settings.update()`): Gemini `GET /v1beta/models`, PayMongo `GET /v1/payments`, Maps Geocoding, the Google OAuth authorize endpoint for a client ID, and a Calendar JWT exchange + one-event read for the service account. A rejected value returns 422 with the provider's reason and is never written (no settings document, no `.env`); an unreachable provider returns 502. Google gives no server-side way to judge reCAPTCHA keys (site key or secret), so those — plus the PayMongo webhook signing secret and an incomplete service-account triple — are saved with a `verification.notes` explanation. Clearing a value (`""`) is unchecked.
- No OTP/email-code system: archive is one-step (confirm dialog → `POST /api/admin/cashiers/{id}/archive`). Login never issues codes.
- Super-admin 2FA is authenticator-app TOTP only and does **not** gate sign-in: email+password and Google log straight in. It is step-up verification for credential changes — `PUT /api/super-admin/settings/integrations/{key}` with `credentials` requires a current 6-digit `code` in the same request (`twoFactorService.verifyStepUp`); toggling `enabled` alone does not. A super admin with no app paired can still log in and pair one from the Security panel (`GET/POST /api/super-admin/2fa...`); until then credential changes return 409 "pair an authenticator app before changing credentials". Replacing an already-paired app also requires its current 6-digit code, so a stolen password cannot swap in a new device. Secrets are AES-256-GCM encrypted with `SETTINGS_ENCRYPTION_KEY` (when blank, a dedicated key is derived from `SESSION_SECRET`). Lost phone: remove `twoFactor` and `twoFactorPending` from that user document in Atlas, then pair a new app from Settings > API.
- Role comes from the server session only — never trust request data. Every listing/state-changing endpoint re-checks `require_login`/`require_admin`/`require_super_admin`. Super admin is least-privilege: regular admin endpoints reject it. List endpoints project out password hashes; plain secrets never touch logs/responses, and private credential values are never returned (the super-admin settings cards expose only `configured` + `masked`; the admin listing has no credentials at all).
- Collections in `gamehub_2_0`: `users` (partial-unique `email`, sparse-unique `username`), `tables` (unique `name`), `rates`, `sessions`, `invitations`, `activityLogs`, `settings` (unique `key`), `healthcheck`, `authSessions` (Express session store). Approve/decline/archive/unarchive, sign-ins/sign-outs, credential updates (`integration_settings_update`) and toggles (`integration_toggle`) write `activityLogs`; admins read them at `GET /api/admin/activity-logs` (page: `Frontend/src/function/admin/activity.html`).
- Integration activation lives in `settings` (DB authoritative); credentials resolve per field as `*_OVERRIDE` env (written by Settings > API) → normal env key (`GOOGLE_CLIENT_ID`, `RECAPTCHA_*`, `GOOGLE_CALENDAR_*`, `PAYMONGO_*`, `GOOGLE_MAPS_API_KEY`, `GEMINI_API_KEY`) → settings document. Clearing an admin value falls back to the env default. Create the index/seed keys once with `npm run setup:settings`; never per request.

## Rate limiting

- `server/src/middleware/rateLimit.js` uses `express-rate-limit` (npm) with in-memory counters (one per process). Mounted in `app.js` (`api`, `writes` on `/api`) and per route group (`auth` on login/register/invite lookup and super-admin authenticator setup/enable/disable; `reservations` on guest reservation create/lookup/cancel).
- Signed-in traffic is keyed by user id for the write/auth limiters (the reservation limiter skips signed-in staff entirely); anonymous traffic by IP (`ipKeyGenerator`, IPv6 collapsed to /56). The global `api` limiter keys by IP because it runs before the body parser, so malformed bodies are throttled too. Successful auth requests do not count. Exceeding a limit returns HTTP 429 `{ok:false,error:"too many requests, please try again later"}` plus `Retry-After`.
- Env: `RATE_LIMIT_ENABLED` (0 = off), `RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_WINDOW_MS`/`AUTH_RATE_LIMIT_MAX`, `WRITE_RATE_LIMIT_MAX`, `RESERVATION_RATE_LIMIT_WINDOW_MS`/`RESERVATION_RATE_LIMIT_MAX`. Defaults are documented in `.env.example`; set `TRUST_PROXY` correctly or every client behind a proxy shares one IP bucket.
- Counters do not survive a restart and are per process. Add a shared store (e.g. Redis) before running more than one backend instance. `tests/contract/run.node.mjs` sets `RATE_LIMIT_ENABLED=0` so repeated runs stay deterministic; unit coverage is `tests/unit/rateLimit.test.mjs`.

## Verify (no automated suite)

- Startup: `cd server && npm start` must print `node backend listening` and `API routes wired`. If it exits with `querySrv ECONNREFUSED`, Node's resolver cannot read Atlas SRV records — set `MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1` in `server/.env` (the OS resolver may still work fine; c-ares does not use it).
- Staff flow is manual: register (with invite token) → approve as admin → login → archive/unarchive; confirm in Atlas (`users`, `activityLogs`). Acceptance tables: `docs/Sprint_001-(E01).md`, `docs/Sprint02-report.md`.
- `node --watch` is single-threaded; 185–1200ms reads are normal (TLS/connection setup, not queries). Don't micro-optimize queries. Per-request index creation/rate seeding was already removed — keep seeding/index setup as one-time scripts, never per-request.

## Workflow

- Branches: `main` = stable/reviewed, `integration` = day-to-day; feature branches fork from `integration` and merge back for testing.
- Onboarding order: `README.md` → `architecture.md` → `docs/` sprint reports. If docs conflict with `routes/api.php` or scripts, trust the executable source.
- Migration branch: `migration/phase-0-contract` contains all Node/Express backend code (Phases 0-4 complete). Phase 5 (cutover) is in progress.