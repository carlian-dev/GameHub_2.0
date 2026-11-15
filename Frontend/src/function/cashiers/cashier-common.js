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
    location.href = staffHome(me.role);
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

/** Create a standalone remaining time progress bar (no numbers/percentage, just the bar). */
function createSessionBar(startTime, endTime, plannedMinutes = 60) {
  const track = document.createElement("div");
  track.className = "session-bar-track";
  track.setAttribute("aria-hidden", "true");

  const fill = document.createElement("div");
  fill.className = "session-bar-fill bar-green";
  if (startTime) fill.setAttribute("data-bar-start", startTime);
  if (endTime) fill.setAttribute("data-bar-end", endTime);
  if (plannedMinutes) fill.setAttribute("data-bar-planned", String(plannedMinutes));
  fill.style.width = "100%";

  track.appendChild(fill);
  return track;
}

/** Register the page's refresh function; called when a countdown hits 0:00. */
function setSessionExpiryHandler(fn) {
  sessionExpiryHandler = typeof fn === "function" ? fn : null;
}

/** Recompute every countdown cell and progress bar from session endTime (called each second). */
function tickTimers() {
  const now = Date.now();
  let hitZero = false;

  // 1. Text countdown timers
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

  // 2. Standalone visual progress bars (green -> yellow -> red as time is almost done)
  document.querySelectorAll("[data-bar-end]").forEach((barFill) => {
    const endRaw = barFill.getAttribute("data-bar-end");
    if (!endRaw) return;
    const end = new Date(endRaw).getTime();
    if (isNaN(end)) return;

    const startRaw = barFill.getAttribute("data-bar-start");
    let totalMs = 0;
    if (startRaw) {
      const start = new Date(startRaw).getTime();
      if (!isNaN(start) && end > start) {
        totalMs = end - start;
      }
    }
    if (!totalMs) {
      const planned = Number(barFill.getAttribute("data-bar-planned"));
      totalMs = (Number.isFinite(planned) && planned > 0 ? planned : 60) * 60000;
    }

    const remainingMs = Math.max(0, end - now);
    const ratio = Math.max(0, Math.min(1, remainingMs / totalMs));
    const pct = Math.round(ratio * 100);

    let tone = "bar-green";
    let color = "#10B981";

    if (remainingMs <= 5 * 60000 || ratio <= 0.20) {
      tone = "bar-red";
      color = "#EF4444";
    } else if (remainingMs <= 15 * 60000 || ratio <= 0.50) {
      tone = "bar-yellow";
      color = "#F59E0B";
    }

    barFill.style.width = `${pct}%`;
    barFill.style.backgroundColor = color;
    barFill.className = `session-bar-fill ${tone}`;

    const track = barFill.parentElement;
    if (track) {
      track.title = `${fmtLeft(remainingMs)} remaining (${pct}%)`;
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
