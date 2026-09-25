# 02 — Sprint Plan (10 requirements only)

Scope is frozen to the 10 bolded items in `01-requirements-matrix.md`.
Nothing else is built in this sprint.

## Team

* PJ (4): AD-001 admin login, AD-002 admin logout, AD-003 approve cashier email application, AD-004 view cashier accounts.
* JAZ (3): AD-005 update cashier info, AD-006 archive cashier, CU-001 landing page.
* JAM (3): CA-001.1 create account via personal email, CA-001 login via personal email, CA-002 logout.
* 4th dev: QA + merger. No feature code. Runs integration checklist, merges in order below.

## Agreed rules (confirmed)

1. Account lifecycle: `pending → active | archived`. Login allowed only when `status = active`.
2. Login identifier is personal email only (lowercased, unique). Password minimum 8 characters, stored as bcrypt hash (`password_hash()` / `password_verify()`). Never store or return plain passwords.
3. Sessions use PHP `$_SESSION` cookies. `session_start()` runs in `public/index.php`. `GET /api/me` returns current user for page guards.
4. JSON envelope everywhere via `json_response()`: success `{ok:true, ...}`, fail `{ok:false, error:"..."}`.

## Shared foundation (do FIRST, together, before any feature)

1. Seed one admin directly in Compass `gamehub_2_0.users` so PJ can log in on day one:
   `{email:"admin@gamehub.local", passwordHash:"<bcrypt of chosen password>", role:"admin", status:"active", createdAt: now}`.
2. `users` collection schema (all devs use exactly this):
   `{email: string unique lowercase, passwordHash: string, role: "admin"|"cashier", status: "pending"|"active"|"archived", createdAt: date}`.
   Create a unique index on `email` (JAM, Step 1).
3. `session_start()` + `GET /api/me` (JAM builds it with login; PJ and JAZ reuse it for guards).
4. New shared files: `src/Controllers/AuthController.php` (JAM owner), `src/Controllers/CashierController.php` (PJ starts list/approve, JAZ adds update/archive), new lines in `routes/api.php`, new fns in `Frontend/js/api.js`.

## New routes (all in this sprint)

* `POST /api/cashiers/register` — JAM (CA-001.1).
* `POST /api/login` — JAM (CA-001; PJ reuses for AD-001).
* `POST /api/logout` — JAM (CA-002; PJ reuses for AD-002).
* `GET /api/me` — JAM (guard helper for all pages).
* `GET /api/admin/cashiers` — PJ (AD-004).
* `POST /api/admin/cashiers/{id}/approve` — PJ (AD-003).
* `PUT /api/admin/cashiers/{id}` — JAZ (AD-005).
* `POST /api/admin/cashiers/{id}/archive` — JAZ (AD-006).
* `GET /` landing — JAZ (CU-001, static content update).

## Execution order (follow strictly, each step unblocks the next)

### Step 1 — JAM: CA-001.1 cashier self-registration + auth core

1. `POST /api/cashiers/register {email, password}`:
   Validate email format, lowercase + trim it, reject if missing/invalid (422). Check password present and length ≥ 8 (422 otherwise). Check `users` for existing same email → 409 "email already used". `password_hash($password, PASSWORD_BCRYPT)`. Insert `{email, passwordHash, role:"cashier", status:"pending", createdAt: now}`. Return 201 `{ok:true, status:"pending", message:"awaiting admin approval"}`.
2. Create unique index on `users.email` so duplicates are impossible even under double-click.
3. `POST /api/login {email, password}`: find by lowercased email → 401 "invalid credentials" if missing/wrong password (`password_verify`). If `status = pending` → 403 "awaiting admin approval". If `archived` → 403 "account archived". Else `session_start`, store `userId + role + email` in `$_SESSION`, return `{ok:true, role, email}`.
4. `POST /api/logout`: clear + destroy session, return `{ok:true}`.
5. `GET /api/me`: 401 if no session, else `{ok:true, email, role, status}`.
6. Frontend: `register.html` (email + password ≥8 + confirm match client-side, calls `register()`, success shows "awaiting admin approval", 409 shows "email already used"), `login.html` (calls `login()`, redirects admin → `admin/cashiers.html`, cashier → dashboard placeholder; shows 401/403 messages verbatim), logout button calls `logout()`. Add to `js/api.js`: `register(), login(), logout(), getMe()`.
7. Verify: Compass `db.users.countDocuments({status:"pending"})` grows by 1 per register; `curl POST /api/cashiers/register` → 201 then duplicate → 409; `curl POST /api/login` with pending user → 403.

### Step 2 — PJ: AD-004 view + AD-003 approve (needs Step 1 data)

1. `GET /api/admin/cashiers[?status=pending|active|archived|all]`: admin session guard (401 if guest, 403 if cashier). Returns list without `passwordHash` (project it out). Sorted newest first.
2. `POST /api/admin/cashiers/{id}/approve`: admin guard. Load user, must be `role:cashier` and `status:pending` else 422 ("only pending cashier applications can be approved"). Set `status:"active"`. Write `activityLogs {actorId, action:"approve_cashier", target:userId, at: now}`.
3. Frontend `admin/cashiers.html` (PJ): guard via `getMe()` (non-admin bounced to `login.html`), filter buttons (pending/all), table `email | status | created | action`, Approve button per pending row → `approveCashier()` → row flips to active without reload. Add `listCashiers(), approveCashier()` to `js/api.js`.
4. Verify: register 2 test cashiers (JAM page) → PJ filter `pending` shows 2 → approve 1 → Compass `db.users.findOne({_id})` shows `active` → approved user can now log in (Step 3), still-pending cannot.

### Step 3 — PJ + JAM: AD-001/AD-002 + CA-001/CA-002 login/logout wiring (needs Steps 1–2)

1. No new routes: both roles share JAM's `POST /api/login`, `POST /api/logout`, `GET /api/me` from Step 1.
2. PJ work: `admin/cashiers.html` already guarded; add nav logout button → `logout()` → redirect `login.html`. Confirm seeded admin login returns `role:admin`.
3. JAM work: `login.html` role redirect + messages (401 invalid, 403 pending, 403 archived). Test matrix, all via page + curl:
   active admin → 200 role admin; active cashier → 200 role cashier; pending → 403 approval message; archived → 403 archived message; wrong password → 401.
4. Verify: logout then `GET /api/me` → 401 on both roles.

### Step 4 — JAZ: AD-005 update + AD-006 archive (needs Steps 1–2)

1. `PUT /api/admin/cashiers/{id} {displayName?, schedule?}`: admin guard. Allow only safe fields (name/schedule/contact if you add them; never `role` or `email` without re-verification, never `passwordHash` directly). Unknown fields ignored. Returns updated user without hash.
2. `POST /api/admin/cashiers/{id}/archive`: admin guard. Sets `status:"archived"` (idempotent — archiving twice still OK). Log to `activityLogs`. Archived user keeps history but `POST /api/login` → 403 from Step 1.
3. Frontend: extend `admin/cashiers.html` with Edit (modal or inline row, calls `updateCashier()`) and Archive (confirm dialog, calls `archiveCashier()`). Show archived rows greyed with no Approve button.
4. Verify: update schedule → Compass doc changed, login still works; archive → Compass `status:archived` → that cashier's next login → 403; list filter `archived` shows them.

### Step 5 — JAZ: CU-001 landing page (independent, can run parallel from Step 1)

1. Update `Frontend/index.html`: establishment name, services, hours placeholder, buttons linking `register.html` (cashier applicants), `login.html`, and existing Backend-status card stays untouched.
2. No secrets, no fetch except existing health check. Must render readable on mobile (existing `styles.css` container already centers).
3. Verify: open via Live Server, all links work, no console errors.

### Step 6 — 4th dev: integration (needs Steps 1–5, merges in Step order)

Run end-to-end on fresh test email, in order, stopping on first failure:
1. `GET /api/health` → `{ok:true, db:"gamehub_2_0"}` (baseline unbroken).
2. Register `qa+N@gamehub.local` → 201 pending; duplicate → 409; short password (7 chars) → 422.
3. Login as pending → 403 approval message.
4. Admin login → list shows pending; approve → Compass `active`; `activityLogs` has approve entry.
5. Cashier login → 200; `GET /api/me` → cashier.
6. Admin updates schedule → reflected; archives user → login → 403 archived.
7. Logout both roles → `/api/me` → 401.
8. Landing links + responsive check.

## File ownership (no overlap)

* JAM creates: `src/Controllers/AuthController.php`, `register.html`, `login.html` logic, `api.js: register/login/logout/getMe`.
* PJ creates: `admin/cashiers.html` (list + approve), `CashierController.php: list + approve`, `api.js: listCashiers/approveCashier`.
* JAZ creates/extends: `CashierController.php: update + archive`, `admin/cashiers.html` edit/archive UI, `index.html` landing, `api.js: updateCashier/archiveCashier`.
* 4th dev: no feature files, owns this checklist + merge order Step 1→5.

## Done criteria (per requirement)

* AD-001/CA-001: matrix logins pass incl. pending/archived rejections.
* AD-002/CA-002: logout → `/api/me` 401 both roles.
* CA-001.1: duplicate → 409, short pass → 422, Compass pending doc correct.
* AD-003: only pending→active, logged, approved can log in.
* AD-004: list correct per filter, no passwordHash leaked.
* AD-005: edits persist, safe fields only.
* AD-006: archived blocked at login, still listed under archived filter.
* CU-001: landing links work, mobile readable, console clean.
