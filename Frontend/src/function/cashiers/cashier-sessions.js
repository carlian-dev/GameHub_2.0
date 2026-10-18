// src/function/cashiers/cashier-sessions.js - Sessions page logic.
// Pair: cashier-sessions.html. Owns the session lifecycle (CA-004..CA-014):
// active sessions with per-second countdowns, extend (+whole hours, 1h min),
// end (bills per-hour, 1-hour minimum), void (mistakes), plus billing close-out (CA-020/022/023/024/
// 025): to-bill list + recent bills + receipt PDF. Shared guard/timers in
// cashier-common.js. Refresh: server truth every 30s; cells tick locally.

function setSessMsg(t) {
  const el = document.getElementById("sessMsg");
  if (el) el.textContent = t;
}

function paintSessions(list) {
  const tb = document.querySelector("#sessTbl tbody");
  if (!tb) return 0;
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
        message: `Extend ${s.tableName || "session"} for the customer. Adds whole hours to the planned end (1-hour minimum).`,
        label: "Extra time",
        options: [
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
        `End session on ${s.tableName || "this table"} (${s.customerName || "customer"})? The table becomes available. Billing is per-hour with a 1-hour minimum.`,
        "End session"
      );
      if (!yes) return;
      try {
        const r = await endSession(s.id);
        const total = Number(r.amount !== undefined ? r.amount : 0);
        setSessMsg(`Session ended. Charge ₱${total.toFixed(2)}. Opening billing…`);
        loadSessions(true);
        loadBilling(true);
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
      } catch (e) { setSessMsg(e.message); }
    };
    act.append(ex, end, vd);
    tb.appendChild(tr);
  }
  tickTimers();
  const empty = document.getElementById("sessEmpty");
  if (empty) empty.hidden = list.length > 0;
  return list.length;
}

async function loadSessions(quiet = false) {
  if (!quiet) setSessMsg("Loading...");
  try {
    const { sessions } = await listCashierSessions("active");
    setSessMsg(`${paintSessions(sessions || [])} active session(s).`);
  } catch (e) {
    setSessMsg(e.message);
  }
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

async function loadBilling(quiet = false) {
  const billMsg = document.getElementById("billMsg");
  const billBody = document.querySelector("#billTbl tbody");
  const paidBody = document.querySelector("#paidTbl tbody");
  if (!billMsg || !billBody || !paidBody) return;
  if (!quiet) billMsg.textContent = "Loading...";
  try {
    const [{ sessions: closed }, { transactions }] = await Promise.all([
      listCashierSessions("closed"),
      listTransactions({}, false),
    ]);
    const billed = new Set((transactions || []).map((t) => String(t.sessionId || "")));
    const unbilled = (closed || []).filter((s) => !billed.has(String(s.id)));
    billBody.innerHTML = "";
    billMsg.textContent = unbilled.length === 0
      ? "Nothing awaiting payment."
      : `${unbilled.length} closed session(s) awaiting payment.`;
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

async function refreshSessions(quiet = true) {
  await Promise.all([loadSessions(quiet), loadBilling(quiet)]);
}

(async () => {
  try {
    await cashierGuard();
    bindCashierLogout();
    ensureCashierTick();
    refreshSessions(false);
    startCashierPolling(refreshSessions);
  } catch {
    location.href = "../auth/login.html";
  }
})();
