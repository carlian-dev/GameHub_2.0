# Admin Settings & API Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin theme/logout buttons with an admin settings menu, add a settings page with profile and API integration controls, and enforce Google Auth/Maps toggles from MongoDB-backed settings.

**Architecture:** A new `settings` collection and `admin/settings.php` handler own the integration registry, masked credentials, defaults, and audit logging. `GET /api/config` exposes only public integration state. Admin pages use a shared settings menu built in `dash.js`; a new `admin/settings.html` page uses the existing dashboard shell. Google Auth is enforced in both `login.js` and `google_login()`; Maps is enforced by rendering the landing-page iframe only when enabled.

**Tech Stack:** PHP 8.1+ with `mongodb` extension, MongoDB Atlas, static HTML/CSS/JS, existing `api.js` fetch wrapper, no build step, no new dependencies.

**Spec:** `docs/TechnicalRequirements-01.md`

## Global Constraints

- All admin settings endpoints must call `require_admin()`; never trust a role from request data.
- All frontend API calls go through `Frontend/js/api.js`, which must keep `credentials: "include"`.
- Never return, log, or audit a full credential value. Admin list responses expose only `configured`, `masked`, and safe display hints.
- Database settings are the source of truth once a document exists. Environment values are used only when no document exists; a read failure never falls back to the environment.
- Settings-store read failures fail closed: `POST /api/auth/google` returns `503`, `/api/config` disables both integrations, and `PUT` never falls back to environment values.
- Use one-time scripts for indexes/seeding; never create indexes or seed settings per request.
- Use `dashConfirm`, `dashAlert`, `dashToast`, and the existing dialog system; do not add native `alert`, `confirm`, or `prompt`.
- Preserve the existing uncommitted changes in `Frontend/css/dashboard.css`. Do not stage that file. Put new styles in `Frontend/css/settings.css`.
- Do not change cashier pages. `dash.js` must keep the existing `.dash-theme` behavior for cashier pages.
- Theme storage remains `localStorage["gh-theme"]`.
- Admin page paths are relative: admin pages use `./settings.html`, tables pages use `../admin/settings.html`, and all use `../auth/login.html` for logout.
- Commit only the files named in each task. Do not commit `Frontend/css/dashboard.css`.

## Review Focus

These are the cases most likely to break a real admin:

1. Disabling Google Auth while the login page is already open: the next reload must hide the Google button, make no GIS request, and the backend must reject a direct `POST /api/auth/google`.
2. Missing `settings` documents vs. a settings read failure: an unseeded database must still allow the legacy env-based Google setup, while a read failure must hide Maps and fail Google auth closed.
3. Replacing or clearing a credential: the mask must change without exposing the value, and clearing a required credential must not leave the integration enabled.
4. The settings dropdown: it must not be clipped by the dashboard header and must work with keyboard and mobile.
5. Changing the Google client ID: the value returned by `/api/config` and the value used for the token `aud` check must be the same.

---

## Task 1: Backend settings registry, public config, and admin list

**Files:**
- Create: `Backend/src/function/admin/settings.php`
- Modify: `Backend/routes/api.php`
- Modify: `Backend/src/function/auth/google.php` (remove `app_config()`; leave `google_login()` for Task 3)

**Interfaces:**
- `settings_collection(): \MongoDB\Collection`
- `settings_registry(): array`
- `settings_default(string $key): array`
- `settings_document(string $key): ?array`
- `settings_effective(string $key): array`
- `settings_credential_hint(string $key, string $name, string $value): string`
- `settings_mask_value(string $value, string $hint = ''): string`
- `settings_shape(string $key, array $doc): array`
- `settings_public_config(): array`
- `settings_google_auth(): array`
- `app_config(array $params = []): array`
- `settings_list(array $params = []): array`

`settings_registry()` returns:

```php
[
    'googleAuth' => [
        'name' => 'Google Authentication',
        'description' => 'Admin Google sign-in',
        'available' => true,
        'credentials' => [
            'clientId' => [
                'label' => 'OAuth Client ID',
                'required' => true,
                'secret' => false,
            ],
        ],
    ],
    'googleMaps' => [
        'name' => 'Google Maps',
        'description' => 'Location map on the public landing page',
        'available' => true,
        'credentials' => [
            'apiKey' => [
                'label' => 'Maps API key (optional)',
                'required' => false,
                'secret' => false,
            ],
        ],
    ],
    'recaptcha' => [
        'name' => 'reCAPTCHA',
        'description' => 'Bot protection (planned)',
        'available' => false,
        'credentials' => [
            'siteKey' => ['label' => 'Site key', 'required' => false, 'secret' => false],
            'secretKey' => ['label' => 'Secret key', 'required' => false, 'secret' => true],
        ],
    ],
    'otp' => [
        'name' => 'OTP / email codes',
        'description' => 'Email verification codes (planned)',
        'available' => false,
        'credentials' => [],
    ],
]
```

`settings_effective()` returns:

```php
[
    'key' => 'googleAuth',
    'enabled' => true,
    'credentials' => [
        'clientId' => [
            'value' => '...',
            'last4' => 'ab12',
            'updatedAt' => MongoDB\BSON\UTCDateTime|null,
        ],
    ],
    'updatedAt' => MongoDB\BSON\UTCDateTime|null,
    'updatedBy' => string|null,
]
```

Rules for `settings_effective()`:

- If a settings document exists, use it exclusively.
- If no document exists, use `settings_default($key)`.
- Normalize BSON documents to PHP arrays.
- Derive the display hint from the value on every read. For Google client IDs it is the last four identifying characters before `.apps.googleusercontent.com`, never the constant suffix.
- If a required credential is empty, force `enabled` to `false`.
- Do not read a credential from the environment when a document exists.

`settings_public_config()` returns:

```php
[
    'googleAuth' => ['enabled' => bool, 'clientId' => string],
    'googleMaps' => ['enabled' => bool, 'apiKey' => string],
]
```

`app_config()` adds `ok`, wraps the integrations, adds a temporary top-level `googleClientId` for compatibility with the current `login.js`, and calls `header('Cache-Control: no-store')`. It resolves both integration documents in one settings read. On a settings read exception, log a generic message and fail closed for both:

- Google Auth: disabled, empty client ID.
- Google Maps: disabled, empty key.

Environment defaults are used only when the relevant document is positively absent.

`settings_shape()` returns:

```php
[
    'key' => 'googleAuth',
    'name' => 'Google Authentication',
    'description' => 'Admin Google sign-in',
    'available' => true,
    'enabled' => true,
    'credentials' => [
        [
            'name' => 'clientId',
            'label' => 'OAuth Client ID',
            'required' => true,
            'configured' => true,
            'masked' => '••••••••ab12',
        ],
    ],
    'updatedAt' => '2026-10-20T10:00:00+08:00' or null,
    'updatedBy' => 'admin@example.com' or null,
]
```

Masking rule: eight bullets plus a four-character hint when `strlen($value) > 8`; bullets only otherwise; empty value returns `''`. The hint is the last four characters for ordinary credentials. For a Google client ID it is the last four characters before the fixed `.apps.googleusercontent.com` suffix, so `1234-ab12.apps.googleusercontent.com` becomes `••••••••ab12`.

- [ ] **Step 1: Confirm the route is missing**

Run:

```powershell
curl.exe -s -o NUL -w "%{http_code}" http://localhost:8000/api/admin/settings/integrations
```

Expected: `404`.

- [ ] **Step 2: Create `Backend/src/function/admin/settings.php`**

Implement the registry, defaults, document lookup, effective settings, masking, shape, public config, `app_config`, and `settings_list`. `settings_list` must call `require_admin()` and return `['ok' => true, 'integrations' => [...]]` from `settings_registry()`.

- [ ] **Step 3: Wire the routes and move `app_config()`**

In `Backend/routes/api.php`:

- Add `require_once __DIR__ . '/../src/function/admin/settings.php';`
- Add `['GET', '/api/admin/settings/integrations', 'settings_list'],`

Remove `app_config()` from `Backend/src/function/auth/google.php`; the route already points at `app_config` and now loads it from `settings.php`.

- [ ] **Step 4: Run PHP syntax checks**

Run:

```powershell
php -l Backend\src\function\admin\settings.php
php -l Backend\src\function\auth\google.php
php -l Backend\routes\api.php
```

Expected: all `No syntax errors detected`.

- [ ] **Step 5: Verify public config and admin access**

Start the backend if needed, then run:

```powershell
curl.exe -s http://localhost:8000/api/config
curl.exe -s -o NUL -w "%{http_code}" http://localhost:8000/api/admin/settings/integrations
```

Expected: the config contains `integrations.googleAuth`, `integrations.googleMaps`, and a temporary `googleClientId`; the admin route without a session returns `401`.

Log in as admin into a cookie jar and list:

```powershell
curl.exe -s -c $env:TEMP\gh-admin-cookies.txt -X POST http://localhost:8000/api/login `
  -H "Content-Type: application/json" `
  -d '{"email":"<admin-email>","password":"<admin-password>"}'
curl.exe -s -b $env:TEMP\gh-admin-cookies.txt http://localhost:8000/api/admin/settings/integrations
```

Expected: `200` with four integrations; Google Auth has a masked/empty client ID, Google Maps is enabled with an empty key, reCAPTCHA/OTP are `available:false`, and no full credential appears.

- [ ] **Step 6: Commit**

```powershell
git add Backend/src/function/admin/settings.php Backend/routes/api.php Backend/src/function/auth/google.php
git commit -m "feat: add admin settings registry and public integration config"
```

---

## Task 2: Integration update endpoint, setup script, and audit logging

**Files:**
- Modify: `Backend/src/function/admin/settings.php`
- Modify: `Backend/routes/api.php`
- Create: `Backend/scripts/setup_settings.php`

**Interfaces:**
- `settings_update(array $params = []): array` — returns `['ok' => true, 'integration' => settings_shape(...)]`.
- `settings_validate_credential(string $key, string $name, string $value): void` — throws `api_abort(..., 422)` on failure.
- `settings_plan_update(string $key, array $effective, array $data): array` — validates and builds the field-level update plan.
- `settings_log(string $action, string $target, array $meta, ?MongoDB\Driver\Session $session = null): void` — writes `activityLogs` with `actorId`, `action`, `target`, `meta`, `at`; joins the caller's transaction when given a session.

Update rules:

- Unknown key → `404`.
- Planned key (`available:false`) → `422`.
- Unknown credential name → `422`.
- `enabled` must be a JSON boolean if present.
- Credential values are trimmed, max 2048 characters.
- Google `clientId` must match `^[A-Za-z0-9_-]{5,}\.apps\.googleusercontent\.com$`; a bare domain suffix is rejected.
- Maps key, when non-empty, must contain no whitespace.
- Omitted credentials stay unchanged.
- An explicit `""` clears the credential.
- Enabling without a required credential → `422`.
- Clearing a required credential while the integration is enabled auto-disables it and reports the new state.
- Only changed fields are written (`$set`/`$unset`), with omitted fields preserved on insert via `$setOnInsert`.
- The settings write and its audit entry commit in one MongoDB transaction. A success response means both were stored.
- Audit `meta` contains only `{enabled, changed}`; `changed` is a list such as `["enabled","credentials.clientId"]`.

`Backend/scripts/setup_settings.php` must:

- Load `vendor/autoload.php` and `.env`.
- Require `Backend/src/function/admin/settings.php`.
- Create a unique index `{key:1}` named `uniq_setting_key`.
- Upsert one document per registry key using `$setOnInsert`:
  - `googleAuth`: `settings_default('googleAuth')`.
  - `googleMaps`: enabled with an empty key.
  - `recaptcha`, `otp`: disabled.
- Print the index name and each seeded key.
- Be safe to run repeatedly.

- [ ] **Step 1: Confirm update is unavailable**

Run:

```powershell
curl.exe -s -o NUL -w "%{http_code}" -X PUT `
  http://localhost:8000/api/admin/settings/integrations/googleAuth `
  -H "Content-Type: application/json" -d '{"enabled":false}'
```

Expected: `404` or `405` before the route is added.

- [ ] **Step 2: Implement `settings_update()` and validation**

Add the handler to `settings.php` and register `['PUT', '/api/admin/settings/integrations/{key}', 'settings_update']` in `Backend/routes/api.php`. `admin/settings.php` is already required by Task 1.

- [ ] **Step 3: Create the one-time setup script**

Run:

```powershell
php Backend\scripts\setup_settings.php
```

Expected: one unique index and four seeded keys, without creating duplicates on a second run.

- [ ] **Step 4: Verify toggles, validation, and audit logs**

With the admin cookie jar from Task 1:

```powershell
# Disable Google Auth
curl.exe -s -b $env:TEMP\gh-admin-cookies.txt -X PUT `
  http://localhost:8000/api/admin/settings/integrations/googleAuth `
  -H "Content-Type: application/json" -d '{"enabled":false}'

# Clear the required client ID; the response must show enabled:false
curl.exe -s -b $env:TEMP\gh-admin-cookies.txt -X PUT `
  http://localhost:8000/api/admin/settings/integrations/googleAuth `
  -H "Content-Type: application/json" -d '{"credentials":{"clientId":""}}'

# Invalid client ID must be 422
curl.exe -s -o NUL -w "%{http_code}" -b $env:TEMP\gh-admin-cookies.txt -X PUT `
  http://localhost:8000/api/admin/settings/integrations/googleAuth `
  -H "Content-Type: application/json" -d '{"credentials":{"clientId":"not-a-client-id"}}'

# Planned integration must be 422
curl.exe -s -o NUL -w "%{http_code}" -b $env:TEMP\gh-admin-cookies.txt -X PUT `
  http://localhost:8000/api/admin/settings/integrations/recaptcha `
  -H "Content-Type: application/json" -d '{"enabled":true}'
```

Expected: `200` for the first two, `422` for the last two. The cleared client ID response contains no full value.

Inspect the newest audit entry:

```powershell
php -r 'require "Backend/vendor/autoload.php"; $d=Dotenv\Dotenv::createImmutable("Backend"); $d->safeLoad(); $db=App\Config\DatabaseConnection::db(); $row=$db->selectCollection("activityLogs")->findOne(["action"=>"integration_settings_update"],["sort"=>["at"=>-1]]); echo json_encode($row, JSON_PRETTY_PRINT);'
```

Expected: `action`, `target`, and `meta.changed`; no credential value.

Restore Google Auth with a real client ID before leaving this task:

```powershell
curl.exe -s -b $env:TEMP\gh-admin-cookies.txt -X PUT `
  http://localhost:8000/api/admin/settings/integrations/googleAuth `
  -H "Content-Type: application/json" `
  -d '{"enabled":true,"credentials":{"clientId":"<real-client-id>.apps.googleusercontent.com"}}'
```

- [ ] **Step 5: Commit**

```powershell
git add Backend/src/function/admin/settings.php Backend/routes/api.php Backend/scripts/setup_settings.php
git commit -m "feat: add integration update endpoint and settings setup script"
```

---

## Task 3: Enforce Google Authentication on the backend

**Files:**
- Modify: `Backend/src/function/auth/google.php`

**Interfaces:**
- `google_verify_token(string $idToken, string $clientId): array` — uses `$clientId` for the `aud` check.
- `google_login(array $params = []): array` — reads `settings_google_auth()` before token verification.

- [ ] **Step 1: Confirm the current behavior does not enforce the setting**

Disable Google Auth through the admin API, then call the endpoint with a dummy token:

```powershell
curl.exe -s -b $env:TEMP\gh-admin-cookies.txt -X PUT `
  http://localhost:8000/api/admin/settings/integrations/googleAuth `
  -H "Content-Type: application/json" -d '{"enabled":false}'

curl.exe -s -o NUL -w "%{http_code}" -X POST http://localhost:8000/api/auth/google `
  -H "Content-Type: application/json" -d '{"idToken":"dummy"}'
```

Expected before the fix: a token-related error such as `401`/`502`, not the disabled message.

- [ ] **Step 2: Refactor `google_verify_token()` and `google_login()`**

- Remove the environment read from `google_verify_token()`.
- Abort `503` when `$clientId` is empty.
- Compare `$info['aud']` to `$clientId`.
- In `google_login()`, call `settings_google_auth()` inside `try/catch`; on any settings exception abort `503`.
- If disabled, abort `403` with `Google sign-in is disabled by the administrator`.
- If enabled but `clientId` is empty, abort `503`.
- Pass the configured client ID into `google_verify_token()`.

- [ ] **Step 3: Run syntax checks**

```powershell
php -l Backend\src\function\auth\google.php
```

Expected: no syntax errors.

- [ ] **Step 4: Verify disabled behavior and client ID source**

With Google Auth still disabled:

```powershell
curl.exe -s -o NUL -w "%{http_code}" -X POST http://localhost:8000/api/auth/google `
  -H "Content-Type: application/json" -d '{"idToken":"dummy"}'
```

Expected: `403`, body containing `Google sign-in is disabled by the administrator`.

Re-enable with the real client ID, then compare:

```powershell
curl.exe -s http://localhost:8000/api/config
php -r 'require "Backend/vendor/autoload.php"; $d=Dotenv\Dotenv::createImmutable("Backend"); $d->safeLoad(); require "Backend/src/function/admin/settings.php"; $g=settings_google_auth(); echo $g["clientId"], PHP_EOL;'
```

Expected: the `integrations.googleAuth.clientId` value and the CLI value are identical, and both match the client ID currently stored in `settings`.

If a valid Google client is available, complete one real Google sign-in from the login page. Expected: successful admin login after the client ID change.

- [ ] **Step 5: Commit**

```powershell
git add Backend/src/function/auth/google.php
git commit -m "feat: enforce google auth setting on backend"
```

---

## Task 4: Apply integration toggles to login and the landing map

**Files:**
- Modify: `Frontend/src/function/auth/login.html`
- Modify: `Frontend/src/function/auth/login.js`
- Modify: `Frontend/index.html`
- Modify: `Backend/src/function/admin/settings.php` (remove temporary compatibility field)
- Create: `Frontend/js/location-map.js`

**Interfaces:**
- `getAppConfig()` returns the new `integrations` object.
- `loadGoogleScript(): Promise<void>` — injects `https://accounts.google.com/gsi/client` once, only after config confirms Google Auth is enabled.

- [ ] **Step 1: Confirm the current page always loads Google**

With Google Auth disabled through the admin API, open the login page and check DevTools → Network. Expected before the fix: `accounts.google.com/gsi/client` is requested, and the Google button container is still present.

With Maps disabled, open the landing page. Expected before the fix: the Google Maps iframe is still requested.

- [ ] **Step 2: Update the login page markup**

In `login.html`:

- Remove the static `<script src="https://accounts.google.com/gsi/client" async defer></script>` tag.
- Add `hidden` to `.auth-divider` and `#gbtn` so they stay hidden until config confirms Google Auth.

- [ ] **Step 3: Update `login.js`**

Replace the `googleClientId` destructure with `data.integrations.googleAuth`. Implement `loadGoogleScript()` with a module-level promise. Only initialize/render the Google button when `enabled` is true and `clientId` is non-empty. Unhide the divider and button container only after `renderButton` succeeds. On config/script failure, leave both hidden and keep the password form usable.

After `login.js` uses the new shape, remove the temporary top-level `googleClientId` compatibility key from `app_config()` in `Backend/src/function/admin/settings.php`. The public response then contains only `ok` and `integrations`.

- [ ] **Step 4: Replace the landing iframe with a host**

In `index.html`, replace the hard-coded iframe with:

```html
<div class="map-frame" id="mapFrame" hidden></div>
```

Add `<script src="js/location-map.js"></script>` after `js/api.js`.

- [ ] **Step 5: Create `Frontend/js/location-map.js`**

The IIFE must:

- Find `#mapFrame`; return if absent.
- Call `getAppConfig()`.
- Read `data.integrations.googleMaps`.
- Do nothing if disabled or missing.
- Build `https://www.google.com/maps?q=8.1530406,125.1300626&z=18&output=embed` when `apiKey` is empty.
- Build `https://www.google.com/maps/embed/v1/place?key=<encoded>&q=8.1530406,125.1300626&zoom=18` when a key exists.
- Add `loading="lazy"`, `title="GameHub location map"`, `referrerpolicy="no-referrer-when-downgrade"`, `allowfullscreen`.
- Reveal `#mapFrame` only after the iframe is inserted.
- Keep the map hidden on any config failure.

- [ ] **Step 6: Verify both toggles**

Use the admin API to set `googleAuth` off. Reload the login page. Expected: no GIS network request, no divider, no Google button, password login works.

Set `googleAuth` on. Reload. Expected: the button appears.

Set `googleMaps` off. Reload the landing page. Expected: no Maps iframe request and no visible map frame.

Set `googleMaps` on. Reload. Expected: the map iframe loads.

- [ ] **Step 7: Commit**

```powershell
git add Frontend/src/function/auth/login.html Frontend/src/function/auth/login.js Frontend/index.html Frontend/js/location-map.js Backend/src/function/admin/settings.php
git commit -m "feat: apply integration toggles to login and landing map"
```

---

## Task 5: Extend `/api/me` and add the settings page profile tab

**Files:**
- Modify: `Backend/src/function/auth/login.php`
- Create: `Frontend/src/function/admin/settings.html`
- Create: `Frontend/src/function/admin/settings.js`
- Create: `Frontend/css/settings.css`

**Interfaces:**
- `GET /api/me` adds `displayName`, `authProvider`, `createdAt`, and `googleLinked`.
- `settings.js` uses `getMe()` and `dashTabsInit()`.

`GET /api/me` response additions:

```json
{
  "displayName": "Admin",
  "authProvider": "local",
  "createdAt": "2026-01-01T00:00:00+08:00",
  "googleLinked": true
}
```

- [ ] **Step 1: Confirm the settings page is missing**

Open `Frontend/src/function/admin/settings.html` via the static server. Expected: `404` before the file is created.

- [ ] **Step 2: Extend `auth_me()`**

Add the safe fields listed above. Convert `createdAt` with `toDateTime()->format(DATE_ATOM)` when present. Set `googleLinked` from a non-empty `googleSub`. Do not add `passwordHash` or `googleSub` to the response.

- [ ] **Step 3: Create the settings page shell**

Create `settings.html` with:

- `<body class="dash" data-theme="light">`.
- The same sidebar structure as `admin-dashboard.html`, but with no `.active`/`aria-current` link and `<nav class="dash-nav" data-no-active="true">`.
- A header with `.dash-menu`, and a `.dash-top-right` containing `<div data-admin-settings data-settings-url="./settings.html"></div>`.
- Page heading `Settings`.
- `.dash-tabs` with `data-t="profile" class="on"` and `data-t="api"`.
- One `<section id="settingsPanel" role="tabpanel" tabindex="0">` containing `#profileView` and `#apiView hidden`.
- Scripts: `../../../js/config.js`, `../../../js/api.js`, `../../../js/dash.js`, `./settings.js`.
- Styles: `../../../css/dashboard.css`, then `../../../css/settings.css`.

The profile view contains fields for avatar/display name, email, username, role, status, provider, Google linked state, and created date. Leave the API view with a loading placeholder until Task 6.

- [ ] **Step 4: Create `settings.js`**

Implement:

- An async guard using `getMe()`; redirect cashiers to `../cashiers/cashier-dashboard.html` and guests to `../auth/login.html`.
- Populate `#who` and `#avatar` from the profile.
- Populate profile fields with `textContent` only.
- `dashTabsInit((tab) => { ... })` to show/hide `#profileView` and `#apiView`, update `history.replaceState` to `#profile`/`#api`, and set `aria-labelledby` on `#settingsPanel`.
- On load, select the tab from `location.hash` (`#api` or default `#profile`).
- Show a readable error message if `/api/me` fails.

- [ ] **Step 5: Add settings-page styles**

Create `Frontend/css/settings.css` with the profile card, definition list, status badge, and settings page spacing. Use the existing `--d-*` tokens from `dashboard.css`. Do not edit `dashboard.css`.

- [ ] **Step 6: Verify the profile tab and guards**

- Guest opening `settings.html`: redirected to login.
- Cashier opening `settings.html`: redirected to the cashier dashboard.
- Admin opening it: profile fields match `/api/me`.
- `#profile` and `#api` deep links select the right tab.
- `/api/me` response contains no password hash, Google subject, or credential.

- [ ] **Step 7: Commit**

```powershell
git add Backend/src/function/auth/login.php Frontend/src/function/admin/settings.html Frontend/src/function/admin/settings.js Frontend/css/settings.css
git commit -m "feat: add admin settings page and profile tab"
```

---

## Task 6: Add API integration cards and controls

**Files:**
- Modify: `Frontend/js/api.js`
- Modify: `Frontend/src/function/admin/settings.html`
- Modify: `Frontend/src/function/admin/settings.js`
- Modify: `Frontend/css/settings.css`

**Interfaces:**
- `getAdminIntegrations(): Promise<{ok:boolean, integrations:Array}>`
- `updateAdminIntegration(key: string, fields: object): Promise<{ok:boolean, integration:object}>`

- [ ] **Step 1: Confirm the API tab has no controls**

Open `settings.html#api` as admin. Expected: only the placeholder from Task 5; no cards or toggles.

- [ ] **Step 2: Add the API wrappers**

In `Frontend/js/api.js`:

```js
async function getAdminIntegrations() {
  return api("/api/admin/settings/integrations");
}
async function updateAdminIntegration(key, fields) {
  return api(`/api/admin/settings/integrations/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}
```

- [ ] **Step 3: Render integration cards**

In `settings.js`, replace the API placeholder with `#apiList` and `#apiStatus`. On tab load (and on initial load when `#api` is selected), call `getAdminIntegrations()`.

Each card must show:

- Name and description.
- Status pill: `On`, `Off`, or `Planned`.
- A `role="switch"` toggle for available integrations; disabled for planned ones.
- One row per credential: label, `masked` or `Not set`, and buttons.
- `updatedAt` / `updatedBy` when present.

Use DOM creation and `textContent`, never `innerHTML` with server values.

- [ ] **Step 4: Implement toggle and credential actions**

- Toggle off: call `dashConfirm` first. If cancelled, restore the switch.
- Toggle on/off save: call `updateAdminIntegration(key, { enabled })`, show `dashToast`, and apply the returned integration object directly to the card. Reload the list only as a fallback when the response lacks a complete card.
- Replace: reveal a password-type input with Save/Cancel. Save trims, rejects empty with an inline error, calls `updateAdminIntegration(key, { credentials: { [name]: value } })`.
- Add (no existing value): same replacement form.
- Clear: `dashConfirm`, then call `updateAdminIntegration(key, { credentials: { [name]: "" } })`.
- If a required credential is cleared and the backend auto-disables the integration, apply the returned card and show the new `Off` state.
- If the response is older or partial and a fallback reload also fails, keep the saved UI state, show an inline `Saved, but the latest state could not be reloaded` message, and re-enable the form controls.
- On any API error: restore the previous UI state, show an inline `api-error`, and `dashToast(..., "err")`.
- Planned cards cannot be toggled or edited.

- [ ] **Step 5: Add card and switch styles**

Extend `Frontend/css/settings.css` with `.api-grid`, `.api-card`, `.api-card-head`, `.api-status`, `.api-credential`, `.api-mask`, `.api-actions`, `.dash-switch`, and responsive stacking. Reuse `.field` and `.btn` from `dashboard.css`. Add a `password` input rule scoped to the settings page if needed.

- [ ] **Step 6: Verify all card states**

- Google Auth and Maps show current state and masks.
- reCAPTCHA and OTP show `Planned` and cannot be changed.
- Disabling Google Auth asks for confirmation.
- Replacing the client ID changes the masked hint and persists after reload.
- Clearing the client ID auto-disables Google Auth.
- Full credentials never appear in the response or page source.
- Invalid client ID shows an inline error and no state change.
- Toast and error states appear without native popups.

- [ ] **Step 7: Commit**

```powershell
git add Frontend/js/api.js Frontend/src/function/admin/settings.html Frontend/src/function/admin/settings.js Frontend/css/settings.css
git commit -m "feat: add API integration controls to admin settings"
```

---

## Task 7: Replace admin theme/logout buttons with the settings menu

**Files:**
- Modify: `Frontend/js/dash.js`
- Modify: `Frontend/src/function/admin/admin-dashboard.html`
- Modify: `Frontend/src/function/admin/cashiers.html`
- Modify: `Frontend/src/function/admin/transactions.html`
- Modify: `Frontend/src/function/tables/tables.html`
- Modify: `Frontend/src/function/tables/rates.html`
- Modify: `Frontend/src/function/tables/sessions.html`
- Modify: `Frontend/src/function/admin/settings.html`
- Modify: `Frontend/src/function/admin/admin-dashboard.js`
- Modify: `Frontend/src/function/admin/cashiers.js`
- Modify: `Frontend/src/function/admin/transactions.js`
- Modify: `Frontend/src/function/tables/tables.js`
- Modify: `Frontend/src/function/tables/rates.js`
- Modify: `Frontend/src/function/tables/sessions.js`
- Modify: `Frontend/css/settings.css`

**Interfaces:**
- `dash.js` builds a menu inside `[data-admin-settings]`.
- `data-settings-url` supplies the settings page path.
- `[data-theme-switch]` carries `aria-checked`.
- `[data-logout]` performs the shared logout.
- `.dash-nav[data-no-active="true"]` suppresses automatic Dashboard activation.

- [ ] **Step 1: Confirm the current admin header**

Open any admin page. Expected before the fix: a `.dash-theme` button and a `.dash-logout` button; no gear menu.

- [ ] **Step 2: Build the menu in `dash.js`**

Add a settings-menu initializer that:

- Finds `[data-admin-settings]` and returns if absent.
- Creates a gear button with `aria-haspopup="menu"`, `aria-expanded`, and `aria-label="Open settings"`.
- Creates a panel appended to `document.body` (not inside `.dash-top`) with `role="menu"` and four items: Profile link, API link, Dark mode checkbox item, Logout item.
- Uses `data-settings-url` to build the two links.
- Positions the panel with `position: fixed` using the trigger's `getBoundingClientRect()` so `.dash-top { overflow: hidden; backdrop-filter: ... }` cannot clip it.
- Closes on outside click (checking both the trigger host and the body-appended panel), Escape, scroll, and resize; returns focus to the gear on close.
- Supports Arrow Up/Down, Home/End, and Enter/Space.
- Toggles the theme and updates `aria-checked`; reuses `localStorage["gh-theme"]`.
- Calls `logout()` and redirects to `../auth/login.html` on Logout; ignore logout errors and redirect anyway.

Keep the existing `.dash-theme` code for cashier pages. Update `applyTheme()` so it updates both the old `.dash-theme` class and any `[data-theme-switch]`.

- [ ] **Step 3: Update the six admin pages**

For each admin page:

- Add `<link rel="stylesheet" href="../../../css/settings.css" />` after `dashboard.css`.
- Replace the `.dash-theme` and `.dash-logout` buttons inside `.dash-top-right` with:
  - Admin pages: `<div data-admin-settings data-settings-url="./settings.html"></div>`
  - Tables pages: `<div data-admin-settings data-settings-url="../admin/settings.html"></div>`
- Keep all existing search/menu/header layout intact.

Add the same menu placeholder to `settings.html` with `data-settings-url="./settings.html"`.

- [ ] **Step 4: Remove per-page logout handlers**

Delete the `document.getElementById("out").addEventListener(...)` blocks from the six admin page scripts. Do not change cashier scripts.

- [ ] **Step 5: Support no-active navigation on the settings page**

In `dash.js`, read `nav.hasAttribute("data-no-active")`. When true and no link has `.active`, leave all links inactive and hide the pill instead of falling back to the first link.

- [ ] **Step 6: Add menu styles**

Extend `Frontend/css/settings.css` with `.dash-settings-wrap`, `.dash-settings-btn`, `.dash-settings-panel`, `.dash-settings-item`, `.dash-settings-item.danger`, `.dash-settings-sep`, and `.dash-switch`. Match the existing 40px circular button and use `--d-*` tokens. Ensure the panel is above content, right-aligned, and never wider than the viewport.

- [ ] **Step 7: Verify all admin pages**

For each of the six admin pages plus `settings.html`:

- Gear appears; no standalone theme/logout buttons remain.
- Menu contains Profile, API, Dark mode, Logout.
- Profile/API links open the correct tab.
- Dark mode updates the page and persists after refresh.
- Logout returns to login.
- Menu is not clipped on desktop or mobile.
- Keyboard navigation and Escape work.
- Cashier pages still show the old theme and logout controls and still work.

- [ ] **Step 8: Commit**

```powershell
git add Frontend/js/dash.js Frontend/src/function/admin/admin-dashboard.html Frontend/src/function/admin/cashiers.html Frontend/src/function/admin/transactions.html Frontend/src/function/tables/tables.html Frontend/src/function/tables/rates.html Frontend/src/function/tables/sessions.html Frontend/src/function/admin/settings.html Frontend/src/function/admin/admin-dashboard.js Frontend/src/function/admin/cashiers.js Frontend/src/function/admin/transactions.js Frontend/src/function/tables/tables.js Frontend/src/function/tables/rates.js Frontend/src/function/tables/sessions.js Frontend/css/settings.css
git commit -m "feat: replace admin theme and logout with settings menu"
```

---

## Task 8: Documentation, regression, and final verification

**Files:**
- Modify: `architecture.md`
- Modify: `AGENTS.md`
- Modify: `docs/01-requirements-matrix.md`
- Modify: `docs/TechnicalRequirements-01.md`

- [ ] **Step 1: Update the documentation**

- Add `settings` to the collection table in `architecture.md` and `AGENTS.md`.
- Add the admin settings endpoints and public config shape to `architecture.md`.
- Add AD-034 through AD-037 to `docs/01-requirements-matrix.md`:
  - AD-034 Administrator should be able to manage API integrations.
  - AD-035 Administrator should be able to view their profile.
  - AD-036 Administrator should be able to switch between light and dark mode from the settings menu.
  - AD-037 Administrator should be able to log out from the settings menu.
- Change the status in `docs/TechnicalRequirements-01.md` from Draft to Approved/implemented with the date.

- [ ] **Step 2: Run syntax checks on every changed PHP file**

```powershell
php -l Backend\src\function\admin\settings.php
php -l Backend\src\function\auth\google.php
php -l Backend\src\function\auth\login.php
php -l Backend\routes\api.php
php -l Backend\scripts\setup_settings.php
```

Expected: all no syntax errors.

- [ ] **Step 3: Run the full manual QA checklist**

Use `docs/TechnicalRequirements-01.md` section 13. At minimum verify:

- Guest/cashier/admin access rules.
- Profile data.
- API cards, masks, toggles, clear/replace, planned entries.
- Google Auth off → no button, no GIS request, endpoint `403`.
- Google Auth on → button and real login.
- Maps off → no iframe request.
- Maps on → iframe loads.
- All six admin pages’ settings menu, theme, and logout.
- Cashier dashboard/sessions/tables unchanged.
- No full credential in network responses or `activityLogs`.
- No console errors.

- [ ] **Step 4: Check the diff and status**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors. `Frontend/css/dashboard.css` remains modified and unstaged; no `Backend/.env` or `vendor` files are staged.

- [ ] **Step 5: Commit**

```powershell
git add architecture.md AGENTS.md docs/01-requirements-matrix.md docs/TechnicalRequirements-01.md
git commit -m "docs: document admin settings and integration controls"
```

---

## Self-review notes

- Spec coverage: settings menu (Task 7), profile (Task 5), API list/update (Tasks 1-2, 6), Google Auth enforcement (Tasks 3-4), Maps enforcement (Tasks 4), masking/audit (Tasks 1-2), setup/index (Task 2), docs (Task 8).
- The plan intentionally uses manual curl/browser verification because the project has no automated test or lint suite.
- New styles live in `settings.css` so the existing uncommitted `dashboard.css` change is not disturbed.
- `google_login()` and `google_verify_token()` share the DB client ID; `GET /api/config` and the backend `aud` check cannot drift.
- The menu uses fixed positioning, so the existing `.dash-top { overflow: hidden; }` fix remains intact.
