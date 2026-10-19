// src/function/cashiers/cashier-dashboard.js - Dashboard page logic.
// Pair: cashier-dashboard.html. Owns the start-session form (table +
// customer + planned duration in whole hours, e.g. "2 hrs" -> 120 min,
// 1-hour minimum; Enter submits) + overview counts + table-status grid +
// active sessions list with Manage buttons.
// Sessions lifecycle lives on cashier-sessions.js; tables on
// cashier-tables.js. Shared guard/timers in cashier-common.js.

function setStartMsg(t, kind = "") {
  const el = document.getElementById("startMsg");
  if (!el) return;
  el.textContent = t;
  el.className = `dash-msg${kind ? " " + kind : ""}`;
}

/** Live summary under the duration stepper: "2h 0m · ends ~4:30 PM". */
function updateStartSummary() {
  const box = document.getElementById("startSummary");
  if (!box) return;
  const hrs = Number(document.getElementById("startHours").value || 0);
  const mins = Number(document.getElementById("startMins").value || 0);
  const total = hrs * 60 + mins;
  if (!(total >= 60 && total <= 1440)) {
    box.textContent = "Pick 1 hour – 24 h in whole hours (e.g. 2 hrs = 120 min).";
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

/** Start-card table dropdown lists available tables only + availability pill. */
function fillStartTables(available) {
  const sel = document.getElementById("startTable");
  if (!sel) return;
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

/** Table-status card grid (all non-archived tables, live statuses). */
function renderTableGrid(tables) {
  const grid = document.getElementById("tableGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const rows = (tables || []).filter((t) => !t.archived);
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "tcgrid-empty";
    p.textContent = "No tables yet — ask an administrator to add one.";
    grid.appendChild(p);
    return;
  }
  for (const t of rows) {
    const card = document.createElement("div");
    card.className = "tc-card";
    const top = document.createElement("div");
    top.className = "tc-top";
    const name = document.createElement("span");
    name.className = "tc-name";
    name.textContent = t.name;
    const badge = document.createElement("span");
    badge.className = `badge ${t.status}`;
    badge.textContent = t.status;
    top.append(name, badge);
    const meta = document.createElement("span");
    meta.className = "tc-meta";
    // icon-only meta (badge above already carries the status word); <title>
    // keeps a tooltip + accessible name since the text is gone
    meta.innerHTML = t.status === "maintenance"
      ? '<svg role="img" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><title>out of service</title><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>'
      : '<svg role="img" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><title>idle</title><rect x="7" y="5.5" width="3.5" height="13" rx="1.2" /><rect x="13.5" y="5.5" width="3.5" height="13" rx="1.2" /></svg>';
    card.append(top, meta);
    grid.appendChild(card);
  }
}

/** Active sessions list: table · customer · live countdown · Manage. */
function renderActiveList(sessions) {
  const box = document.getElementById("activeList");
  if (!box) return;
  box.innerHTML = "";
  const rows = sessions || [];
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "sl-empty";
    p.textContent = "No active sessions — start one from the panel beside.";
    box.appendChild(p);
    return;
  }
  for (const s of rows) {
    const row = document.createElement("div");
    row.className = "sl-row";
    const left = document.createElement("span");
    left.className = "sl-name";
    left.textContent = `${s.tableName || "Table"} · ${s.customerName || "Customer"}`;
    const timer = document.createElement("span");
    timer.className = "timer";
    timer.setAttribute("data-end", s.endTime || "");
    timer.textContent = s.endTime ? "…" : "—";
    const manage = document.createElement("a");
    manage.className = "rowbtn go";
    manage.href = "./cashier-sessions.html";
    manage.textContent = "Manage";
    row.append(left, timer, manage);
    box.appendChild(row);
  }
  tickTimers();
}

async function loadDashboard(quiet = false) {
  if (!quiet) setStartMsg("Loading tables…", "loading");
  try {
    const [{ tables }, { sessions: active }] = await Promise.all([
      listCashierTables("all"),
      listCashierSessions("active"),
    ]);
    const all = tables || [];
    const available = all.filter((t) => t.status === "available");
    fillStartTables(available);
    const statActive = document.getElementById("statActive");
    if (statActive) statActive.textContent = String((active || []).length);
    const statAvail = document.getElementById("statAvail");
    if (statAvail) statAvail.textContent = String(available.length);
    const statOcc = document.getElementById("statOcc");
    if (statOcc) statOcc.textContent = String(all.filter((t) => t.status === "occupied").length);
    renderTableGrid(all);
    renderActiveList(active);
    // To-bill count needs closed-unbilled; failures there must not break start.
    try {
      const [{ sessions: closed }, { transactions }] = await Promise.all([
        listCashierSessions("closed"),
        listTransactions({}, false),
      ]);
      const billed = new Set((transactions || []).map((t) => String(t.sessionId || "")));
      const unbilled = (closed || []).filter((s) => !billed.has(String(s.id)));
      const statBill = document.getElementById("statBill");
      if (statBill) statBill.textContent = String(unbilled.length);
    } catch { /* counts stay; start form already works */ }
    if (!quiet) setStartMsg("");
  } catch (e) {
    setStartMsg(e.message, "err");
    if (!quiet) dashToast(e.message, "err", { title: "Dashboard refresh failed" });
  }
}

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
  document.getElementById(id)?.addEventListener("input", updateStartSummary));

document.getElementById("startForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("startBtn");
  const tableEl = document.getElementById("startTable");
  const customerEl = document.getElementById("startCustomer");
  const tableId = tableEl.value;
  const customer = customerEl.value.trim();
  const hrs = Number(document.getElementById("startHours").value || 0);
  const mins = Number(document.getElementById("startMins").value || 0);
  const total = hrs * 60 + mins;
  dashFieldError(customerEl, false);
  if (!tableId) { setStartMsg("No available table to start on.", "err"); return; }
  if (customer === "") {
    dashFieldError(customerEl, true);
    setStartMsg("Customer name is required.", "err");
    customerEl.focus();
    return;
  }
  if (!(total >= 60 && total <= 1440)) { setStartMsg("Duration must be 1 hour – 24 h in whole hours (e.g. 2 hrs = 120 min).", "err"); return; }
  setStartMsg("Starting…", "loading");
  btn.disabled = true;
  try {
    await startSession(tableId, customer, total);
    customerEl.value = "";
    const tableName = tableEl.selectedOptions[0]?.textContent || "Table";
    setStartMsg(`Session started: ${customer} on ${tableName}.`, "ok");
    dashToast(`${customer} is now playing on ${tableName}.`, "ok", { title: "Session started" });
    const link = document.createElement("a");
    link.href = "./cashier-sessions.html";
    link.textContent = " Open Sessions to watch the timer →";
    document.getElementById("startMsg").appendChild(link);
    loadDashboard(true);
  } catch (err) {
    setStartMsg(err.message, "err");
    dashToast(err.message, "err", { title: "Couldn't start session" });
  } finally {
    btn.disabled = document.getElementById("startTable").value === "";
  }
});

(async () => {
  try {
    await cashierGuard();
    bindCashierLogout();
    updateStartSummary();
    ensureCashierTick();
    loadDashboard(false);
    startCashierPolling(loadDashboard);
  } catch {
    location.href = "../auth/login.html";
  }
})();
