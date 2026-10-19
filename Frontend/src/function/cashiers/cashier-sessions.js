// src/function/cashiers/cashier-sessions.js - Sessions page logic.
// Pair: cashier-sessions.html. Owns the session lifecycle (CA-004..CA-014):
// active sessions with per-second countdowns, extend (+whole hours, 1h min),
// end (bills per-hour, 1-hour minimum), void (mistakes), plus billing close-out
// (CA-020/022/023/024/025) as ONE dialog: summary + method + amount + change
// + confirmation + receipt, replacing the old 5-modal chain.
// Shared guard/timers in cashier-common.js. Refresh: server truth every 30s;
// cells tick locally. Outcomes raise toasts; the server is the only source of
// truth for totals (createTransaction response wins over local estimates).

function setSessMsg(t, kind = "") {
  const el = document.getElementById("sessMsg");
  if (!el) return;
  el.textContent = t;
  el.className = `dash-msg${kind ? " " + kind : ""}`;
}
function setBillMsg(t, kind = "") {
  const el = document.getElementById("billMsg");
  if (!el) return;
  el.textContent = t;
  el.className = `dash-msg${kind ? " " + kind : ""}`;
}

// ---------------------------------------------------------------------------
// Rich "End this session?" confirm (reference-matched): icon header, table +
// customer line, wrap-up copy, billing reminder note, End Session / Keep
// Playing. Page-scoped like billSheet (shared dashConfirm stays untouched).
// Resolves true = end it, false = keep playing.
// ---------------------------------------------------------------------------
function endConfirm({ tableName = "", customerName = "" } = {}) {
  return new Promise((resolve) => {
    const tname = tableName || "this table";
    const overlay = document.createElement("div");
    overlay.className = "dash-modal open end-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "endTitle");
    overlay.setAttribute("aria-describedby", "endBody");
    overlay.innerHTML =
      '<div class="end-modal-box" tabindex="-1">' +
      '<div class="end-head">' +
      '<span class="end-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" /></svg></span>' +
      "<div>" +
      '<p class="end-title" id="endTitle">End this session?</p>' +
      '<p class="end-sub"></p>' +
      "</div></div>" +
      '<p class="end-body" id="endBody">Your game is about to wrap up. Ending this session will free up <strong></strong> for the next player.</p>' +
      '<div class="end-note">' +
      '<p class="end-note-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></svg>Billing reminder</p>' +
      '<p class="end-note-text">A minimum charge of 1 hour applies. Your final bill will be calculated according to the session&rsquo;s billing rules.</p>' +
      "</div>" +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-solid end-ok">End Session</button>' +
      '<button type="button" class="btn btn-ghost end-cancel">Keep Playing</button>' +
      "</div></div>";
    document.body.appendChild(overlay);

    // Dynamic copy stays in textContent (names are user data, never HTML).
    overlay.querySelector(".end-sub").textContent = `${tname} · Customer: ${customerName || "customer"}`;
    overlay.querySelector(".end-body strong").textContent = tname;
    const box = overlay.querySelector(".end-modal-box");
    const ok = overlay.querySelector(".end-ok");
    const cancel = overlay.querySelector(".end-cancel");

    const lastFocus = document.activeElement;
    const close = (v) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch { /* trigger removed */ } }
      resolve(v);
    };
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(false); return; }
      if (e.key !== "Tab") return;
      const list = Array.from(box.querySelectorAll("button:not(:disabled)"))
        .filter((el) => el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
    ok.onclick = () => close(true);
    cancel.onclick = () => close(false);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
    document.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    box.focus();
  });
}

// ---------------------------------------------------------------------------
// Single-sheet billing dialog (build + show + a11y + payment)
// ---------------------------------------------------------------------------
function billSheet({ sessionId, tableName = "", customerName = "", total }) {
  return new Promise((resolve) => {
    let method = "cash";
    let settled = false; // flips true once the payment is recorded
    const amount = Math.max(0, Number(total) || 0);

    const overlay = document.createElement("div");
    overlay.className = "dash-modal open";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "billTitle");
    overlay.innerHTML =
      '<div class="dash-modal-box sheet" tabindex="-1">' +
      '<div class="bill-sheet">' +
      '<p class="dash-modal-title" id="billTitle">Collect payment</p>' +
      '<p class="bill-sub"></p>' +
      '<div class="bill-summary">' +
      '<span class="bs-row"><span>Total due</span><strong data-r="total"></strong></span>' +
      '<span class="bs-row"><span>Method</span><strong data-r="method">Cash</strong></span>' +
      '<span class="bs-row"><span>Received</span><strong data-r="received"></strong></span>' +
      '<span class="bs-row total"><span>Change</span><strong data-r="change"></strong></span>' +
      "</div>" +
      '<span class="field-label">Payment method</span>' +
      '<div class="bill-methods" role="group" aria-label="Payment method">' +
      '<button type="button" class="chip on" data-m="cash" aria-pressed="true">Cash</button>' +
      '<button type="button" class="chip" data-m="gcash" aria-pressed="false">GCash</button>' +
      "</div>" +
      '<label class="field" for="billAmount"><span class="field-label">Amount received (₱)</span>' +
      '<input id="billAmount" name="amount" type="text" inputmode="decimal" autocomplete="off" /></label>' +
      '<p class="bill-change" id="billChangeLine" role="status"></p>' +
      '<p class="dash-msg err" id="billErr" hidden></p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" id="billCancel">Cancel</button>' +
      '<button type="button" class="btn btn-solid" id="billConfirm">Confirm payment</button>' +
      "</div></div></div>";
    document.body.appendChild(overlay);

    const box = overlay.querySelector(".dash-modal-box");
    const sub = overlay.querySelector(".bill-sub");
    const rTotal = overlay.querySelector('[data-r="total"]');
    const rMethod = overlay.querySelector('[data-r="method"]');
    const rReceived = overlay.querySelector('[data-r="received"]');
    const rChange = overlay.querySelector('[data-r="change"]');
    const input = overlay.querySelector("#billAmount");
    const changeLine = overlay.querySelector("#billChangeLine");
    const err = overlay.querySelector("#billErr");
    const confirmBtn = overlay.querySelector("#billConfirm");
    const cancelBtn = overlay.querySelector("#billCancel");
    sub.textContent = `${tableName || "Session"} · ${customerName || "Customer"}`;
    input.value = amount.toFixed(2);

    const lastFocus = document.activeElement;
    const close = (v) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch { /* gone */ } }
      resolve(v);
    };

    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(settled); return; }
      if (e.key !== "Tab") return;
      const list = Array.from(box.querySelectorAll("button:not(:disabled), input"))
        .filter((el) => el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }

    function refresh() {
      const received = Number(String(input.value).replace(/[^0-9.]/g, ""));
      rTotal.textContent = peso2(amount);
      rMethod.textContent = method === "gcash" ? "GCash" : "Cash";
      rReceived.textContent = received > 0 ? peso2(received) : "—";
      if (!(received > 0)) {
        rChange.textContent = "—";
        changeLine.textContent = "Enter the amount received.";
        changeLine.classList.remove("short");
        confirmBtn.disabled = true;
      } else if (received < amount) {
        const short = Math.round((amount - received) * 100) / 100;
        rChange.textContent = `short ${peso2(short)}`;
        changeLine.textContent = `Short ${peso2(short)} — the amount received must cover the total.`;
        changeLine.classList.add("short");
        confirmBtn.disabled = true;
      } else {
        const change = Math.round((received - amount) * 100) / 100;
        rChange.textContent = peso2(change);
        changeLine.textContent = `Change to give back: ${peso2(change)}`;
        changeLine.classList.remove("short");
        confirmBtn.disabled = false;
      }
    }

    overlay.querySelectorAll(".bill-methods .chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        method = chip.dataset.m;
        overlay.querySelectorAll(".bill-methods .chip").forEach((c) => {
          const on = c === chip;
          c.classList.toggle("on", on);
          c.setAttribute("aria-pressed", on ? "true" : "false");
        });
        refresh();
      }));

    input.addEventListener("input", () => { err.hidden = true; refresh(); });
    cancelBtn.addEventListener("click", () => close(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(settled); });

    confirmBtn.addEventListener("click", async () => {
      const received = Number(String(input.value).replace(/[^0-9.]/g, ""));
      if (!(received > 0) || received > 1000000) {
        err.textContent = `Enter an amount between ₱0.01 and ₱1,000,000.00 (got "${input.value}").`;
        err.hidden = false;
        input.focus();
        return;
      }
      err.hidden = true;
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      confirmBtn.classList.add("busy");
      try {
        const { transaction: t } = await createTransaction(sessionId, method, received);
        // Success view inside the same sheet (no extra modal).
        box.querySelector(".bill-sheet").innerHTML =
          '<div class="bill-done">' +
          '<span class="bill-ok" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 13l4 4L19 7" /></svg></span>' +
          '<p class="dash-modal-title" id="billTitle">Payment recorded</p>' +
          '<div class="bill-summary">' +
          '<span class="bs-row"><span>Reference</span><strong></strong></span>' +
          '<span class="bs-row"><span>Table</span><strong></strong></span>' +
          '<span class="bs-row"><span>Method</span><strong></strong></span>' +
          '<span class="bs-row total"><span>Paid / Change</span><strong></strong></span>' +
          "</div>" +
          '<div class="modal-actions">' +
          '<button type="button" class="btn btn-ghost" id="billDone">Done</button>' +
          '<a class="btn btn-solid" id="billReceipt" target="_blank" rel="noopener">Open receipt</a>' +
          "</div></div>";
        const rows = box.querySelectorAll(".bill-summary .bs-row strong");
        rows[0].textContent = t.ref || "—";
        rows[1].textContent = tableName || "—";
        rows[2].textContent = (t.method || method) === "gcash" ? "GCash" : "Cash";
        rows[3].textContent = `${peso2(t.total)} / ${peso2(t.change)}`;
        const receipt = box.querySelector("#billReceipt");
        receipt.href = `../shared/receipt.html?ref=${encodeURIComponent(t.ref || "")}`;
        settled = true; // Escape/backdrop now close with success (keep onKey bound)
        const done = () => close(true);
        box.querySelector("#billDone").addEventListener("click", done);
        receipt.addEventListener("click", done);
        box.querySelector("#billDone").focus();
        // Converge the lists behind the sheet right away.
        loadSessions(true);
        loadBilling(true);
        dashToast(`${peso2(t.total)} collected · ref ${t.ref} · change ${peso2(t.change)}.`, "ok", { title: "Payment recorded" });
      } catch (e2) {
        confirmBtn.classList.remove("busy");
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        err.textContent = e2.message;
        err.hidden = false;
      }
    });

    document.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    refresh();
    input.focus();
    input.select();
  });
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
    tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td><td></td>";
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
        dashToast(`${s.tableName || "Session"} extended by ${Number(pick) / 60}h.`, "ok", { title: "Extended" });
      } catch (e) {
        setSessMsg(e.message, "err");
        dashToast(e.message, "err", { title: "Extend failed" });
      }
    };
    const end = document.createElement("button");
    end.textContent = "End";
    end.className = "rowbtn go";
    end.onclick = async () => {
      const yes = await endConfirm({
        tableName: s.tableName,
        customerName: s.customerName,
      });
      if (!yes) return;
      try {
        const r = await endSession(s.id);
        const total = Number(r.amount !== undefined ? r.amount : 0);
        setSessMsg(`Session ended. Charge ${peso2(total)} — collecting payment…`, "ok");
        loadSessions(true);
        const paid = await billSheet({
          sessionId: s.id,
          tableName: s.tableName,
          customerName: s.customerName,
          total,
        });
        if (!paid) {
          setSessMsg(`Billing deferred for ${s.tableName || "session"} — it stays in To bill.`);
          loadBilling(true);
        }
      } catch (e) {
        setSessMsg(e.message, "err");
        dashToast(e.message, "err", { title: "End failed" });
      }
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
        dashToast(`Session on ${s.tableName || "the table"} voided (no charge).`, "ok", { title: "Voided" });
      } catch (e) {
        setSessMsg(e.message, "err");
        dashToast(e.message, "err", { title: "Void failed" });
      }
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
  if (!quiet) {
    setSessMsg("Loading…", "loading");
    dashSkeleton(document.querySelector("#sessTbl tbody"), 6, 3);
  }
  try {
    const { sessions } = await listCashierSessions("active");
    const n = paintSessions(sessions || []);
    setSessMsg(`${n} active session(s).`, "ok");
    dashStamp(document.getElementById("sessStamp"));
  } catch (e) {
    setSessMsg(e.message, "err");
  }
}

async function loadBilling(quiet = false) {
  const billBody = document.querySelector("#billTbl tbody");
  const paidBody = document.querySelector("#paidTbl tbody");
  if (!billBody || !paidBody) return;
  if (!quiet) {
    setBillMsg("Loading…", "loading");
    dashSkeleton(billBody, 4, 3);
  }
  try {
    const [{ sessions: closed }, { transactions }] = await Promise.all([
      listCashierSessions("closed"),
      listTransactions({}, false),
    ]);
    const billed = new Set((transactions || []).map((t) => String(t.sessionId || "")));
    const unbilled = (closed || []).filter((s) => !billed.has(String(s.id)));
    billBody.innerHTML = "";
    setBillMsg(
      unbilled.length === 0
        ? "Nothing awaiting payment."
        : `${unbilled.length} closed session(s) awaiting payment.`,
      unbilled.length === 0 ? "ok" : ""
    );
    for (const s of unbilled.slice(0, 20)) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td></td><td></td><td></td><td></td>";
      tr.children[0].textContent = s.tableName || "—";
      tr.children[1].textContent = s.customerName || "—";
      const est = estimateTotal(s);
      tr.children[2].textContent = peso2(est);
      const btn = document.createElement("button");
      btn.textContent = "Bill";
      btn.className = "rowbtn gold";
      btn.onclick = async () => {
        await billSheet({
          sessionId: s.id,
          tableName: s.tableName,
          customerName: s.customerName,
          total: est,
        });
      };
      tr.children[3].appendChild(btn);
      billBody.appendChild(tr);
    }
    paidBody.innerHTML = "";
    for (const t of (transactions || []).slice(0, 10)) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td><td></td>";
      tr.children[0].textContent = t.ref || "—";
      tr.children[1].textContent = t.customerName || "—";
      tr.children[2].textContent = peso2(t.total);
      const m = document.createElement("span");
      m.className = `badge method-${String(t.method).toLowerCase() === "gcash" ? "gcash" : "cash"}`;
      m.textContent = t.method || "—";
      tr.children[3].appendChild(m);
      tr.children[4].textContent = peso2(t.change);
      const a = document.createElement("a");
      a.href = `../shared/receipt.html?ref=${encodeURIComponent(t.ref || "")}`;
      a.textContent = "Receipt";
      a.target = "_blank";
      a.rel = "noopener";
      tr.children[5].appendChild(a);
      paidBody.appendChild(tr);
    }
    dashStamp(document.getElementById("billStamp"));
  } catch (e) {
    setBillMsg(e.message, "err");
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
