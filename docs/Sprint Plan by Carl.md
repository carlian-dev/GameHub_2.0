# Sprint Plan by Carl

Solo build. Same 10 requirements, one developer, in the order that unblocks itself.
Do each step fully (code + verify) before moving to the next.

The 10: AD-001 admin login, AD-002 admin logout, AD-003 approve cashier email
application, AD-004 view cashier accounts, AD-005 update cashier, AD-006 archive
cashier, CU-001 landing page, CA-001.1 register with personal email, CA-001 login
with personal email, CA-002 logout.

Rules we agreed: accounts go pending → active or archived, only active can log in.
Email only, password at least 8 characters, bcrypt hash. Sessions use PHP sessions.
Seed one admin in Compass first so you can log in on day one.

## Step 0 — Foundation (no feature works without this)

1. In Compass `gamehub_2_0.users`, insert your admin:
   email `admin@gamehub.local`, role `admin`, status `active`, passwordHash = bcrypt
   of whatever password you choose, createdAt = now.
2. Decide the user shape once and never change it mid-sprint:
   email (unique, lowercase), passwordHash, role (admin/cashier),
   status (pending/active/archived), createdAt.
3. Add `session_start()` in `Backend/public/index.php` and plan `GET /api/me`
   (returns who is logged in, or 401). Every protected page will ask this first.
4. Done when: you can see the admin doc in Compass.

## Step 1 — Cashier registers with email (CA-001.1)

1. Backend: `POST /api/cashiers/register` in a new `AuthController.php`.
   Accept email + password. Lowercase and trim the email. Reject bad email (422),
   short password under 8 chars (422), existing email (409 "already used").
   Hash with `password_hash()`, insert with role cashier and status pending.
2. Add a unique index on `users.email` so double-clicks can't create duplicates.
3. Frontend: `register.html` with email + password + confirm. On success show
   "awaiting admin approval". On 409 show "email already used".
4. Verify: register once → Compass shows 1 pending doc. Register same email
   again → 409. Short password → 422.
5. Done when: pending docs appear in Compass and the page message is correct.

## Step 2 — Login and logout for everyone (CA-001, CA-002, AD-001, AD-002)

1. Backend: `POST /api/login` takes email + password. Look up lowercased email.
   Wrong email or password → 401. Status pending → 403 "awaiting approval".
   Status archived → 403 "account archived". Else save user in `$_SESSION`
   and return role + email. `POST /api/logout` destroys the session.
   `GET /api/me` returns the session user or 401.
2. Frontend: `login.html` calls login. Admin goes to `admin/cashiers.html`,
   cashier goes to dashboard placeholder. Show the 401/403 message as-is so
   users know why. Every protected page calls `getMe()` first and bounces
   strangers back to login. Logout button calls logout then goes to login.
3. Verify with 4 logins: correct admin → 200 admin. Correct active cashier →
   200 cashier. Pending cashier → 403 approval. Archived → 403 archived.
   Wrong password → 401. After logout, `/api/me` → 401.
4. Done when: all 6 checks pass via both curl and the pages.

## Step 3 — Admin views cashier accounts (AD-004)

1. Backend: `GET /api/admin/cashiers` with optional `?status=`. Admin-only
   (guest → 401, cashier → 403). Never return passwordHash. Newest first.
2. Frontend: `admin/cashiers.html` guarded by `getMe()`. Filter buttons for
   pending / active / archived / all. Table shows email, status, created date.
3. Verify: register 2 test cashiers → filter pending shows 2 → curl and page agree.
4. Done when: list matches Compass exactly, minus password hashes.

## Step 4 — Admin approves email applications (AD-003)

1. Backend: `POST /api/admin/cashiers/{id}/approve`. Admin-only. Load the user:
   must be role cashier and status pending, else 422. Set status active.
   Write one `activityLogs` doc with who approved whom and when.
2. Frontend: Approve button on each pending row. After approve the row flips
   to active without reload.
3. Verify: approve one of your 2 test cashiers → Compass flips to active →
   that cashier can now log in, the other still gets 403.
4. Done when: approval sticks in Compass, activity log exists, login behavior changes.

## Step 5 — Admin updates cashier info (AD-005)

1. Backend: `PUT /api/admin/cashiers/{id}` accepting safe fields only
   (display name, schedule). Ignore role, email, and passwordHash here so
   nobody can escalate themselves by editing a request.
2. Frontend: Edit button (modal or inline) on each row, saving calls update
   and refreshes just that row.
3. Verify: change a schedule → Compass shows it → that cashier still logs in fine.
4. Done when: edits persist and login is unaffected.

## Step 6 — Admin archives a cashier (AD-006)

1. Backend: `POST /api/admin/cashiers/{id}/archive`. Admin-only. Sets archived
   (archiving twice is fine, stays archived). Log it in activityLogs.
2. Frontend: Archive button with a confirm dialog. Archived rows grey out and
   lose the Approve button. They appear under the archived filter.
3. Verify: archive your test cashier → next login → 403 archived → row sits
   under archived filter.
4. Done when: archived users are blocked but still visible for records.

## Step 7 — Landing page (CU-001)

1. Frontend only: update `index.html` with establishment name, services, hours,
   and links to register, login, and the status card you already have.
   No secrets, no new fetch calls.
2. Verify: open via Live Server, click every link, resize narrow (mobile),
   console has zero errors.
3. Done when: a stranger understands what GameHub is and where to click.

## Step 8 — Full run-through (yourself as QA)

In order, stop at the first failure:
1. `GET /api/health` → ok, db gamehub_2_0.
2. Register new email → 201 pending. Same email → 409. 7-char password → 422.
3. Login while pending → 403. Admin approves → login → 200. Update schedule →
   persists. Archive → login → 403. Logout → `/api/me` → 401.
4. Landing links + mobile + console clean.
5. Done when: all green. Then mark the 10 rows done in `01-requirements-matrix.md`.

## If stuck

* 401 = not logged in (call login first). 403 = logged in but not allowed
  (wrong role, pending, or archived — read the message).
* 409 = email already exists (use another). 422 = validation (check email
  format, password length, required fields).
* Compass is truth: if the doc didn't change there, the Backend didn't write.
