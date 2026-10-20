# Technical Requirements 01 — Admin Settings, Profile & API Integrations

**Date:** 2026-10-20
**Status:** Approved and implemented — 2026-10-20
**Area:** Admin only
**Related files:** `Frontend/js/dash.js`, `Frontend/js/theme.js`, `Frontend/js/api.js`, `Backend/routes/api.php`, `Backend/src/function/auth/google.php`, `Backend/src/function/auth/login.php`

---

## 1. Purpose

Give the administrator one admin-only settings surface instead of the current bare theme/logout controls.

The settings button replaces the dark/light toggle in the admin dashboard header. It opens a menu with:

1. **User profile**
2. **API**
3. **Dark / Light mode**
4. **Logout**

The API section lets the admin enable or disable external integrations, starting with **Google Authentication** and **Google Maps**. Future entries such as **reCAPTCHA** and **OTP** can be added without redesigning the page.

Integration credentials (for example a Google OAuth client ID or Maps key) are stored in MongoDB, not hard-coded in frontend files. The admin API returns only masked values such as `••••••••ab12`; the full value is never returned by a read endpoint.

This document is the review artifact. Implementation starts only after this document is approved.

---

## 2. Goals

- Replace the theme-only button on admin pages with a settings menu.
- Move logout into that menu and remove the separate Logout button from admin pages.
- Provide an admin profile view.
- Provide an API integrations screen with working enable/disable switches.
- Store integration credentials in the database and mask them on read.
- Enforce a disabled integration on both the frontend and the backend.
- Keep cashier pages unchanged: cashiers keep the existing theme toggle and Logout button.
- Keep the existing no-build, plain PHP + static-frontend architecture.

## 3. Non-goals

- Rebuilding the admin dashboard visual design.
- Giving cashiers access to settings, API integrations, or the admin profile.
- Implementing reCAPTCHA or OTP now. They appear only as planned/disabled entries.
- Changing the admin sign-in rules (single admin, Google is admin-only).
- Server-side persistence of the theme preference.
- Editing the admin email, password, or role in this version.
- Adding a general-purpose feature-flag framework for cashier or customer pages.

## 4. Anti-goals

The implementation fails if any of these happen:

- A cashier can see or call the API integration settings.
- A disabled Google Authentication integration still accepts `POST /api/auth/google`.
- A disabled Google Maps integration still loads the Google Maps iframe on the public landing page.
- A full API key is returned in an admin API response, written to a log, or embedded in an error message.
- Disabling Google Authentication locks the admin out while password login still works.
- The settings dropdown is clipped by the dashboard header or unusable on mobile.
- The existing admin page guards or session behavior are weakened.

---

## 5. Current state

| Area | Current behavior |
|---|---|
| Admin header | `dash-theme` icon button + separate `dash-logout` button on each admin page |
| Theme | `Frontend/js/dash.js` toggles `data-theme` on `.dash` and stores `gh-theme` in `localStorage` |
| Logout | Each admin page script binds `#out` to `logout()` and redirects to login |
| Google login | `GOOGLE_CLIENT_ID` comes from `.env`; `GET /api/config` returns it; `login.html` always loads the Google GIS script and renders the button when a client ID exists |
| Google map | A hard-coded keyless `<iframe>` in `Frontend/index.html`; no toggle and no application key |
| Settings storage | No settings collection or admin settings endpoints |
| Admin pages | `admin-dashboard.html`, `admin/cashiers.html`, `admin/transactions.html`, `tables/tables.html`, `tables/rates.html`, `tables/sessions.html` |
| Cashier pages | `cashier-dashboard.html`, `cashier-sessions.html`, `cashier-tables.html` (must not change) |

The current map is a Google Maps embed URL without an API key. Therefore "Google Maps API" in this document means the map integration/feature; an API key field is included for future use but remains optional.

---

## 6. User experience

### 6.1 Admin header: settings menu

Replace this on every admin page:

```text
[ moon/sun icon ]  [ Log out ]
```

with this:

```text
[ gear icon ]
     |
     +-- User profile
     +-- API
     +-- Dark mode        [ switch ]
     +-- Logout
```

Recommended visual: a circular gear button matching the current 40×40 theme button, opening a right-aligned dropdown panel.

Menu behavior:

- Clicking the gear opens/closes the menu.
- Clicking outside or pressing `Escape` closes it.
- `User profile` goes to the Profile tab of the admin settings page.
- `API` goes to the API Integrations tab.
- `Dark mode` toggles immediately, updates the `gh-theme` value, and reflects the current state with a switch. It does not call the backend.
- `Logout` calls `POST /api/logout`, clears the local session state, and redirects to the staff login.
- Only one menu item group has a destructive style: Logout.
- The menu must not be clipped by `.dash-top` (currently `overflow: hidden`); either make the header allow overflow or render the panel with fixed positioning.
- On mobile, the panel stays inside the viewport and above page content.

Accessibility requirements:

- Trigger has `aria-haspopup="menu"`, `aria-expanded`, and an accessible name (`Open settings`).
- Menu items support Arrow Up/Down, Home/End, Enter/Space, and Escape.
- The dark-mode row uses `role="menuitemcheckbox"` or an equivalent switch with `aria-checked`.
- Focus returns to the gear button after the menu closes.
- Existing focus-visible styles and reduced-motion rules are reused.

### 6.2 Admin settings page

Create a dedicated admin page:

```text
Frontend/src/function/admin/settings.html
Frontend/src/function/admin/settings.js
```

Entry points: the settings menu's Profile and API items. The page is admin-guarded through `GET /api/me` and redirects non-admins to the correct dashboard or login.

Layout:

```text
Settings
Profile | API Integrations
----------------------------------------
[ current tab content ]
```

The selected tab is reflected in the URL hash (`#profile`, `#api`) so the menu can deep-link to either section.

### 6.3 Profile tab

Display read-only account information:

- Avatar initial / display name
- Email address
- Username (if present)
- Role
- Account status
- Sign-in provider (`local` / Google)
- Whether a Google account is linked
- Account creation date

No password hash, Google subject ID, or secret is displayed.

`GET /api/me` is extended to return the additional safe fields. No new profile endpoint is required for a read-only profile.

Optional (see open decisions): edit display name through `PUT /api/admin/profile`.

### 6.4 API Integrations tab

Render one card per integration from a server-defined registry.

```text
+------------------------------------------------------+
|  Google Authentication                      [ON]     |
|  Admin Google sign-in                                 |
|  Client ID   ••••••••1abc                             |
|  Last updated Oct 20, 2026 by admin@example.com       |
|  [ Replace client ID ]  [ Clear ]                     |
+------------------------------------------------------+
```

Cards for version 1:

| Integration | Available now | Credential field | Required |
|---|---|---|---|
| Google Authentication | Yes | OAuth Client ID | Yes when enabled |
| Google Maps | Yes | Maps API key (optional) | No |
| reCAPTCHA | No — planned | Site key + secret key (shown disabled) | — |
| OTP / email codes | No — planned | None | — |

Card behavior:

- Toggle changes are only saved after a confirmation for disabling an integration.
- Google Authentication shows an extra warning when being disabled: "Password sign-in must remain available for the admin account."
- Save shows a toast (`dashToast`) and updates the card's status and masked value.
- Errors are shown inline on the card; other cards remain usable.
- Planned integrations have disabled controls and a "Planned" badge.
- The page does not display full credential values. `Replace` opens a blank password-type input; leaving it blank and cancelling keeps the current value.
- `Clear` asks for confirmation and removes the stored credential. Clearing a required credential automatically disables that integration.
- "Last updated" shows the timestamp and actor but never the credential.

### 6.5 Dark / Light mode

- Reuses the existing `gh-theme` localStorage key and `data-theme` mechanism.
- Toggling from the settings menu updates the current admin page immediately.
- The choice follows the admin across admin pages, as it does today.
- This remains a per-browser preference, not an account setting.
- Cashier and public pages keep their existing theme controls.

### 6.6 Logout

- Removed from the admin header as a standalone button.
- Available only through the settings menu on admin pages.
- Calls the existing `POST /api/logout` wrapper and redirects to `../auth/login.html` (or the correct relative path).
- Cashier logout remains where it is.

---

## 7. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| TR-001 | The settings gear appears on every admin page and only on admin pages. | Must |
| TR-002 | The dropdown contains Profile, API, Dark mode, and Logout. | Must |
| TR-003 | Cashier pages keep the current theme button and Logout button. | Must |
| TR-004 | The admin profile shows only safe account fields. | Must |
| TR-005 | The API page lists integrations from a server registry. | Must |
| TR-006 | Google Authentication can be enabled or disabled. | Must |
| TR-007 | Disabling Google Authentication hides the Google sign-in button and blocks the backend endpoint. | Must |
| TR-008 | Google Maps can be enabled or disabled. | Must |
| TR-009 | Disabling Google Maps prevents the landing page from loading the map iframe. | Must |
| TR-010 | Integration credentials are stored in MongoDB and returned only in masked form. | Must |
| TR-011 | Clearing a required credential disables its integration. | Must |
| TR-012 | Planned integrations (reCAPTCHA, OTP) are visible but cannot be enabled. | Should |
| TR-013 | Every toggle/credential change is written to `activityLogs` without secret values. | Must |
| TR-014 | All settings endpoints require an admin session. | Must |
| TR-015 | Theme choice remains persistent across admin pages. | Must |
| TR-016 | Logout from the menu works from every admin page. | Must |
| TR-017 | The menu and settings page are keyboard accessible and mobile-safe. | Must |
| TR-018 | Existing admin guards and cashier flows are not broken. | Must |

### 7.1 Suggested requirements-matrix entries

These are proposed additions to `docs/01-requirements-matrix.md`; they are not added until approved.

- **AD-034** — Administrator should be able to manage API integrations.
- **AD-035** — Administrator should be able to view their profile.
- **AD-036** — Administrator should be able to switch between light and dark mode from the settings menu.
- **AD-037** — Administrator should be able to log out from the settings menu.

---

## 8. API design

All admin endpoints use `require_admin()`. Guest requests return `401`; cashier requests return `403`.

### 8.1 Public configuration

`GET /api/config` remains public and becomes the source of frontend feature state.

Response shape:

```json
{
  "ok": true,
  "integrations": {
    "googleAuth": {
      "enabled": true,
      "clientId": "1234.apps.googleusercontent.com"
    },
    "googleMaps": {
      "enabled": true,
      "apiKey": ""
    }
  }
}
```

Rules:

- If Google Authentication is disabled, `enabled` is `false` and `clientId` is omitted or empty.
- If Google Maps is disabled, `enabled` is `false` and `apiKey` is omitted or empty.
- The Google client ID and the Maps browser key are public identifiers. They must be present for the browser to use the services, even though the admin UI masks them. Any truly secret value (future reCAPTCHA secret) is never returned here.
- Add `Cache-Control: no-store` to this response so a toggle is reflected on the next page load.
- Resolve both integration documents in one settings read so the response has a single consistent snapshot.
- The client ID returned here and the client ID used by the backend for the Google `aud` check must be the same value. `google_verify_token()` must read the configured client ID, not the hard-coded environment value, whenever a settings document exists.

Failure policy:

| Situation | Google Auth | Google Maps |
|---|---|---|
| Settings document exists | Use DB value | Use DB value |
| No document (fresh database, setup script not run) | Use `GOOGLE_CLIENT_ID` if present, otherwise disabled | Enabled (preserve current landing behavior) |
| Settings read throws a database error | Disabled (fail closed) | Disabled (fail closed) |

Environment defaults are used only when the document is positively absent. A read failure is never treated as an absent document, so neither integration falls back to environment values. The maps fallback is the only case where an unseeded database shows the map. Run `setup_settings.php` as part of deployment so the database is authoritative.

This table describes the public config endpoint only. `POST /api/auth/google` always fails closed with `503` when the settings lookup throws; it never falls back to the environment while a database document may exist.

### 8.2 List admin integrations

`GET /api/admin/settings/integrations`

Response:

```json
{
  "ok": true,
  "integrations": [
    {
      "key": "googleAuth",
      "name": "Google Authentication",
      "description": "Admin Google sign-in",
      "available": true,
      "enabled": true,
      "credentials": [
        {
          "name": "clientId",
          "label": "OAuth Client ID",
          "required": true,
          "configured": true,
          "masked": "••••••••ab12"
        }
      ],
      "updatedAt": "2026-10-20T10:00:00+08:00",
      "updatedBy": "admin@example.com"
    }
  ]
}
```

Masking rule: always use eight bullet characters plus a four-character display hint when the value is longer than eight characters. For Google client IDs the hint is the last four identifying characters before the fixed `.apps.googleusercontent.com` suffix, so `1234-ab12.apps.googleusercontent.com` displays as `••••••••ab12`; the constant domain suffix is never used as the hint. For every other credential the hint is the last four characters. For values of eight characters or fewer, return bullets only. The full value is never part of this response.

### 8.3 Update an integration

`PUT /api/admin/settings/integrations/{key}`

Body:

```json
{
  "enabled": false,
  "credentials": {
    "clientId": "new-client-id.apps.googleusercontent.com"
  }
}
```

Rules:

- `key` must exist in the server registry; unknown key → `404`.
- A planned integration (`available: false`) cannot be changed → `422`.
- Omitted `credentials` fields are unchanged.
- An explicit empty string clears a credential.
- Cannot enable an integration whose required credential is missing → `422`.
- Clearing a required credential while enabled automatically sets `enabled` to `false` (or rejects; see open decision — recommended: auto-disable and report it).
- Credential values are trimmed and length-checked (maximum 2048 characters).
- Google client ID must match `^[A-Za-z0-9_-]{5,}\.apps\.googleusercontent\.com$` when set, so a bare domain suffix is rejected.
- Maps key is optional; if set, it must be a non-empty token without whitespace.
- No credential value is written to `activityLogs`.
- Updates write only the fields that changed. The settings write and its activity log are committed in one MongoDB transaction, so a success response implies both were stored.
- Response returns the updated masked integration object. The client applies it directly; a list reload is only a fallback for older or partial responses.

Errors:

| Status | Case |
|---|---|
| `401` | No session |
| `403` | Cashier/no admin role |
| `404` | Unknown integration key |
| `422` | Invalid credential, planned integration, or enabling without required credential |
| `503` | Database unavailable |

### 8.4 Verify password (optional safety check)

If the reviewer wants extra protection before disabling Google Authentication:

`POST /api/admin/settings/verify-password` with `{ "password": "..." }` → `{ "ok": true }` or `401`.

This is optional and not required for the first version.

### 8.5 Profile data

Extend `GET /api/me` with safe fields:

```json
{
  "ok": true,
  "username": null,
  "email": "admin@example.com",
  "role": "admin",
  "status": "active",
  "displayName": "Admin",
  "authProvider": "local",
  "createdAt": "2026-01-01T00:00:00+08:00",
  "googleLinked": true
}
```

No `passwordHash`, `googleSub`, or credentials.

If display-name editing is approved, add `PUT /api/admin/profile` with `{ "displayName": "..." }`, validate length, and write an activity log.

---

## 9. Data model

Add one collection: `settings` in `gamehub_2_0`.

```js
{
  _id: ObjectId,
  key: "googleAuth",                 // unique
  enabled: true,
  credentials: {
    clientId: {
      value: "1234-ab12.apps.googleusercontent.com",
      last4: "ab12",                 // hint before the fixed domain suffix
      updatedAt: ISODate
    }
  },
  updatedAt: ISODate,
  updatedBy: "admin@example.com"
}
```

Example documents:

```js
// Google Authentication
{
  key: "googleAuth",
  enabled: true,
  credentials: {
    clientId: {
      value: "1234-ab12.apps.googleusercontent.com",
      last4: "ab12",
      updatedAt: ISODate("2026-10-20T10:00:00Z")
    }
  }
}

// Google Maps
{
  key: "googleMaps",
  enabled: true,
  credentials: {
    apiKey: {
      value: "",
      last4: "",
      updatedAt: ISODate("2026-10-20T10:00:00Z")
    }
  }
}

// Planned integration, disabled until implemented
{
  key: "recaptcha",
  enabled: false,
  credentials: {}
}
```

Indexes (created once, never per request):

```js
settings: { key: 1 } unique
```

### 9.1 Bootstrap and precedence

- Add `Backend/scripts/setup_settings.php` (one-time script) that:
  - Creates the unique `key` index.
  - Seeds `googleAuth` from `GOOGLE_CLIENT_ID` when no document exists. If the environment value is empty, create the document with `enabled: false` and no credential.
  - Seeds `googleMaps` as enabled with an empty optional key.
  - Leaves planned integrations seeded as disabled.
- Precedence after setup:
  1. Database document, if it exists.
  2. Environment value, only when no database document exists.
  3. Disabled / empty.
- Never seed or create indexes per request (existing project rule).
- Removing the `settings` documents returns the system to environment-based behavior only because the lookup then proves the document is absent. A settings read failure never falls back to the environment.
- The setup script is a deployment step. The application must still behave safely if it is forgotten; see the failure policy in section 8.1.

### 9.2 Credential handling

- Public identifiers (Google client ID, Maps browser key) are stored as strings but masked in admin API responses.
- Future secret credentials (for example a reCAPTCHA secret key) must be encrypted at rest with `SETTINGS_ENCRYPTION_KEY` using AES-256-GCM before storage. Do not add a plaintext secret field.
- `last4` is stored separately so the admin list can show a hint without decrypting or returning the value. For Google client IDs the hint is taken from the identifying part before the fixed `.apps.googleusercontent.com` suffix, never from the constant suffix itself.
- Credential values are never logged, never echoed in validation errors, and never placed in `activityLogs`.

---

## 10. Runtime enforcement

### 10.1 Google Authentication

Frontend:

- `login.html` must not load `https://accounts.google.com/gsi/client` when the integration is disabled.
- Load the Google script dynamically after `GET /api/config` confirms `googleAuth.enabled` and a `clientId` exists.
- Hide the `— or —` divider and the Google button container when disabled.
- If the config request fails, keep the password form working and hide Google.

Backend:

- `google_login()` checks the integration before verifying the token.
- Disabled → `403` with a clear message such as `Google sign-in is disabled by the administrator`.
- Missing credential while enabled → `503` configuration error, never a token-verification call.
- Settings lookup failure → `503` (fail closed). Do not fall back to the environment after an admin has configured the database.
- When enabled, `google_verify_token()` must use the same client ID that `/api/config` returned to the browser for the `aud` check. Refactor it to accept the configured client ID instead of reading only `GOOGLE_CLIENT_ID`.
- Environment fallback is used only when no `settings` document exists; it is never used to override an existing document.

### 10.2 Google Maps

Frontend:

- Remove the hard-coded working iframe from `index.html`.
- Add a map host that is hidden by default.
- On load, `GET /api/config`; if `googleMaps.enabled`, build and insert the iframe. If disabled, keep the map hidden and show the location text only (or a small "Map unavailable" note).
- Do not request Google Maps at all when disabled.
- If config fails, keep the map hidden (fail closed for the external embed).

Backend:

- `GET /api/config` reports `googleMaps.enabled`.
- The toggle is a product feature, not an access-control boundary: a determined visitor could still open Google Maps directly. Do not treat it as a security control.

### 10.3 Behavior matrix

| Setting | Login page | `POST /api/auth/google` | Landing map | Public config |
|---|---|---|---|---|
| Google Auth ON + credential | Google button shown | Allowed | Unchanged | `enabled: true` + client ID |
| Google Auth OFF | Button/divider hidden, GIS script not loaded | `403` | Unchanged | `enabled: false`, no client ID |
| Google Maps ON | Unchanged | Unchanged | Iframe loads | `enabled: true` |
| Google Maps OFF | Unchanged | Unchanged | No iframe request | `enabled: false` |
| No settings document | Falls back to `GOOGLE_CLIENT_ID` | Falls back to env client ID if present | Map shows (legacy default) | Env-derived |
| Config request fails | Google button hidden; password form works | Backend remains authoritative; DB failure → `503` | Map hidden | — |

---

## 11. Files expected to change

### Backend

| File | Change |
|---|---|
| `Backend/routes/api.php` | Add settings routes; load `admin/settings.php` |
| `Backend/src/function/admin/settings.php` | New: integration registry, list/update handlers, masking, audit logs |
| `Backend/src/function/auth/google.php` | Read DB setting; enforce disabled state; update `app_config()` |
| `Backend/src/function/auth/login.php` | Extend `auth_me()` with safe profile fields (if approved) |
| `Backend/scripts/setup_settings.php` | New: create index + seed defaults |
| `Backend/.env.example` | Document `SETTINGS_ENCRYPTION_KEY` only if secret credentials are introduced |
| `architecture.md` | Add `settings` collection and admin settings endpoints |

### Frontend

| File | Change |
|---|---|
| `Frontend/src/function/admin/settings.html` | New settings page |
| `Frontend/src/function/admin/settings.js` | New page logic (guard, tabs, profile, API cards) |
| `Frontend/js/dash.js` | Build/operate the admin settings menu; central logout helper; keep cashier theme behavior |
| `Frontend/js/api.js` | Add `getAdminIntegrations()`, `updateAdminIntegration()`; update config parsing |
| `Frontend/css/settings.css` | New: gear menu, dropdown, switch, API cards, profile card, responsive states (keeps the existing uncommitted `dashboard.css` changes untouched) |
| `Frontend/index.html` | Replace static map iframe with a config-driven host |
| `Frontend/js/tables-public.js` or a small new script | Load config and conditionally insert the map |
| `Frontend/src/function/auth/login.html` | Remove static GIS script tag; keep a placeholder for the Google button |
| `Frontend/src/function/auth/login.js` | Load GIS only when enabled; hide divider/button when disabled |
| Admin page HTML | Replace theme/logout controls with the shared settings menu on all six admin pages |
| Admin page JS | Remove per-page `#out` handlers where the shared menu now owns logout |
| `Frontend/src/function/cashiers/*` | No change |

### Docs

| File | Change |
|---|---|
| `docs/TechnicalRequirements-01.md` | This document |
| `docs/01-requirements-matrix.md` | Add AD-034..AD-037 after approval |
| `architecture.md` | Data model and endpoint notes |
| `AGENTS.md` | Add `settings` to the collection list after implementation |

---

## 12. Implementation phases

### Phase 1 — Data and backend foundation

- Add `settings` collection setup script and unique index.
- Seed `googleAuth` from the existing environment value.
- Add the integration registry and admin list/update endpoints with masking and audit logs.
- Extend `GET /api/config`.
- Verify with curl as admin, cashier, and guest.

### Phase 2 — Enforcement

- Update `google_login()` to reject when disabled.
- Update `login.html`/`login.js` to load GIS conditionally.
- Update the landing map to render only when enabled.
- Verify no Google script/map request occurs when disabled.

### Phase 3 — Admin settings UI

- Add `settings.html` + `settings.js` with Profile and API tabs.
- Extend `/api/me` with profile fields.
- Add API cards, toggles, masked credential replacement, confirmations, toasts.
- Add loading, empty, error, and planned states.

### Phase 4 — Header menu migration

- Add the gear menu to all admin pages.
- Move logout into the menu.
- Keep the theme switch working from the menu.
- Update admin page scripts to remove their own logout bindings.
- Remove the standalone theme/logout buttons from admin pages only.

### Phase 5 — Hardening and verification

- Keyboard/mobile testing.
- Unauthorized access checks.
- Audit log checks.
- Confirm no secrets in network responses, HTML, or logs.
- Update architecture and requirements docs.

---

## 13. Acceptance criteria / manual QA

### Access control

- [ ] Guest opening `admin/settings.html` is redirected to login.
- [ ] Cashier opening `admin/settings.html` is redirected to the cashier dashboard.
- [ ] Guest calling `GET /api/admin/settings/integrations` gets `401`.
- [ ] Cashier calling the same endpoint gets `403`.
- [ ] Cashier pages have no settings gear and keep their existing theme/logout controls.

### Header menu

- [ ] Gear appears on all six admin pages.
- [ ] Menu contains Profile, API, Dark mode, Logout.
- [ ] Logout works from every admin page.
- [ ] Menu closes on outside click and Escape.
- [ ] Menu is not clipped by the dashboard header on desktop or mobile.
- [ ] Keyboard operation works; focus returns to the gear.
- [ ] Theme switch updates the page and persists after refresh.
- [ ] No standalone Logout button remains on admin pages.

### Profile

- [ ] Profile tab shows email, role, status, provider, Google-linked state, and creation date.
- [ ] No password hash, Google subject ID, or credential is present in the network response.
- [ ] Non-admin cannot reach the profile tab.

### API integrations

- [ ] Google Authentication card shows current state and masked client ID.
- [ ] Google Maps card shows current state and masked/empty key.
- [ ] reCAPTCHA and OTP cards show "Planned" and cannot be enabled.
- [ ] Disabling Google Authentication triggers a warning.
- [ ] Saving a toggle/credential shows a toast and persists after refresh.
- [ ] Clearing a required credential disables the integration.
- [ ] An invalid Google client ID is rejected with `422` and an inline message.
- [ ] The full credential value never appears in the admin API response.
- [ ] The full credential value never appears in `activityLogs`.
- [ ] Toggle and credential updates create audit entries.

### Google Authentication enforcement

- [ ] Enabled: login page shows the Google button, and `POST /api/auth/google` still works.
- [ ] Disabled: login page shows no Google button and no GIS script request.
- [ ] Disabled: direct `POST /api/auth/google` returns `403`.
- [ ] Disabled: password login still works for the admin.
- [ ] Re-enabled: Google button returns and login works again.

### Google Maps enforcement

- [ ] Enabled: landing page loads the map iframe.
- [ ] Disabled: landing page makes no Google Maps iframe request and still shows the location text.
- [ ] Config failure: map stays hidden, rest of the landing page works.
- [ ] Toggle applies on the next page load without a server restart.

### Regression

- [ ] Admin dashboard stats still load.
- [ ] Staff invitations, tables, rates, sessions, and transactions pages still work.
- [ ] Cashier dashboard, sessions, and tables still work.
- [ ] Existing theme choice on cashier/public pages is unaffected.
- [ ] Existing admin-only route guards still return correct statuses.

---

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Admin disables Google and cannot remember the password | Show a warning; keep password login; optional password confirmation before disabling |
| `.dash-top { overflow: hidden; }` clips the dropdown | Append the panel to `document.body` and use fixed positioning; test all breakpoints |
| Full key leaks through API, logs, or error messages | Masked responses, audit field names only, no credential interpolation in errors |
| Public Maps key can be abused | Restrict the key by HTTP referrer in Google Cloud; it is public by nature |
| DB outage breaks login config | `/api/config` uses env only when no document exists; a read failure fails closed for Google Auth and Maps. Password login is unaffected |
| Toggle appears to work but page still uses old state | `Cache-Control: no-store` on `/api/config`; reload required for public pages |
| Future integrations require a redesign | Server registry drives cards; planned entries already present |
| Admin page scripts still bind a removed `#out` button | Centralize logout in `dash.js`; update all six admin scripts |
| Settings page creates an inconsistent sidebar | Add a Settings nav item or use the shared menu only; decide before UI implementation |
| Secrets stored as plaintext in Mongo | v1 fields are public identifiers; future secret fields require AES-256-GCM at rest |

---

## 15. Decisions (approved 2026-10-20)

1. **Settings surface:** A dedicated `settings.html` page with Profile/API tabs.
2. **Profile scope:** Read-only profile for v1. Display-name editing and password change are out of scope.
3. **Google Maps credential:** Keep the optional API key field; the current keyless embed remains the default.
4. **Credential visibility:** Never show the full value; show the mask and a four-character hint only (for Google client IDs, the hint comes from the identifying part before the fixed domain suffix).
5. **Google Auth disable safety:** Confirmation dialog only; no password prompt.
6. **Settings navigation:** Keep settings reachable from the gear menu only; no extra sidebar item.
7. **Clearing a required credential:** Auto-disable the integration and report the new state.
8. **Planned entries:** Show reCAPTCHA and OTP as disabled "Planned" cards.

---

## 16. Approval

- [x] Scope approved
- [x] Decisions answered
- [x] Ready to write the implementation plan
- [x] Implementation plan: `docs/superpowers/plans/2026-10-20-admin-settings-api-integrations.md`

**Reviewer notes:** Approved by the project owner on 2026-10-20.

---

## Appendix A — Proposed endpoint summary

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/config` | Public | Google Auth/Maps feature state |
| `GET` | `/api/admin/settings/integrations` | Admin | List integrations with masked credentials |
| `PUT` | `/api/admin/settings/integrations/{key}` | Admin | Toggle integration / replace credential |
| `POST` | `/api/admin/settings/verify-password` | Admin | Optional safety check before disabling Google Auth |
| `GET` | `/api/me` | Logged in | Extended profile fields |
| `PUT` | `/api/admin/profile` | Admin | Optional display-name update |

## Appendix B — Proposed admin page inventory

| Page | Current header | Target header |
|---|---|---|
| `Frontend/src/function/admin/admin-dashboard.html` | theme + logout | settings gear |
| `Frontend/src/function/admin/cashiers.html` | theme + logout | settings gear |
| `Frontend/src/function/admin/transactions.html` | theme + logout | settings gear |
| `Frontend/src/function/tables/tables.html` | theme + logout | settings gear |
| `Frontend/src/function/tables/rates.html` | theme + logout | settings gear |
| `Frontend/src/function/tables/sessions.html` | theme + logout | settings gear |
| `Frontend/src/function/cashiers/cashier-dashboard.html` | theme + logout | unchanged |
| `Frontend/src/function/cashiers/cashier-sessions.html` | theme + logout | unchanged |
| `Frontend/src/function/cashiers/cashier-tables.html` | theme + logout | unchanged |
| `Frontend/src/function/shared/receipt.html` | theme only | unchanged |
