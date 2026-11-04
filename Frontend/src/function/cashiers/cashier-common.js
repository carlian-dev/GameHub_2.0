// src/function/cashiers/cashier-common.js - shared cashier shell helpers.
// Pages: cashier-dashboard.html (start), cashier-sessions.html (lifecycle +
// billing), cashier-reservations.html (accept/reject requests),
// cashier-tables.html (read-only). Pair: js/dash.js (shell) + js/api.js
// (endpoints). Guard + identity + timers live here so the pages stay 1:1 with
// their HTML without duplicating auth logic.

/** Cashier-only guard. Sets #who/#avatar, binds #out. Returns `me` or redirects. */
async function cashierGuard() {
  const me = await getMe();
  if (me.role !== "cashier") {
    location.href = me.role === "admin" ? "../admin/admin-dashboard.html" : "../auth/login.html";
    throw new Error("redirect");
  }
  const name = me.email || me.username || "cashier";
  const who = document.getElementById("who");
  if (who) who.textContent = name;
  const avatar = document.getElementById("avatar");
  if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
  return me;
}

function bindCashierLogout() {
  document.getElementById("out")?.addEventListener("click", async () => {
    try { await logout(); } catch { /* still leave */ }
    location.href = "../auth/login.html";
  });
}

// ---- Live timer helpers (single source of truth: session.endTime) ----
function fmtClock(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtLeft(ms) {
  // Time never counts below zero: the session ends at 0:00, and the server
  // closes it (the page refreshes to drop the row).
  const a = Math.max(0, ms);
  const h = Math.floor(a / 3600000);
  const m = Math.floor((a % 3600000) / 60000);
  const s = Math.floor((a % 60000) / 1000);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

let sessionExpiryHandler = null;
let sessionExpiryTimer = null;
const sessionExpirySeen = new WeakSet();

/** Register the page's refresh function; called when a countdown hits 0:00. */
function setSessionExpiryHandler(fn) {
  sessionExpiryHandler = typeof fn === "function" ? fn : null;
}

/** Recompute every countdown cell from its session endTime (called each second). */
function tickTimers() {
  const now = Date.now();
  let hitZero = false;
  document.querySelectorAll("[data-end]").forEach((el) => {
    const raw = el.getAttribute("data-end");
    if (!raw) return;
    const end = new Date(raw).getTime();
    if (isNaN(end)) return;
    const ms = end - now;
    el.textContent = fmtLeft(ms);
    el.classList.toggle("warn", ms > 0 && ms < 10 * 60000);
    el.classList.remove("over");
    if (ms <= 0 && !sessionExpirySeen.has(el)) {
      sessionExpirySeen.add(el);
      hitZero = true;
    }
  });
  if (
    hitZero &&
    typeof sessionExpiryHandler === "function" &&
    sessionExpiryTimer === null
  ) {
    // Let the server's 0:00 sweep run before asking for fresh truth.
    sessionExpiryTimer = setTimeout(() => {
      sessionExpiryTimer = null;
      try {
        sessionExpiryHandler();
      } catch {
        /* the page reports its own load errors */
      }
    }, 1200);
  }
}

let cashierTickStarted = false;
/** Per-second local tick (no refetch). Safe to call from every cashier page. */
function ensureCashierTick() {
  if (cashierTickStarted) return;
  cashierTickStarted = true;
  setInterval(tickTimers, 1000);
}

/** 30s server convergence while visible and no dialog is open. */
function startCashierPolling(fn) {
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (document.querySelector(".dash-modal.open")) return;
    fn(true);
  }, 30000);
}

function peso2(n) { return `₱${Number(n || 0).toFixed(2)}`; }

function estimateTotal(s) {
  const start = s.startTime ? new Date(s.startTime).getTime() : NaN;
  const end = s.closedAt ? new Date(s.closedAt).getTime() : Date.now();
  if (isNaN(start)) return 0;
  const secs = Math.max(0, (end - start) / 1000);
  const hours = Math.max(1, Math.ceil(secs / 3600));
  return Math.round(hours * Number(s.pricePerHour || 140) * 100) / 100;
}

function estimateHours(s) {
  const start = s.startTime ? new Date(s.startTime).getTime() : NaN;
  const end = s.closedAt ? new Date(s.closedAt).getTime() : Date.now();
  if (isNaN(start)) return 1;
  const secs = Math.max(0, (end - start) / 1000);
  return Math.max(1, Math.ceil(secs / 3600));
}
