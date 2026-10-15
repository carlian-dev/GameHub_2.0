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
        const total = Number(r.amount !== undefined ? r.amount : 0);
        setSessMsg(`Session ended. Charge ₱${total.toFixed(2)}. Opening billing…`);
        loadSessions(true);
        loadCashierTables(true);
        loadBilling(true);
        // Two-step close-out then pay (Sprint 3): bill the just-closed session now.
        await billFlow(s.id, s.tableName, s.customerName, total);
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
  await Promise.all([loadSessions(quiet), loadCashierTables(quiet), loadBilling(quiet)]);
}

// ---- Sprint 3 billing (CA-020/022/023/024/025): close-out then pay ----
// End returns the charge; billFlow collects method + received via the shared
// dash dialogs (no native popups), shows a live change preview in the confirm
// step, then posts createTransaction. Success offers a receipt PDF preview.
function peso2(n) { return `₱${Number(n || 0).toFixed(2)}`; }

function estimateTotal(s) {
  const start = s.startTime ? new Date(s.startTime).getTime() : NaN;
  const end = s.closedAt ? new Date(s.closedAt).getTime() : Date.now();
  if (isNaN(start)) return 0;
  const secs = Math.max(0, (end - start) / 1000);
  return Math.round((secs / 3600) * Number(s.pricePerHour || 120) * 100) / 100;
}

async function billFlow(sessionId, tableName, customerName, total) {
  const label = `${tableName || "session"} (${customerName || "customer"}) · total ${peso2(total)}`;
  const method = await dashSelect({
    message: `Collect payment for ${label}. Cash or GCash only.`,
    label: "Payment method",
    options: [
      { value: "cash", label: "Cash" },
      { value: "gcash", label: "GCash" },
    ],
    value: "cash",
    title: "Payment method",
  });
  if (method === null) {
    setSessMsg(`Billing deferred for ${label}. Use the To-bill list below to collect it.`);
    loadBilling(true);
    return false;
  }
  const raw = await dashPrompt(
    `Total ${peso2(total)} via ${method}. Enter the amount received (change shows next).`,
    "Amount received (₱)",
    Number(total).toFixed(2),
    "Collect payment"
  );
  if (raw === null) {
    setSessMsg(`Billing deferred for ${label}. Use the To-bill list below to collect it.`);
    loadBilling(true);
    return false;
  }
  const received = Number(String(raw).replace(/[^0-9.]/g, ""));
  if (!(received > 0) || received > 1000000) {
    setSessMsg(`Invalid amount "${raw}". Enter a number > 0 (max 1000000).`);
    return false;
  }
  if (received < total) {
    await dashConfirm(
      `Short payment: received ${peso2(received)} < total ${peso2(total)} (short ${peso2(total - received)}). Ask for more before confirming.`,
      "Insufficient"
    );
    setSessMsg(`Short payment blocked: received ${peso2(received)} < total ${peso2(total)}.`);
    return false;
  }
  const change = Math.round((received - total) * 100) / 100;
  const ok = await dashConfirm(
    `Table: ${tableName || "—"}\nCustomer: ${customerName || "—"}\nTotal: ${peso2(total)}\nMethod: ${method}\nReceived: ${peso2(received)}\nChange: ${peso2(change)}\n\nConfirm payment?`,
    "Confirm payment"
  );
  if (!ok) {
    setSessMsg(`Payment not confirmed for ${label}. It stays in To-bill.`);
    loadBilling(true);
    return false;
  }
  try {
    const { transaction: t } = await createTransaction(sessionId, method, received);
    setSessMsg(`Paid ${peso2(t.total)} · ref ${t.ref} · change ${peso2(t.change)}.`);
    loadBilling(true);
    const print = await dashConfirm(
      `Payment recorded.\nRef: ${t.ref}\nChange: ${peso2(t.change)}\n\nOpen the receipt to save PDF now?`,
      "Payment recorded"
    );
    if (print) window.open(`../shared/receipt.html?ref=${encodeURIComponent(t.ref)}`, "_blank", "noopener");
    return true;
  } catch (e) {
    setSessMsg(e.message);
    return false;
  }
}

// Unbilled closed sessions + recent bills, rendered under the active table
// without touching cashier-dashboard.html (wiring-only change per plan §6).
function billingPanels() {
  const host = document.getElementById("sessions-panel");
  if (!host) return {};
  let unbilled = document.getElementById("unbilledWrap");
  if (!unbilled) {
    unbilled = document.createElement("div");
    unbilled.id = "unbilledWrap";
    unbilled.innerHTML = `<h3 style="margin:18px 0 6px">To bill (closed, unpaid)</h3>
      <div class="dash-msg" id="billMsg">Loading...</div>
      <div class="dash-tablewrap"><table id="billTbl">
      <thead><tr><th>Table</th><th>Customer</th><th>Est. total</th><th>Action</th></tr></thead>
      <tbody></tbody></table></div>
      <h3 style="margin:18px 0 6px">Recent bills</h3>
      <div class="dash-tablewrap"><table id="paidTbl">
      <thead><tr><th>Ref</th><th>Customer</th><th>Total</th><th>Method</th><th>Change</th><th>Receipt</th></tr></thead>
      <tbody></tbody></table></div>`;
    host.appendChild(unbilled);
  }
  return {
    billMsg: document.getElementById("billMsg"),
    billBody: document.querySelector("#billTbl tbody"),
    paidBody: document.querySelector("#paidTbl tbody"),
  };
}

async function loadBilling(quiet = false) {
  const { billMsg, billBody, paidBody } = billingPanels();
  if (!billMsg) return;
  if (!quiet) billMsg.textContent = "Loading...";
  try {
    const [{ sessions: closed }, { transactions }] = await Promise.all([
      listCashierSessions("closed"),
      listTransactions({}, false),
    ]);
    const billed = new Set((transactions || []).map((t) => String(t.sessionId || "")));
    const unbilled = (closed || []).filter((s) => !billed.has(String(s.id)));
    billBody.innerHTML = "";
    if (unbilled.length === 0) {
      billMsg.textContent = "Nothing awaiting payment.";
    } else {
      billMsg.textContent = `${unbilled.length} closed session(s) awaiting payment.`;
    }
    for (const s of unbilled.slice(0, 20)) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td></td><td></td><td></td><td></td>`;
      tr.children[0].textContent = s.tableName || "—";
      tr.children[1].textContent = s.customerName || "—";
      const est = estimateTotal(s);
      tr.children[2].textContent = peso2(est);
      const btn = document.createElement("button");
      btn.textContent = "Bill";
      btn.className = "rowbtn go";
      btn.onclick = () => billFlow(s.id, s.tableName, s.customerName, est);
      tr.children[3].appendChild(btn);
      billBody.appendChild(tr);
    }
    paidBody.innerHTML = "";
    for (const t of (transactions || []).slice(0, 10)) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td></td><td></td><td></td><td></td><td></td><td></td>`;
      tr.children[0].textContent = t.ref || "—";
      tr.children[1].textContent = t.customerName || "—";
      tr.children[2].textContent = peso2(t.total);
      tr.children[3].textContent = t.method || "—";
      tr.children[4].textContent = peso2(t.change);
      const a = document.createElement("a");
      a.href = `../shared/receipt.html?ref=${encodeURIComponent(t.ref || "")}`;
      a.textContent = "Print";
      a.target = "_blank";
      a.rel = "noopener";
      tr.children[5].appendChild(a);
      paidBody.appendChild(tr);
    }
  } catch (e) {
    billMsg.textContent = e.message;
  }
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
