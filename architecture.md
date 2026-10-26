# GameHub_2.0 — System Architecture

Onboarding document for the team. For setup and daily commands, see
`README.md`. For requirement-by-requirement progress, see `docs/`.

## 1. System overview

```
                         +------------------+
                         |  Google Identity |
                         |  Services (GIS)  |  ID token (login only)
                         +--------+---------+
                                     |
                                     v
   +----------+  HTTPS/JSON  +------------+  MongoDB driver  +--------------+
   | Browser  | <---------> | Node API   | <--------------> | Atlas        |
   | (static  |  session   | public/    |   gamehub_2_0    | cluster0     |
   |  HTML +  |  cookie    |  index.php |                  |              |
   |  JS, no  |            +------------+                  +--------------+
   |  build)  |
   +----------+  SMTP (invite mail only)
        |        +----------+     +------------------+
        +------> | Gmail    | <-> | nodemailer       |
                 | SMTP     |     | tokeninfo verify |
                 +----------+     +------------------+
```

* The Frontend is static files (no framework, no build step) served by any
  static server. It never contacts MongoDB or Google directly for data —
  every protected call goes to the Node API with the session cookie.
* The Backend is a single-entry Node/Express application (`server/src/server.js`):
  every request is routed from `server/src/routes/index.js` to route groups,
  then to controllers, services, and models.
* The database is MongoDB Atlas (`gamehub_2_0`), reached through one shared
  `MongoClient` per Node process (`server/src/config/db.js`).
* Two external services participate narrowly: Google verifies sign-in tokens,
  and Gmail delivers invitation mail. Neither stores application state.

## 2. Backend layers

```
Request
  |
  v
server/src/server.js ......... Loads .env, starts Express server, set up
                               graceful shutdown, wires models → services →
                               controllers → routes.
  |
  v
server/src/routes/index.js ... Mounts route groups under /api:
                                public, auth, admin, tables, session,
                                transaction, report.
  |
  v
server/src/controllers/*.js  HTTP in/out only: parse body, call service,
                             send through view. No DB queries.
  |
  v
server/src/services/*.js     Business rules, transactions, audit logs.
                             Accept actor, now, db, mailer explicitly.
  |
  v
server/src/models/*.js       Named Mongo queries + BSON conversions.
                             Return plain objects.
  |
  +-- server/src/config/db.js ...... One MongoClient per process,
  |                                   database from MONGODB_DB.
  +-- server/src/config/env.js ... Env validation, fail-fast,
  |                                 assertTestDb guard.
  +-- server/src/views/*.js ...... JSON serializers (MVC View).
  +-- server/src/middleware/*.js . Auth guards, error mapping, not-found,
                                   CORS, session.
```

Conventions: controllers return plain objects; views serialize to JSON.
Errors are thrown (`HttpError(status, message)`) and converted centrally by
`errorHandler.js`, so every failure has the shape `{ok:false, error:"..."}`
with a correct status. Migrations and seed work are one-time scripts, never
per-request queries.

### 2.1 Admin settings and integration endpoints

- `GET /api/config` is public and exposes feature state only:
  `{"ok":true,"integrations":{"googleAuth":{"enabled":true,"clientId":"..."},"googleMaps":{"enabled":false,"apiKey":""}}}`.
  Both settings documents are read in one query; disabled integrations expose
  empty credential strings, never stored values. A settings read failure fails
  closed for both integrations (HTTP 200 with both disabled). Environment
  defaults apply only when the relevant document is positively absent.
- `GET /api/admin/settings/integrations` requires an admin session and returns
  the integration cards with `available`, `enabled`, `updatedAt`, `updatedBy`,
  and credentials reduced to `{name,label,required,configured,masked}`. Google
  client-ID masks use the last four identifying characters before
  `.apps.googleusercontent.com`, not the constant suffix.
- `PUT /api/admin/settings/integrations/{key}` accepts
  `{enabled?: bool, credentials?: {name: string}}`. An empty string clears a
  credential; clearing a required credential auto-disables the integration.
  The handler writes only changed fields and commits the settings update plus
  its `integration_settings_update` audit log entry in one MongoDB
  transaction.
- The `settings` collection is authoritative (`unique key`). Environment
  `GOOGLE_CLIENT_ID` is only the default when no `googleAuth` document exists;
  `npm run setup:settings` creates the documents once (idempotent upsert).

## 3. Authentication and authorization model

Account lifecycle (single administrator by design):

```
  registration (cashier) / Google (admin)
        |
        v
     pending --approve--> active --archive--> archived
        |                     |
     decline              unarchive
        v                     |
     declined  (terminal) ----
```

* Only `active` accounts receive a session. `pending`, `archived`,
  `declined`, and anything else are rejected with distinct 403 messages.
* Cashiers register with first name, last name, a chosen unique username,
  and a password (bcrypt). Cashier accounts carry no email and no Google
  binding; their login is username + password with a direct session.
* The single administrator signs in with email + password or Google
  (verified server-side against the `googleAuth` setting, falling back to
  `GOOGLE_CLIENT_ID` only while no settings document exists; unknown emails
  404, non-admin emails 403). No endpoint creates administrators.
* Sessions are server-side `express-session` stored in MongoDB
  `authSessions` collection (not `sessions`, to avoid collision with
  billing sessions). Cookie `gh_session` is `httpOnly`, `sameSite=lax`,
  `path=/`, `secure` in production, rolling 12h TTL.
* `GET /api/me` re-reads the account from Atlas on every guarded page load,
  so an archive or role change takes effect immediately.

## 4. Data model (Atlas `gamehub_2_0`)

| Collection | Key fields | Indexes |
|---|---|---|
| `users` | email (admins/legacy) / username (cashiers), passwordHash (bcrypt), googleSub, role, status, names, schedule, authProvider | unique partial `email`, unique sparse `username` |
| `tables` | name (unique), status (available/occupied/reserved/maintenance), archived flag | unique `name` |
| `rates` | type (regular/special), pricePerHour, active | (tiny; type lookup) |
| `sessions` | tableId, tableName, customerName, cashierId, cashierName, startTime, endTime, plannedMinutes, status, pricePerHour, rateType, closedAt, createdAt, updatedAt | unique partial `tableId` where `status="active"` |
| `transactions` | ref (unique GH-YYYYMMDD-XXXX), sessionId (unique), tableId, tableName, customerName, cashierId, cashierName, minutes, billedHours, pricePerHour, rateType, total, method, received, change, paidAt, createdAt | unique `ref`, unique `sessionId`, compound `{paidAt, method}` |
| `activityLogs` | actorId, action, target, at, meta | `{at}` |
| `settings` | key (`googleAuth`, `googleMaps`, `recaptcha`, `otp`), enabled, credentials, updatedAt, updatedBy | unique `key` |
| `healthcheck` | heartbeat document | — |
| `authSessions` | session store (express-session) | TTL native |

Index strategy: uniqueness where identity demands it, and compound filters
matching the list endpoints (`{role,status}`, `{status,archived}`). At current
volumes every query is sub-millisecond; measured request time is dominated by
TLS/handshake to the cluster region, not by query shape.

## 5. Frontend structure

```
Frontend/
  index.html               Customer landing (hero, location, map)
  login/index.html         Redirect so bare /login resolves
  src/function/auth/       Login (single step + Google), cashier signup form
  src/function/admin/      Admin dashboard (live stat cards), applicants/staff table
  src/function/cashiers/   Cashier dashboard
  src/function/tables/     Tables, rates page, sessions view
  src/function/shared/     Landing status logic
  js/config.js             Single Backend base URL
  js/api.js                One fetch wrapper per endpoint (session cookie always sent)
  js/dash.js               Shell behavior, admin settings gear menu, shared dialogs
  css/styles.css           Landing + auth theme
  css/dashboard.css        Staff shell theme (tokens, sidebar, cards, tables, badges, dialogs)
  css/settings.css         Admin settings page, integration cards, gear menu (admin only)
```

* Pages are paired 1:1 with backend areas (`auth/`, `admin/`, `tables/`…),
  so any screen can be explained as "this page calls these endpoints".
* Guards run before render: each protected page calls `GET /api/me` and
  bounces by role. Login redirects by role to the matching dashboard.
* All confirmations and inputs use the shared dialog system
  (`dashConfirm`, `dashPrompt`, `dashSelect`, `dashEditCashier` time pickers);
  no native browser popups remain.
* The design language is fixed: cream serif display type, green primary,
  gold accents, near-black surfaces; no external fonts, icons, or images —
  the stack works fully offline (except Google Identity Services, which
  inherently requires Google).

## 6. Security rules (non-negotiable)

1. Secrets live only in `server/.env` (ignored by git). The Frontend must
   never see connection strings, mail passwords, or hashes.
2. Every state-changing and every listing endpoint re-checks the session
   server-side; role is taken from the session, never from request data.
3. Passwords are bcrypt-hashed and invite tokens are SHA-256-hashed; plain
   values never touch the database, logs, or responses. List endpoints
   project hashes out.
4. Destructive actions are gated twice: a role guard plus an explicit
   Yes/No dialog (archive/unarchive). All mutations write to
   `activityLogs` with actor and target.
5. CORS allows exactly one configured Frontend origin with credentials;
   Frontend and Backend share the `localhost` host so session cookies apply.
6. Validation is allow-list style per endpoint (roles, statuses, name and
   username shapes, positive prices); unknown fields are ignored, never stored.

## 7. Performance notes

* Measured September 2026 on development servers (`node --watch`, single-threaded):
  simple reads 185–1200ms end to end against tiny collections — connection
  setup dominates, not queries. Do not micro-optimize query shape at this scale.
* Concrete inefficiencies already removed: per-request index creation and rate
  seeding moved to one-time setup scripts; list endpoints project minimal
  fields; dashboard fetches independent counts in parallel.
* Watch items for growth: add the compound indexes in section 4 before
  collections pass thousands of documents; keep mail sending and token
  verification off the login critical path if they ever block UX; prefer
  production Node (persistent topology) and the nearest Atlas region.

## 8. Roadmap (from `docs/`)

* Session lifecycle (start/extend/end/timer) with per-minute billing.
* Reservations with overlap protection and guest lookup by reference.
* Food & beverage catalog and ordering (no inventory tracking).
* Cash/GCash payments with change calculation and digital receipts.
* Reports (daily/monthly/usage/hours), date filtering, CSV export.
* Cashier-role endpoints under `server/src/routes/` as the session and
  billing features land.