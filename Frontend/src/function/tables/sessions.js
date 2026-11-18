// src/function/tables/sessions.js - admin sessions watch logic. Pair: sessions.html
// <-> server/src/routes/session.routes.js (enriched list, AD-014/AD-027).
// Shows which cashier operates each session plus a per-second live timer
// (remaining = endTime - now; stops at 0:00, when the server auto-ends it).
// Tabs: active/closed/all. Guard: admin-only. Data refetches every 30s;
// timers tick locally each second.
let sessTab = "active";
let sessRows = [];
let sessExpiryReloadAt = 0;

function fmtClock(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtLeft(ms) {
  const a = Math.max(0, ms);
  const h = Math.floor(a / 3600000);
  const m = Math.floor((a % 3600000) / 60000);
  const s = Math.floor((a % 60000) / 1000);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

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

function tickTimers() {
  const now = Date.now();
  let hitZero = false;

  // 1. Text countdown timers
  document.querySelectorAll("#tbl [data-end]").forEach((el) => {
    const raw = el.getAttribute("data-end");
    if (!raw) { el.textContent = "—"; return; }
    const end = new Date(raw).getTime();
    if (isNaN(end)) return;
    const ms = end - now;
    const tr = el.closest("tr");
    const isActive = tr && tr.dataset.status === "active";
    el.textContent = isActive ? fmtLeft(ms) : "—";
    el.classList.toggle("warn", isActive && ms > 0 && ms < 10 * 60000);
    el.classList.remove("over");
    if (isActive && ms <= 0) hitZero = true;
  });

  // 2. Standalone visual progress bars (green -> yellow -> red as time is almost done)
  document.querySelectorAll("#tbl [data-bar-end]").forEach((barFill) => {
    const tr = barFill.closest("tr");
    const isActive = tr && tr.dataset.status === "active";
    if (!isActive) {
      barFill.parentElement.style.display = "none";
      return;
    }

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

  // The row should disappear as soon as the server closes the session.
  if (hitZero && Date.now() - sessExpiryReloadAt > 10000) {
    sessExpiryReloadAt = Date.now();
    loadSessions();
  }
}

function paintSessions(list) {
  const tb = document.querySelector("#tbl tbody");
  tb.innerHTML = "";
  for (const s of list) {
    const tr = document.createElement("tr");
    tr.dataset.status = s.status || "";
    const badgeCls = s.status === "active" ? "occupied" : s.status === "closed" ? "available" : "archived";
    tr.innerHTML =
      "<td></td><td></td><td></td><td></td><td></td>" +
      "<td></td>" +
      "<td></td>";

    const tblWrap = document.createElement("div");
    tblWrap.className = "session-table-cell";
    const tblName = document.createElement("strong");
    tblName.className = "session-table-name";
    tblName.textContent = s.tableName || s.tableId || "—";
    tblWrap.appendChild(tblName);
    if (s.status === "active" && s.endTime) {
      tblWrap.appendChild(createSessionBar(s.startTime, s.endTime, s.plannedMinutes));
    }
    tr.children[0].appendChild(tblWrap);

    tr.children[1].textContent = s.customerName || "—";
    tr.children[2].textContent = s.cashierName || "—";
    tr.children[3].textContent = fmtClock(s.startTime);
    tr.children[4].textContent = s.endTime ? fmtClock(s.endTime) : "—";

    const timer = document.createElement("span");
    timer.className = "timer";
    if (s.status === "active" && s.endTime) {
      timer.setAttribute("data-end", s.endTime);
      timer.textContent = "…";
    } else {
      timer.textContent = "—";
    }
    tr.children[5].appendChild(timer);

    const badge = document.createElement("span");
    badge.className = `badge ${badgeCls}`;
    badge.textContent = s.status || "—";
    tr.children[6].appendChild(badge);
    tb.appendChild(tr);
  }
  tickTimers();
  return list.length;
}

async function loadSessions() {
  const msg = document.getElementById("msg");
  msg.textContent = "Loading…";
  msg.className = "dash-msg loading";
  dashSkeleton(document.querySelector("#tbl tbody"), 7, 5);
  dashStamp(document.getElementById("stamp"));
  try {
    const { sessions } = await listSessions(sessTab);
    sessRows = sessions;
    const n = paintSessions(sessions);
    msg.textContent = `Showing ${n} ${sessTab} ${n === 1 ? "session" : "sessions"} · auto-refresh 30s.`;
    msg.className = "dash-msg ok";
    document.getElementById("empty").hidden = n > 0;
  } catch (e) {
    msg.textContent = e.message;
    msg.className = "dash-msg err";
    document.getElementById("empty").hidden = false;
    document.getElementById("empty").textContent = "Couldn't load sessions — refresh to retry.";
  }
}

// Accessible tab strip: click + arrow keys, aria-selected, tabpanel labelledby.
dashTabsInit((t) => { sessTab = t; loadSessions(); });

(async () => {
  const msg = document.getElementById("msg");
  try {
    const me = await getMe();
    if (me.role !== "admin") { location.href = staffHome(me.role); return; }
    const name = me.email || "admin";
    document.getElementById("who").textContent = name;
    document.getElementById("avatar").textContent = name.charAt(0).toUpperCase();
    await loadSessions();
    setInterval(tickTimers, 1000);
    setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (document.querySelector(".dash-modal.open")) return;
      loadSessions();
    }, 30000);
  } catch (e) {
    if (String(e.message || "").includes("401")) location.href = "../auth/login.html";
    else msg.textContent = e.message;
  }
})();
