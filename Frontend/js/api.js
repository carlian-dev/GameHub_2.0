// GameHub_2.0 API wrapper - how Frontend talks to Backend.
// Purpose in plain words: Frontend is FORBIDDEN from talking to MongoDB directly
// (password would leak). It may only ask the Express Backend. This file holds those
// fetch() calls in one place. Example: getHealth() asks "GET http://localhost:8000/api/health"
// and returns {ok:true, db:"gamehub_2_0", ...}. To add login later, add getUsers(), login(), etc. here.
// Purpose: fetch wrapper. Frontend never talks to MongoDB directly, only to the Express Backend.
// NOTE: credentials:"include" sends the HttpOnly JWT auth cookie, without it
// login would succeed but the next request would look like a stranger (401).
// A hung backend/Atlas connection must not leave a page on "Loading…" forever.
const API_TIMEOUT_MS = 15000;

// ---- Global per-action rate limit (client side) ----
// Every mutation is counted per exact action (method + path + payload). After
// ACTION_CLICK_LIMIT completions, the same action waits ACTION_COOLDOWN_SECONDS.
// Two identical mutations already in flight share one request. This is the
// client half of the server's `actions` limiter: mashing a button (or a page
// that forgot button.disabled) cannot book/pay twice. The server still
// enforces the real limit; this only stops the extra request from leaving the
// browser. `cooldownMs: 0` opts a call out when a flow must repeat itself.
// ---- CUSTOMIZE THE BUTTON RATE LIMIT HERE ----
// How many identical clicks/requests are allowed before the cooldown starts.
const ACTION_CLICK_LIMIT = 5;
// How many seconds the action stays locked after that many clicks.
const ACTION_COOLDOWN_SECONDS = 5;
// -----------------------------------------------

const ACTION_COOLDOWN_MS =
  Math.max(0, Number(ACTION_COOLDOWN_SECONDS) || 0) * 1000;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ACTION_PRUNE_MS = 60 * 1000;
const inFlightActions = new Map();
const actionHits = new Map(); // key -> completion timestamps inside the window
const actionCooldowns = new Map(); // key -> explicit lockout from a server 429
let actionSweep = 0;

// Small non-cryptographic hash so the cooldown is per exact payload: clicking
// "+1" twice is the same action, while adding two different products is not.
function hashPayload(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function actionKey(method, path, body) {
  let payload = "";
  if (typeof body === "string") payload = body;
  else if (body != null && typeof body === "object") {
    try {
      payload = JSON.stringify(body);
    } catch {
      payload = String(body);
    }
  }
  return `${method} ${path} ${payload.length}:${hashPayload(payload)}`;
}

function cooldownError(remainingMs) {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const error = new Error(
    `Please wait ${seconds} second${seconds === 1 ? "" : "s"} before using this again.`
  );
  error.status = 429;
  error.retryAfterSeconds = seconds;
  error.cooldown = true;
  return error;
}

function pruneActionState(now) {
  if (now - actionSweep < ACTION_PRUNE_MS) return;
  actionSweep = now;
  for (const [key, hits] of actionHits) {
    const fresh = hits.filter((stamp) => now - stamp < ACTION_COOLDOWN_MS);
    if (fresh.length) actionHits.set(key, fresh);
    else actionHits.delete(key);
  }
  for (const [key, until] of actionCooldowns) {
    if (until <= now) actionCooldowns.delete(key);
  }
}

// Returns how long this action must still wait, or 0 when it may run now.
function actionWaitMs(key, now) {
  let wait = 0;
  const until = actionCooldowns.get(key) || 0;
  if (until > now) wait = until - now;
  if (ACTION_COOLDOWN_MS > 0) {
    const hits = actionHits.get(key) || [];
    // Clicks older than the cooldown no longer count toward the burst.
    while (hits.length && now - hits[0] >= ACTION_COOLDOWN_MS) hits.shift();
    const limit = Math.max(1, Math.floor(Number(ACTION_CLICK_LIMIT) || 1));
    if (hits.length >= limit) {
      // The cooldown starts after the LAST allowed click, not the first.
      const last = hits[hits.length - 1];
      wait = Math.max(wait, ACTION_COOLDOWN_MS - (now - last));
    }
  }
  return Math.max(0, wait);
}

function recordAction(key) {
  if (!key || ACTION_COOLDOWN_MS <= 0) return;
  const hits = actionHits.get(key) || [];
  hits.push(Date.now());
  actionHits.set(key, hits);
}

function startActionCooldown(key, ms) {
  if (!key || !Number.isFinite(ms) || ms <= 0) return;
  const until = Date.now() + ms;
  if (until > (actionCooldowns.get(key) || 0)) actionCooldowns.set(key, until);
}

async function performApiRequest(path, options = {}) {
  const {
    responseType = "json",
    timeoutMs = API_TIMEOUT_MS,
    ...fetchOptions
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(fetchOptions.headers || {}) },
      ...fetchOptions,
      signal: fetchOptions.signal || controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const error = new Error(data.error || `HTTP ${res.status}`);
      error.status = res.status;
      // Optimistic-concurrency conflict: the server includes the revision the
      // account moved to. Callers can show it or refresh their cached copy.
      if (Number.isInteger(data.currentVersion)) {
        error.currentVersion = data.currentVersion;
      }
      const retryAfter = Number(res.headers.get("Retry-After"));
      error.retryAfterSeconds =
        Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 0;
      const attemptsLimitHeader = res.headers.get("X-Auth-Attempts-Limit");
      const attemptsRemainingHeader = res.headers.get("X-Auth-Attempts-Remaining");
      const attemptsResetHeader = res.headers.get("X-Auth-Attempts-Reset");
      const attemptsLimit = Number(attemptsLimitHeader);
      const attemptsRemaining = Number(attemptsRemainingHeader);
      const attemptsReset = Number(attemptsResetHeader);
      if (Number.isInteger(attemptsLimit) && attemptsLimit > 0) {
        error.authAttemptsLimit = attemptsLimit;
      }
      if (
        attemptsRemainingHeader !== null &&
        Number.isInteger(attemptsRemaining) &&
        attemptsRemaining >= 0
      ) {
        error.authAttemptsRemaining = attemptsRemaining;
      }
      if (attemptsResetHeader !== null && Number.isFinite(attemptsReset) && attemptsReset > 0) {
        error.authAttemptsResetSeconds = Math.ceil(attemptsReset);
      }
      throw error;
    }
    // File responses (CSV export) ask for a blob; JSON stays the default.
    if (responseType === "blob") {
      return {
        blob: await res.blob(),
        filename: attachmentFilename(res.headers.get("Content-Disposition")),
      };
    }
    return await res.json().catch(() => ({}));
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error("The server took too long to respond. Please try again.");
    }
    // fetch() rejects with TypeError ("Failed to fetch") when the backend is
    // down, still starting, or blocked — say that in plain words instead of
    // showing the browser's message on login/register pages.
    if (e instanceof TypeError) {
      throw new Error(
        "Cannot reach the server. Make sure the backend is running on " +
        `${API_BASE_URL}, then try again.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function api(path, options = {}) {
  const { cooldownMs, ...requestOptions } = options;
  // `cooldownMs: 0` opts this one call out of the client-side guard.
  const skipCooldown = cooldownMs === 0;
  const method = String(requestOptions.method || "GET").toUpperCase();
  const isMutation = MUTATION_METHODS.has(method);
  const key = isMutation ? actionKey(method, path, requestOptions.body) : "";

  if (isMutation && !skipCooldown) {
    // A second click while the first request is still moving joins it instead
    // of sending a duplicate (both callers receive the same result).
    const pending = inFlightActions.get(key);
    if (pending) return pending;
    const now = Date.now();
    pruneActionState(now);
    const wait = actionWaitMs(key, now);
    if (wait > 0) throw cooldownError(wait);
  }

  const request = performApiRequest(path, requestOptions);
  if (!isMutation || skipCooldown) return request;

  inFlightActions.set(key, request);
  const clear = () => {
    if (inFlightActions.get(key) === request) inFlightActions.delete(key);
  };
  const finish = () => {
    recordAction(key);
    clear();
  };
  request.then(
    finish,
    (error) => {
      // A server-side 429 wins: respect its Retry-After for this action.
      if (error && error.status === 429 && error.retryAfterSeconds > 0) {
        startActionCooldown(key, error.retryAfterSeconds * 1000);
      }
      finish();
    }
  );
  return request;
}

// Pull a filename out of `Content-Disposition: attachment; filename="..."`.
// The server sends a quoted ASCII name; the UTF-8 form is handled too.
function attachmentFilename(header) {
  if (!header) return "";
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return "";
    }
  }
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match ? match[1].trim() : "";
}

async function getHealth() {
  const res = await fetch(`${API_BASE_URL}/api/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// --- Sprint by Carl: auth (JAM builds, PJ reuses) ---
// NOTE: valid ACTIVE accounts log straight in — login() returns the session.
// register() takes one object: token, firstName, lastName, username,
// email (must equal the invited email), password.
async function register(fields) {
  return api("/api/cashiers/register", {
    method: "POST",
    body: JSON.stringify(fields),
  });
}
// --- Cashier invitations (admin invites by email; holder registers) ---
async function checkInvite(token) {
  return api(`/api/invitations/${encodeURIComponent(token)}`);
}
async function createInvite(email) {
  return api("/api/admin/invitations", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}
async function listInvites() {
  return api("/api/admin/invitations");
}
async function revokeInvite(id) {
  return api(`/api/admin/invitations/${id}/revoke`, { method: "POST" });
}
async function login(email, password, recaptchaToken = "") {
  return api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password, recaptchaToken }),
  });
}
async function loginWithGoogle(idToken) {
  return api("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ idToken }),
  });
}
async function forgotPassword(email, recaptchaToken = "") {
  return api("/api/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email, recaptchaToken }),
  });
}
async function checkResetToken(token) {
  return api(`/api/reset-password/${encodeURIComponent(token)}`);
}
async function resetPassword(token, password, recaptchaToken = "") {
  return api("/api/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password, recaptchaToken }),
  });
}
async function getAppConfig() {
  return api("/api/config");
}
async function logout() {
  return api("/api/logout", { method: "POST" });
}
async function getMe() {
  const me = await api("/api/me");
  // Super-admin feature matrix: hide switched-off nav entries and leave a
  // switched-off page before it calls an API that will refuse it.
  if (!applyFeatureAccess(me)) return new Promise(() => {});
  return me;
}
// Self-service profile: display name and profile picture only (email stays
// read-only). Include the `version` from getMe() so a stale save is a 409.
async function updateMyProfile(payload) {
  const body = typeof payload === "string" ? { displayName: payload } : payload;
  return api("/api/me/profile", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// Landing page for a staff role. Every protected page sits one directory under
// src/function/, so this relative path works from admin/, cashiers/, tables/,
// auth/, and super-admin/ pages alike.
function staffHome(role) {
  if (role === "super_admin") return "../super-admin/integrations.html";
  if (role === "admin") return "../admin/admin-dashboard.html";
  if (role === "cashier") return "../cashiers/cashier-dashboard.html";
  return "../auth/login.html";
}

// --- Super admin feature matrix (RBAC) on the client ---
// Pages that belong to a switchable feature. `GET /api/me` returns the enabled
// keys; a disabled one is removed from the sidebar and its page is left for
// the role's dashboard. The server enforces the same matrix, so this is UX
// only — never the security boundary.
const FEATURE_PAGES = {
  "/admin/cashiers.html": "staff",
  "/tables/tables.html": "tables",
  "/tables/rates.html": "tables",
  "/tables/sessions.html": "sessions",
  "/admin/menu.html": "menu",
  "/admin/transactions.html": "transactions",
  "/admin/activity.html": "activity",
  "/cashiers/cashier-sessions.html": "sessions",
  "/cashiers/cashier-reservations.html": "reservations",
  "/cashiers/cashier-tables.html": "tables",
  "/cashiers/cashier-menu.html": "menu",
};

function featureForPathname(pathname) {
  const clean = String(pathname || "").replace(/\/+$/, "");
  for (const [suffix, key] of Object.entries(FEATURE_PAGES)) {
    if (clean.endsWith(suffix)) return key;
  }
  return "";
}

function applyFeatureAccess(me) {
  if (!me || !Array.isArray(me.features)) return true;
  const allowed = new Set(me.features);

  const here = featureForPathname(location.pathname);
  if (here && !allowed.has(here)) {
    location.replace(staffHome(me.role));
    return false;
  }

  let removed = false;
  document.querySelectorAll(".dash-nav a[href]").forEach((link) => {
    let feature = "";
    try {
      feature = featureForPathname(new URL(link.href, location.href).pathname);
    } catch {
      return;
    }
    if (feature && !allowed.has(feature)) {
      link.remove();
      removed = true;
    }
  });
  // The sliding nav pill measures link offsets; re-measure after removal.
  if (removed) window.dispatchEvent(new Event("resize"));
  return true;
}

// --- Admin settings (read-only: integration on/off state only) ---
async function getAdminIntegrations() {
  return api("/api/admin/settings/integrations");
}

// --- Super admin settings (activation + masked credentials) ---
async function getSuperAdminIntegrations() {
  return api("/api/super-admin/settings/integrations");
}
async function getSuperAdminAuthRateLimit() {
  return api("/api/super-admin/settings/login-protection");
}
async function updateSuperAdminAuthRateLimit(fields) {
  return api("/api/super-admin/settings/login-protection", {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}
async function updateSuperAdminIntegration(key, fields) {
  return api(`/api/super-admin/settings/integrations/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify(fields || {}),
  });
}
/** Clear every saved API key/override and fall back to server/.env defaults. */
async function resetSuperAdminIntegrations(code) {
  return api("/api/super-admin/settings/integrations/reset", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

// --- Super admin feature access (RBAC matrix) ---
async function getSuperAdminFeatureAccess() {
  return api("/api/super-admin/settings/feature-access");
}
async function updateSuperAdminFeatureAccess(features) {
  return api("/api/super-admin/settings/feature-access", {
    method: "PUT",
    body: JSON.stringify({ features: features || {} }),
  });
}

// --- Super admin authenticator app (TOTP) ---
async function getSuperAdminTwoFactor() {
  return api("/api/super-admin/2fa");
}
async function setupSuperAdminTwoFactor(code = "", label = "") {
  return api("/api/super-admin/2fa/setup", {
    method: "POST",
    body: JSON.stringify({ code, label }),
  });
}
async function enableSuperAdminTwoFactor(code) {
  return api("/api/super-admin/2fa/enable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}
async function removeSuperAdminTwoFactorDevice(id, code) {
  return api(`/api/super-admin/2fa/devices/${encodeURIComponent(id)}/remove`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}
async function disableSuperAdminTwoFactor(code) {
  return api("/api/super-admin/2fa/disable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

// --- Cashier management (lists/updates/archives; invite IS the approval) ---
async function listCashiers(status = "all", role = "cashier") {
  return api(`/api/admin/cashiers?status=${encodeURIComponent(status)}&role=${encodeURIComponent(role)}`);
}
async function archiveCashier(id) {
  return api(`/api/admin/cashiers/${id}/archive`, { method: "POST" });
}
async function updateCashier(id, fields) {
  return api(`/api/admin/cashiers/${id}`, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}
async function unarchiveCashier(id) {
  return api(`/api/admin/cashiers/${id}/unarchive`, { method: "POST" });
}

// --- Admin activity log (AD-026): sign-ins, cashier/session/payment actions ---
async function listActivityLogs({ actorId = "", action = "", from = "", to = "", limit = 200 } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (actorId) q.set("actorId", actorId);
  if (action) q.set("action", action);
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return api(`/api/admin/activity-logs?${q.toString()}`);
}

// --- Personal activity log (all roles: cashier, super-admin, admin) ---
async function listMyActivityLogs({ action = "", from = "", to = "", limit = 200 } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (action) q.set("action", action);
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return api(`/api/me/activity-logs?${q.toString()}`);
}

// --- Sprint 02: tables (AD-008..AD-013) + rates (AD-016/017) + sessions view (AD-014) ---
async function listTables(status = "all") {
  return api(`/api/admin/tables?status=${encodeURIComponent(status)}`);
}
async function addTable(name) {
  return api("/api/admin/tables", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}
async function renameTable(id, name) {
  return api(`/api/admin/tables/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}
async function setTableStatus(id, status) {
  return api(`/api/admin/tables/${id}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}
async function archiveTable(id) {
  return api(`/api/admin/tables/${id}/archive`, { method: "POST" });
}
async function unarchiveTable(id) {
  return api(`/api/admin/tables/${id}/unarchive`, { method: "POST" });
}
  async function getRates() {
  return api("/api/admin/rates");
}
async function setRate(type, pricePerHour) {
  return api("/api/admin/rates", {
    method: "PUT",
    body: JSON.stringify({ type, pricePerHour }),
  });
}
// Session lifecycle (CA-004..CA-014): cashier operates, admin watches (server/src/routes/session.routes.js).
async function listSessions(status = "active") {
  return api(`/api/admin/sessions?status=${encodeURIComponent(status)}`);
}
// --- Session lifecycle (CA-004..CA-014): cashier operates, admin watches ---
async function listCashierSessions(status = "active") {
  return api(`/api/cashier/sessions?status=${encodeURIComponent(status)}`);
}
async function startSession(tableId, customerName, durationMinutes) {
  return api("/api/cashier/sessions", {
    method: "POST",
    body: JSON.stringify({ tableId, customerName, durationMinutes }),
  });
}
async function extendSession(id, extraMinutes) {
  return api(`/api/cashier/sessions/${id}/extend`, {
    method: "POST",
    body: JSON.stringify({ extraMinutes }),
  });
}
async function endSession(id) {
  return api(`/api/cashier/sessions/${id}/end`, { method: "POST" });
}
async function cancelSession(id) {
  return api(`/api/cashier/sessions/${id}/cancel`, { method: "POST" });
}
// Table reads for cashier + public pages (server/src/routes/tables.routes.js).
async function listCashierTables(status = "all") {
  return api(`/api/cashier/tables?status=${encodeURIComponent(status)}`);
}
async function listPublicTables() {
  return api('/api/tables/availability');
}
// --- Sprint 5: F&B catalogue (AD-031/032/033, CA-026) ---
async function listProducts({ status = "active", category = "", q = "" } = {}) {
  const query = new URLSearchParams({ status });
  if (category) query.set("category", category);
  if (q) query.set("q", q);
  return api(`/api/admin/products?${query.toString()}`);
}
async function createProduct(fields) {
  return api("/api/admin/products", {
    method: "POST",
    body: JSON.stringify(fields),
  });
}
async function updateProduct(id, fields) {
  return api(`/api/admin/products/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}
async function archiveProduct(id) {
  return api(`/api/admin/products/${encodeURIComponent(id)}/archive`, {
    method: "POST",
  });
}
async function unarchiveProduct(id) {
  return api(`/api/admin/products/${encodeURIComponent(id)}/unarchive`, {
    method: "POST",
  });
}
async function listMenuProducts({ category = "", q = "" } = {}) {
  const query = new URLSearchParams();
  if (category) query.set("category", category);
  if (q) query.set("q", q);
  const qs = query.toString() ? `?${query.toString()}` : "";
  return api(`/api/cashier/products${qs}`);
}
// --- Sprint 5: session bill + F&B order lines (CA-020/027/028) ---
async function getBill(sessionId) {
  return api(`/api/cashier/sessions/${encodeURIComponent(sessionId)}/bill`);
}
async function addOrderLine(sessionId, productId, qty) {
  return api(`/api/cashier/sessions/${encodeURIComponent(sessionId)}/orders`, {
    method: "POST",
    body: JSON.stringify({ productId, qty }),
  });
}
async function updateOrderLine(sessionId, lineId, qty) {
  return api(
    `/api/cashier/sessions/${encodeURIComponent(sessionId)}/orders/${encodeURIComponent(lineId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ qty }),
    }
  );
}
async function removeOrderLine(sessionId, lineId) {
  return api(
    `/api/cashier/sessions/${encodeURIComponent(sessionId)}/orders/${encodeURIComponent(lineId)}`,
    { method: "DELETE" }
  );
}
// --- Sprint 3: billing close-out (CA-020/022/023/024) + lists (AD-020) + reports (AD-019/021) ---
async function createTransaction(sessionId, method, received) {
  return api("/api/cashier/transactions", {
    method: "POST",
    body: JSON.stringify({ sessionId, method, received }),
  });
}
async function listTransactions(params = {}, admin = true) {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.month) q.set("month", params.month);
  if (params.method) q.set("method", params.method);
  const qs = q.toString() ? `?${q.toString()}` : "";
  const base = admin ? "/api/admin/transactions" : "/api/cashier/transactions";
  return api(`${base}${qs}`);
}
async function getTransaction(ref, admin = true) {
  const base = admin ? "/api/admin/transactions" : "/api/cashier/transactions";
  return api(`${base}/${encodeURIComponent(ref)}`);
}
async function getDailyReport(date) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return api(`/api/admin/reports/daily${qs}`);
}
async function getMonthlyReport(month) {
  const qs = month ? `?month=${encodeURIComponent(month)}` : "";
  return api(`/api/admin/reports/monthly${qs}`);
}
// Income totals for any inclusive from/to range (YYYY-MM-DD).
async function getIncomeReport(from, to) {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const qs = q.toString() ? `?${q.toString()}` : "";
  return api(`/api/admin/reports/income${qs}`);
}
// Export is fetched as a blob (not navigated to via anchor) so the dashboard
// can show a JSON error as a toast — the export budget returns 429 once the
// per-admin limit is spent. The CSV can take longer than a normal API call.
function exportReportPath({ from = "", to = "", month = "", method = "all" } = {}) {
  const q = new URLSearchParams({ format: "csv" });
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  if (month) q.set("month", month);
  if (method && method !== "all") q.set("method", method);
  return `/api/admin/reports/export?${q.toString()}`;
}
async function downloadReportExport(params = {}) {
  return api(exportReportPath(params), {
    responseType: "blob",
    timeoutMs: 60000,
  });
}

// --- Customer reservations (CU-004..CU-014, guest, no login) ---
async function listPublicRates() {
  return api("/api/rates");
}
async function createReservation(fields) {
  return api("/api/reservations", {
    method: "POST",
    body: JSON.stringify(fields),
  });
}
async function getReservation(ref, contact) {
  const q = new URLSearchParams({ contact });
  return api(`/api/reservations/${encodeURIComponent(ref)}?${q.toString()}`);
}
async function cancelReservation(ref, contact) {
  return api(`/api/reservations/${encodeURIComponent(ref)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ contactNumber: contact }),
  });
}
async function listCashierReservations() {
  return api("/api/reservations");
}
// Cashier decisions on a pending reservation request (session required).
async function acceptReservation(ref) {
  return api(`/api/cashier/reservations/${encodeURIComponent(ref)}/accept`, { method: "POST" });
}
async function rejectReservation(ref) {
  return api(`/api/cashier/reservations/${encodeURIComponent(ref)}/reject`, { method: "POST" });
}
// Check in an accepted reservation: starts a session, marks the table occupied.
async function checkInReservation(ref) {
  return api(`/api/cashier/reservations/${encodeURIComponent(ref)}/check-in`, { method: "POST" });
}
