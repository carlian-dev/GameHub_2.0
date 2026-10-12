// GameHub_2.0 API wrapper - how Frontend talks to Backend.
// Purpose in plain words: Frontend is FORBIDDEN from talking to MongoDB directly
// (password would leak). It may only ask the PHP Backend. This file holds those
// fetch() calls in one place. Example: getHealth() asks "GET http://localhost:8000/api/health"
// and returns {ok:true, db:"gamehub_2_0", ...}. To add login later, add getUsers(), login(), etc. here.
// Purpose: fetch wrapper. Frontend never talks to MongoDB directly, only to PHP Backend.
// NOTE: credentials:"include" sends the PHP session cookie, without it login
// would succeed but the next request would look like a stranger (401).
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
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
async function login(email, password) {
  return api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}
async function loginWithGoogle(idToken) {
  return api("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ idToken }),
  });
}
async function getAppConfig() {
  return api("/api/config");
}
async function logout() {
  return api("/api/logout", { method: "POST" });
}
async function getMe() {
  return api("/api/me");
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
// C owns: listSessions()/listCashierSessions()/start/extend/end/cancelSession() — re-added with sessions.php
async function listSessions(status = "active") {
  return api(/api/admin/sessions?status=${encodeURIComponent(status)});
}
// --- Session lifecycle (CA-004..CA-014): cashier operates, admin watches ---
async function listCashierSessions(status = "active") {
  return api(/api/cashier/sessions?status=${encodeURIComponent(status)});
}
async function startSession(tableId, customerName, durationMinutes) {
  return api("/api/cashier/sessions", {
    method: "POST",
    body: JSON.stringify({ tableId, customerName, durationMinutes }),
  });
}
async function extendSession(id, extraMinutes) {
  return api(/api/cashier/sessions/${id}/extend, {
    method: "POST",
    body: JSON.stringify({ extraMinutes }),
  });
}
async function endSession(id) {
  return api(/api/cashier/sessions/${id}/end, { method: "POST" });
}
async function cancelSession(id) {
  return api(/api/cashier/sessions/${id}/cancel, { method: "POST" });
}
// D owns: listCashierTables()/listPublicTables() — re-added with cashiers/tables.php
