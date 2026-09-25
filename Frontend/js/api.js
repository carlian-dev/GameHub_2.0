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
async function register(email, password) {
  return api("/api/cashiers/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}
async function login(email, password) {
  return api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}
async function logout() {
  return api("/api/logout", { method: "POST" });
}
async function getMe() {
  return api("/api/me");
}

// --- Sprint by Carl: cashier management (PJ lists/approves, JAZ updates/archives) ---
async function listCashiers(status = "all") {
  return api(`/api/admin/cashiers?status=${encodeURIComponent(status)}`);
}
async function approveCashier(id) {
  return api(`/api/admin/cashiers/${id}/approve`, { method: "POST" });
}
async function updateCashier(id, fields) {
  return api(`/api/admin/cashiers/${id}`, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}
async function archiveCashier(id) {
  return api(`/api/admin/cashiers/${id}/archive`, { method: "POST" });
}
