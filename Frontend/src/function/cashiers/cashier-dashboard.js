// src/function/cashiers/cashier-dashboard.js - Dashboard page logic.
// Pair: cashier-dashboard.html. Owns the start-session form (table +
// customer + planned duration, e.g. "2 hrs" -> 120 min) + overview counts.
// Sessions lifecycle lives on cashier-sessions.js; tables on
// cashier-tables.js. Shared guard/timers in cashier-common.js.

function setStartMsg(t, kind = "") {
  const el = document.getElementById("startMsg");
  if (!el) return;
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

async function loadDashboard(quiet = false) {
  if (!quiet) setStartMsg("Loading tables…");
  try {
    const [{ tables }, { sessions: active }] = await Promise.all([
      listCashierTables("all"),
      listCashierSessions("active"),
    ]);
    const available = (tables || []).filter((t) => t.status === "available");
    fillStartTables(available);
    const statActive = document.getElementById("statActive");
    if (statActive) statActive.textContent = String((active || []).length);
    const statAvail = document.getElementById("statAvail");
    if (statAvail) statAvail.textContent = String(available.length);
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
    setStartMsg("");
  } catch (e) {
    setStartMsg(e.message, "err");
  }
}

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
  document.getElementById(id)?.addEventListener("input", updateStartSummary));

document.getElementById("startBtn")?.addEventListener("click", async () => {
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
    setStartMsg(`Session started: ${customer} on ${tableName}.`, "ok");
    const link = document.createElement("a");
    link.href = "./cashier-sessions.html";
    link.textContent = " Open Sessions to watch the timer →";
    document.getElementById("startMsg").appendChild(link);
    loadDashboard(true);
  } catch (e) { setStartMsg(e.message, "err"); }
  finally { btn.disabled = document.getElementById("startTable").value === ""; }
});

(async () => {
  try {
    await cashierGuard();
    bindCashierLogout();
    updateStartSummary();
    loadDashboard(false);
    startCashierPolling(loadDashboard);
  } catch {
    location.href = "../auth/login.html";
  }
})();
