// src/function/cashiers/cashier-common.js - shared cashier shell helpers.
// Pages: cashier-dashboard.html (start), cashier-sessions.html (lifecycle +
// billing), cashier-tables.html (read-only). Pair: js/dash.js (shell) +
// js/api.js (endpoints). Guard + identity + timers live here so the three
// pages stay 1:1 with their HTML without duplicating auth logic.

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
  const over = ms < 0;
  const a = Math.abs(ms);
  const h = Math.floor(a / 3600000);
  const m = Math.floor((a % 3600000) / 60000);
  const s = Math.floor((a % 60000) / 1000);
  const body = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
  return (over ? "+" : "") + body + (over ? " over" : "");
}

/** Recompute every countdown cell from its session endTime (called each second). */
function tickTimers() {
  const now = Date.now();
  document.querySelectorAll("[data-end]").forEach((el) => {
    const ms = new Date(el.getAttribute("data-end")).getTime() - now;
    el.textContent = fmtLeft(ms);
    el.classList.toggle("over", ms < 0);
    el.classList.toggle("warn", ms >= 0 && ms < 10 * 60000);
  });
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
  return Math.round((secs / 3600) * Number(s.pricePerHour || 120) * 100) / 100;
}
