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
  | Browser  | <---------> | PHP API    | <--------------> | Atlas        |
  | (static  |  session   | public/    |   gamehub_2_0    | cluster0     |
  |  HTML +  |  cookie    |  index.php |                  |              |
  |  JS, no  |            +------------+                  +--------------+
  |  build)  |
  +----------+  SMTP (one-time codes only)
       |        +----------+     +------------------+
       +------> | Gmail    | <-> | google/apiclient |
                | SMTP     |     | tokeninfo verify |
                +----------+     +------------------+
```

* The Frontend is static files (no framework, no build step) served by any
  static server. It never contacts MongoDB or Google directly for data —
  every protected call goes to the PHP API with the session cookie.
* The Backend is a single-entry PHP application (`public/index.php`):
  every request is routed from a central table to a plain-function handler.
* The database is MongoDB Atlas (`gamehub_2_0`), reached through one shared
  client singleton per PHP process.
* Two external services participate narrowly: Google verifies sign-in tokens,
  and Gmail delivers one-time codes. Neither stores application state.

## 2. Backend layers

```
Request
  |
  v
public/index.php ......... Loads .env + vendor, starts the session, sets
                           CORS/credentials headers, normalizes METHOD + PATH.
  |
  v
routes/api.php ........... Ordered table: [METHOD, PATH, handler],
                           supports {id} placeholders. Only file that maps
                           URLs to code.
  |
  v
src/function/<area>/*.php  Feature handlers (plain global functions):
                           auth/    login, registration, Google, one-time codes
                           admin/   applicant and cashier administration
                           tables/  tables, rates, session reads
                           shared/  health check
                           cashiers/ reserved for cashier-role endpoints
  |
  +-- src/Config/DatabaseConnection.php .. One MongoDB\Client per process,
  |                                        database from MONGODB_DB, ping().
  +-- src/Helpers/response.php ........... json_response(), api_abort()
                                           (typed HTTP errors 400-503).
  +-- src/Helpers/request.php ............ json_body() for JSON fetch bodies.
  +-- src/Helpers/auth.php ............... current_user(), require_login(),
                                           require_admin(), is_admin().
```

Conventions: handlers return plain arrays; `index.php` serializes them.
Errors are thrown (`api_abort(message, code)`) and converted centrally, so
every failure has the shape `{ok:false, error:"..."}` with a correct status.
Migrations and seed work are one-time scripts, never per-request queries.

### 2.1 Admin settings and integration endpoints

- `GET /api/config` is public and exposes feature state only:
  `{"ok":true,"integrations":{"googleAuth":{"enabled":true,"clientId":"..."},"googleMaps":{"enabled":false,"apiKey":""}}}`.
  Both settings documents are read in one query; disabled integrations expose
  empty credential strings, never stored values. A settings read failure fails
  closed for both integrations. Environment defaults apply only when the
  relevant document is positively absent.
- `GET /api/admin/settings/integrations` requires an admin session and returns
  the integration cards with `available`, `enabled`, `updatedAt`, `updatedBy`,
  and credentials reduced to `{name,label,required,configured,masked}`. Google
  client-ID masks use the last four identifying characters before
  `.apps.googleusercontent.com`, not the constant suffix.
- `PUT /api/admin/settings/integrations/{key}` accepts
  `{enabled?: bool, credentials?: {name: string}}`. An empty string clears a
  credential; clearing a required credential auto-disables the integration.
  The handler writes only changed fields and commits the settings update plus
  its `activityLogs` entry (no credential values) in one MongoDB transaction.
- The `settings` collection is authoritative (`unique key`). Environment
  `GOOGLE_CLIENT_ID` is only the default when no `googleAuth` document exists;
  `php Backend/scripts/setup_settings.php` creates the index and seeds keys once.

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
     declined  (terminal) ----+
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
* One-time email codes exist in exactly two places: completing an admin
  application (email ownership) and confirming a cashier archive. Day-to-day
  login never issues codes.
* Sessions are server-side PHP sessions referenced by cookie; `GET /api/me`
  re-reads the account from Atlas on every guarded page load, so an archive
  or role change takes effect immediately.

## 4. Data model (Atlas `gamehub_2_0`)

| Collection | Key fields | Indexes |
|---|---|---|
| `users` | email (admins/legacy) / username (cashiers), passwordHash (bcrypt), googleSub, role, status, names, schedule, authProvider | unique partial `email`, unique sparse `username` |
| `tables` | name (unique), status (available/occupied/reserved/maintenance), archived flag | unique `name` |
| `rates` | type (regular/special), pricePerHour, active | (tiny; type lookup) |
| `sessions` | tableId, customerName, startTime, status | `{status, startTime}` (reserved for lifecycle sprint) |
| `activityLogs` | actorId, action, target, timestamp | `{timestamp}` (actor filters as needed) |
| `settings` | key (`googleAuth`, `googleMaps`, `recaptcha`, `otp`), enabled, credentials, updatedAt, updatedBy | unique `key` |
| `healthcheck` | heartbeat document | — |

Index strategy: uniqueness where identity demands it, and compound filters
matching the list endpoints
(`{role,status}`, `{status,archived}`). At current volumes every query is
sub-millisecond; measured request time is dominated by TLS/handshake to the
cluster region, not by query shape (see section 7).

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

1. Secrets live only in `Backend/.env` (ignored by git). The Frontend must
   never see connection strings, mail passwords, or hashes.
2. Every state-changing and every listing endpoint re-checks the session
   server-side; role is taken from the session, never from request data.
3. Passwords are bcrypt-hashed and invite tokens are SHA-256-hashed; plain
   values never touch the database, logs, or responses. List endpoints
   project hashes out.
4. Destructive actions are gated twice: a role guard plus either an explicit
   Yes/No dialog (approve/decline/unarchive) or an emailed re-verification
   code (archive). All four write to `activityLogs` with actor and target.
5. CORS allows exactly one configured Frontend origin with credentials;
   Frontend and Backend share the `localhost` host so session cookies apply.
6. Validation is allow-list style per endpoint (roles, statuses, name and
   username shapes, positive prices); unknown fields are ignored, never stored.

## 7. Performance notes

* Measured September 2026 on development servers (`php -S`, single-threaded):
  simple reads 185–1200ms end to end against tiny collections — connection
  setup dominates, not queries. Do not micro-optiize query shape at this scale.
* Concrete inefficiencies already removed or scheduled: per-request index
  creation and rate seeding moved to one-time setup; list endpoints project
  minimal fields; dashboard fetches independent counts in parallel.
* Watch items for growth: add the compound indexes in section 4 before
  collections pass thousands of documents; keep mail sending and token
  verification off the login critical path if they ever block UX; prefer
  production PHP (OPcache, persistent topology) and the nearest Atlas region.

## 8. Roadmap (from `docs/`)

* Session lifecycle (start/extend/end/timer) with per-minute billing.
* Reservations with overlap protection and guest lookup by reference.
* Food & beverage catalog and ordering (no inventory tracking).
* Cash/GCash payments with change calculation and digital receipts.
* Reports (daily/monthly/usage/hours), date filtering, CSV export.
* Cashier-role endpoints under `Backend/src/function/cashiers/` as the
  session and billing features land.
