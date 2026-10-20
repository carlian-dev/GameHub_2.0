// src/function/tables/sessions.js - admin sessions watch logic. Pair: sessions.html
// <-> Backend/src/function/tables/sessions.php (enriched list, AD-014/AD-027).
// Shows which cashier operates each session plus a per-second live timer
// (remaining = endTime - now; overtime in red). Tabs: active/closed/all.
// Guard: admin-only. Data refetches every 30s; timers tick locally each second.
let sessTab = "active";
let sessRows = [];

function fmtClock(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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

function tickTimers() {
  const now = Date.now();
  document.querySelectorAll("#tbl [data-end]").forEach((el) => {
    const raw = el.getAttribute("data-end");
    if (!raw) { el.textContent = "—"; return; }
    const ms = new Date(raw).getTime() - now;
    const tr = el.closest("tr");
    const isActive = tr && tr.dataset.status === "active";
    el.textContent = isActive ? fmtLeft(ms) : "—";
    el.classList.toggle("over", isActive && ms < 0);
    el.classList.toggle("warn", isActive && ms >= 0 && ms < 10 * 60000);
  });
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
      '<td><span class="timer">…</span></td>' +
      "<td></td>";
    tr.children[0].textContent = s.tableName || s.tableId || "—";
    tr.children[1].textContent = s.customerName || "—";
    tr.children[2].textContent = s.cashierName || "—";
    tr.children[3].textContent = fmtClock(s.startTime);
    tr.children[4].textContent = s.endTime ? fmtClock(s.endTime) : "—";
    const timer = tr.children[5].querySelector(".timer");
    timer.setAttribute("data-end", s.endTime || "");
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
    msg.textContent = `${n} session(s) shown (${sessTab}). Auto-refresh 30s.`;
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
    if (me.role !== "admin") { location.href = "../auth/login.html"; return; }
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
