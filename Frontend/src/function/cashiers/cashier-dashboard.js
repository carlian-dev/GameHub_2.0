// src/function/cashiers/cashier-dashboard.js - cashier home logic. Pair: cashier-dashboard.html.
// Guard: logged-in cashiers stay (admins go to their dashboard, guests to
// login). Owns the session lifecycle (CA-004..CA-014): start form (table +
// customer + planned duration, e.g. customer says "2 hrs" -> 120 min), active
// sessions with per-second countdown timers, extend (+minutes pushes the
// planned end), end (bills per-minute), void (cancel mistakes). Tables stay
// read-only (CA-003/CA-017). Shell (menu/theme/date) lives in js/dash.js.
//
// Refresh: data converges with server truth every 30s while visible and no
// dialog is open; countdown cells tick locally every second (no refetch).
let cashierTab = "all";
let cashierRows = [];
let activeSessions = [];

function setTablesMsg(t) { document.getElementById("tablesMsg").textContent = t; }
function setSessMsg(t) { document.getElementById("sessMsg").textContent = t; }
function setStartMsg(t, kind = "") {
  const el = document.getElementById("startMsg");
  el.textContent = t;
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("err", kind === "err");
}

/** Live summary under the duration stepper: "2h 0m · ends ~4:30 PM". */
function updateStartSummary() {
  const box = document.getElementById("startSummary");
  if (!box) return;
  const hrs = Number(document.getElementById("startHours").value || 0);
  const mins = Number(document.getElementById("startMins").value || 0);
  const total = hrs * 60 + mins;
  document.querySelectorAll(".chip[data-quick]").forEach((c) =>
    c.classList.toggle("on", Number(c.dataset.quick) === total));
  if (!(total >= 5 && total <= 1440)) {
    box.textContent = "Pick 5 min – 24 h (e.g. 2 hrs = 120 min).";
    return;
  }
  const ends = new Date(Date.now() + total * 60000)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const bits = [];
  if (hrs > 0) bits.push(`${hrs}h`);
  if (mins > 0) bits.push(`${mins}m`);
  box.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = bits.join(" ") || "0m";
  box.appendChild(strong);
  box.append(` · ends ~${ends}`);
}

function stampTables() {
  document.getElementById("tablesUpdated").textContent =
    `Updated ${new Date().toLocaleTimeString()} · auto-refresh 30s`;
}

// ---- Timer helpers (single source of truth: session.endTime from the server) ----
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

// ---- Tables (read-only) ----
function paintCashierTables(list) {
  const tb = document.querySelector("#cashierTbl tbody");
  tb.innerHTML = "";
  for (const t of list) {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.textContent = t.name;
    const statusTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge ${t.status}`;
    badge.textContent = t.status;
    statusTd.appendChild(badge);
    tr.appendChild(nameTd);
    tr.appendChild(statusTd);
    tb.appendChild(tr);
  }
  return list.length;
}

async function loadCashierTables(quiet = false) {
  if (!quiet) setTablesMsg("Loading...");
  try {
    const { tables } = await listCashierTables(cashierTab);
    cashierRows = tables;
    setTablesMsg(`${paintCashierTables(tables)} shown (${cashierTab}).`);
    stampTables();
    fillStartTables(tables.filter((t) => t.status === "available"));
  } catch (e) {
    setTablesMsg(e.message);
  }
}

/** Start-card table dropdown lists available tables only + availability pill. */
function fillStartTables(available) {
  const sel = document.getElementById("startTable");
  const keep = sel.value;
  sel.innerHTML = "";
  const pill = document.getElementById("availCount");
  const btn = document.getElementById("startBtn");
  if (available.length === 0) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "No available tables";
    sel.appendChild(o);
    if (pill) { pill.textContent = "none available"; pill.classList.add("empty"); }
    if (btn) btn.disabled = true;
    return;
  }
  for (const t of available) {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = t.name;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  if (pill) {
    pill.textContent = `${available.length} available`;
    pill.classList.toggle("empty", false);
  }
  if (btn) btn.disabled = false;
  updateStartSummary();
}

// ---- Sessions ----
function paintSessions(list) {
  const tb = document.querySelector("#sessTbl tbody");
  tb.innerHTML = "";
  for (const s of list) {
    const tr = document.createElement("tr");
    const timer = document.createElement("span");
    timer.className = "timer";
    timer.setAttribute("data-end", s.endTime || "");
    timer.textContent = s.endTime ? "…" : "—";
    tr.innerHTML = `<td></td><td></td><td></td><td></td><td></td><td></td>`;
    tr.children[0].textContent = s.tableName || "—";
    tr.children[1].textContent = s.customerName || "—";
    tr.children[2].textContent = fmtClock(s.startTime);
    tr.children[3].textContent = fmtClock(s.endTime);
    tr.children[4].appendChild(timer);
    const act = tr.children[5];

    const ex = document.createElement("button");
    ex.textContent = "Extend";
    ex.className = "rowbtn";
    ex.onclick = async () => {
      const pick = await dashSelect({
        message: `Extend ${s.tableName || "session"} for the customer. Adds to the planned end.`,
        label: "Extra time",
        options: [
          { value: "30", label: "+30 min" },
          { value: "60", label: "+1 hour" },
          { value: "120", label: "+2 hours" },
          { value: "180", label: "+3 hours" },
        ],
        value: "60",
        title: "Extend session",
      });
      if (pick === null) return;
      try {
        await extendSession(s.id, Number(pick));
        loadSessions(true);
      } catch (e) { setSessMsg(e.message); }
    };
    const end = document.createElement("button");
    end.textContent = "End";
    end.className = "rowbtn go";
    end.onclick = async () => {
      const yes = await dashConfirm(
        `End session on ${s.tableName || "this table"} (${s.customerName || "customer"})? The table becomes available and the charge is computed.`,
        "End session"
      );
      if (!yes) return;
      try {
        const r = await endSession(s.id);
        setSessMsg(r.amount !== undefined ? `Session ended. Charge ₱${Number(r.amount).toFixed(2)}.` : "Session ended.");
        loadSessions(true);
        loadCashierTables(true);
      } catch (e) { setSessMsg(e.message); }
    };
    const vd = document.createElement("button");
    vd.textContent = "Void";
    vd.className = "rowbtn danger";
    vd.title = "Void a mistakenly started session";
    vd.onclick = async () => {
      const yes = await dashConfirm(
        `Void this session on ${s.tableName || "this table"}? Use only for mistakes — it frees the table without billing.`,
        "Void session"
      );
      if (!yes) return;
      try {
        await cancelSession(s.id);
        loadSessions(true);
        loadCashierTables(true);
      } catch (e) { setSessMsg(e.message); }
    };
    act.append(ex, end, vd);
    tb.appendChild(tr);
  }
  tickTimers();
  document.getElementById("sessEmpty").hidden = list.length > 0;
  return list.length;
}

async function loadSessions(quiet = false) {
  if (!quiet) setSessMsg("Loading...");
  try {
    const { sessions } = await listCashierSessions("active");
    activeSessions = sessions;
    setSessMsg(`${paintSessions(sessions)} active session(s).`);
  } catch (e) {
    setSessMsg(e.message);
  }
}

async function refreshAll(quiet = true) {
  await Promise.all([loadSessions(quiet), loadCashierTables(quiet)]);
}

document.querySelectorAll("[data-t]").forEach((b) =>
  b.addEventListener("click", () => {
    cashierTab = b.dataset.t;
    document.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x === b));
    loadCashierTables();
  }));

document.querySelectorAll("[data-quick]").forEach((b) =>
  b.addEventListener("click", () => {
    const mins = Number(b.dataset.quick);
    document.getElementById("startHours").value = Math.floor(mins / 60);
    document.getElementById("startMins").value = mins % 60;
    document.querySelectorAll(".chip[data-quick]").forEach((c) => c.classList.toggle("on", c === b));
    updateStartSummary();
  }));

// Duration steppers (− / +) + live summary on manual edits.
document.querySelectorAll(".step-btn[data-target]").forEach((b) =>
  b.addEventListener("click", () => {
    const input = document.getElementById(b.dataset.target);
    if (!input) return;
    const delta = Number(b.dataset.delta || 0);
    const max = b.dataset.target === "startHours" ? 24 : 59;
    const next = Math.min(max, Math.max(0, Number(input.value || 0) + delta));
    input.value = next;
    updateStartSummary();
  }));
["startHours", "startMins"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateStartSummary));

document.getElementById("startBtn").addEventListener("click", async () => {
  const btn = document.getElementById("startBtn");
  const tableId = document.getElementById("startTable").value;
  const customer = document.getElementById("startCustomer").value.trim();
  const hrs = Number(document.getElementById("startHours").value || 0);
  const mins = Number(document.getElementById("startMins").value || 0);
  const total = hrs * 60 + mins;
  if (!tableId) { setStartMsg("No available table to start on.", "err"); return; }
  if (customer === "") { setStartMsg("Customer name is required.", "err"); return; }
  if (!(total >= 5 && total <= 1440)) { setStartMsg("Duration must be 5 min – 24 h (e.g. 2 hrs = 120 min).", "err"); return; }
  setStartMsg("Starting…");
  btn.disabled = true;
  try {
    await startSession(tableId, customer, total);
    document.getElementById("startCustomer").value = "";
    const tableName = document.getElementById("startTable").selectedOptions[0]?.textContent || "Table";
    setStartMsg(`Session started: ${customer} on ${tableName}. Timer is running below.`, "ok");
    refreshAll(true);
  } catch (e) { setStartMsg(e.message, "err"); }
  finally { btn.disabled = document.getElementById("startTable").value === ""; }
});

(async () => {
  try {
    const me = await getMe();
    if (me.role !== "cashier") {
      location.href = me.role === "admin" ? "../admin/admin-dashboard.html" : "../auth/login.html";
      return;
    }
    const name = me.email || me.username || "cashier";
    document.getElementById("who").textContent = name;
    document.getElementById("avatar").textContent = name.charAt(0).toUpperCase();
    updateStartSummary();
    refreshAll(false);
    setInterval(tickTimers, 1000);
    setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (document.querySelector(".dash-modal.open")) return;
      refreshAll(true);
    }, 30000);
  } catch {
    location.href = "../auth/login.html";
  }
})();
document.getElementById("out").addEventListener("click", async () => {
  await logout(); location.href = "../auth/login.html";
});
