// src/function/cashiers/cashier-sessions.js - Sessions page logic.
// Pair: cashier-sessions.html. Owns the session lifecycle (CA-004..CA-014):
// active sessions with per-second countdowns, extend (+whole hours, 1h min),
// end (bills per-hour, 1-hour minimum), void (mistakes), F&B ordering
// (CA-026/027/028), and billing close-out (CA-020/022/023/024/025) as ONE
// dialog: item lines + session charge + F&B subtotal + method + amount +
// change + confirmation + receipt. Shared guard/timers in cashier-common.js.
// Refresh: server truth every 30s; cells tick locally. Outcomes raise toasts;
// the server is the only source of truth for totals (createTransaction
// response wins over local estimates).

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

const FNB_LABELS = { food: "Food", beverage: "Beverage", other: "Other" };

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** True when this overlay is the last open modal (so it owns Escape/Tab). */
function isTopModal(el) {
  const open = document.querySelectorAll(".dash-modal.open");
  return open.length > 0 && open[open.length - 1] === el;
}

/** Only restore page scrolling when no sheet/dialog remains open. */
function restoreBodyScroll() {
  if (!document.querySelector(".dash-modal.open")) {
    document.body.style.overflow = "";
  }
}

function fnbCell(td, session) {
  const total = Number(session && session.fnbTotal ? session.fnbTotal : 0);
  const count = Number(session && session.fnbLineCount ? session.fnbLineCount : 0);
  if (total > 0) {
    td.textContent = peso2(total);
    td.classList.add("num");
    td.title = `${count} F&B line${count === 1 ? "" : "s"}`;
  } else {
    td.textContent = "—";
    td.title = "No F&B items";
  }
}

function estimateBillTotal(s) {
  return roundMoney(estimateTotal(s) + Number(s.fnbTotal || 0));
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
      '<p class="end-note-text">A minimum charge of 1 hour applies. Your final bill will be calculated according to the session&rsquo;s billing rules. F&amp;B items stay on the bill until payment.</p>' +
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
      restoreBodyScroll();
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch { /* trigger removed */ } }
      resolve(v);
    };
    function onKey(e) {
      if (!isTopModal(overlay)) return;
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
// F&B order sheet (CA-026/027/028). Shows the live bill lines, steppers for
// quantity, remove (dashConfirm stacks above), and a searchable active menu.
// Works for active and closed-unpaid sessions; paid/cancelled bills are
// read-only. Resolves true when the bill changed so the lists can refresh.
// ---------------------------------------------------------------------------
function orderSheet({ sessionId, tableName = "", customerName = "" }) {
  return new Promise((resolve) => {
    let bill = null;
    let menu = [];
    let menuLoaded = false;
    let menuCategory = "";
    let changed = false;
    let notice = "";
    let closed = false;
    let pending = 0;
    let closeRequested = false;
    const busyLines = new Set();
    let busyProductId = null;

    const overlay = document.createElement("div");
    overlay.className = "dash-modal open order-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "orderTitle");
    overlay.innerHTML =
      '<div class="dash-modal-box sheet order-box" tabindex="-1">' +
      '<div class="order-sheet">' +
      '<div class="order-head">' +
      '<div class="order-headtext">' +
      '<p class="dash-modal-title" id="orderTitle">Food &amp; beverage</p>' +
      '<p class="bill-sub order-sub"></p>' +
      "</div>" +
      '<span class="badge order-status" id="orderStatus" hidden></span>' +
      "</div>" +
      '<section class="order-current" aria-labelledby="orderCurrentH">' +
      '<div class="order-section-head"><h3 id="orderCurrentH">On this bill</h3>' +
      '<button type="button" class="order-linkbtn" id="orderBillRetry" hidden>Retry bill</button></div>' +
      '<p class="dash-msg" id="orderBillMsg" role="status">Loading bill…</p>' +
      '<div class="order-lines" id="orderLines"></div>' +
      '<p class="dash-empty" id="orderEmpty" hidden>No F&amp;B on this bill yet.</p>' +
      '<div class="order-totals" id="orderTotals" hidden>' +
      '<span class="bs-row"><span>F&amp;B subtotal</span><strong id="orderFnbSubtotal"></strong></span>' +
      '<span class="bs-row" id="orderSessionRow"><span>Session charge</span><strong id="orderSessionCharge"></strong></span>' +
      '<span class="bs-row total" id="orderGrandRow"><span>Grand total</span><strong id="orderGrandTotal"></strong></span>' +
      "</div>" +
      "</section>" +
      '<section class="order-picker" aria-labelledby="orderPickerH">' +
      '<div class="order-section-head"><h3 id="orderPickerH">Add a menu item</h3>' +
      '<button type="button" class="order-linkbtn" id="orderMenuRetry" hidden>Retry menu</button></div>' +
      '<label class="dash-search order-search" for="orderSearch">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>' +
      '<input id="orderSearch" type="search" placeholder="Search active menu" aria-label="Search active menu" autocomplete="off" />' +
      "</label>" +
      '<div class="order-chips" role="group" aria-label="Filter menu by category">' +
      '<button type="button" class="chip on" data-cat="" aria-pressed="true">All</button>' +
      '<button type="button" class="chip" data-cat="food" aria-pressed="false">Food</button>' +
      '<button type="button" class="chip" data-cat="beverage" aria-pressed="false">Beverage</button>' +
      '<button type="button" class="chip" data-cat="other" aria-pressed="false">Other</button>' +
      "</div>" +
      '<p class="dash-msg" id="orderMenuMsg" role="status">Loading menu…</p>' +
      '<div class="order-products" id="orderProducts"></div>' +
      '<p class="dash-empty" id="orderMenuEmpty" hidden>No active menu items.</p>' +
      "</section>" +
      '<p class="dash-msg err" id="orderErr" role="alert" hidden></p>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" id="orderClose">Close</button></div>' +
      "</div></div>";
    document.body.appendChild(overlay);

    const box = overlay.querySelector(".dash-modal-box");
    const sheet = overlay.querySelector(".order-sheet");
    const sub = overlay.querySelector(".order-sub");
    const status = overlay.querySelector("#orderStatus");
    const billMsg = overlay.querySelector("#orderBillMsg");
    const billRetry = overlay.querySelector("#orderBillRetry");
    const linesEl = overlay.querySelector("#orderLines");
    const emptyEl = overlay.querySelector("#orderEmpty");
    const totalsEl = overlay.querySelector("#orderTotals");
    const fnbSubtotalEl = overlay.querySelector("#orderFnbSubtotal");
    const sessionRow = overlay.querySelector("#orderSessionRow");
    const sessionChargeEl = overlay.querySelector("#orderSessionCharge");
    const grandRow = overlay.querySelector("#orderGrandRow");
    const grandTotalEl = overlay.querySelector("#orderGrandTotal");
    const picker = overlay.querySelector(".order-picker");
    const menuMsg = overlay.querySelector("#orderMenuMsg");
    const menuRetry = overlay.querySelector("#orderMenuRetry");
    const productsEl = overlay.querySelector("#orderProducts");
    const menuEmpty = overlay.querySelector("#orderMenuEmpty");
    const search = overlay.querySelector("#orderSearch");
    const err = overlay.querySelector("#orderErr");
    const closeBtn = overlay.querySelector("#orderClose");

    sub.textContent = `${tableName || "Session"} · ${customerName || "Customer"}`;

    const lastFocus = document.activeElement;
    function finalize() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      restoreBodyScroll();
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch { /* gone */ } }
      resolve(changed);
    }
    function endPending() {
      pending = Math.max(0, pending - 1);
      if (pending === 0) {
        if (closeRequested) { finalize(); return; }
        closeBtn.disabled = false;
        closeBtn.textContent = "Close";
      }
    }
    function startPending() {
      pending += 1;
      if (pending > 0) {
        closeBtn.disabled = false; // deferred: clicking asks to close after the request
      }
    }
    function requestClose() {
      if (pending > 0) {
        closeRequested = true;
        closeBtn.disabled = true;
        closeBtn.textContent = "Finishing…";
        return;
      }
      finalize();
    }
    function showErr(text) {
      err.textContent = text;
      err.hidden = false;
    }
    function clearErr() {
      err.textContent = "";
      err.hidden = true;
    }

    function isEditable() {
      if (!bill || !bill.session) return false;
      const s = bill.session;
      if (s.finalized || s.status === "cancelled") return false;
      return s.status === "active" || s.status === "closed";
    }

    function renderStatus() {
      if (!bill || !bill.session) {
        status.hidden = true;
        return;
      }
      const s = bill.session;
      let label = "Open";
      let cls = "active";
      if (s.finalized) { label = "Paid"; cls = "paid"; }
      else if (s.status === "cancelled") { label = "Cancelled"; cls = "declined"; }
      else if (s.status === "closed") { label = "Awaiting payment"; cls = "closed"; }
      status.textContent = label;
      status.className = `badge ${cls} order-status`;
      status.hidden = false;
    }

    function lineRow(item, editable) {
      const row = document.createElement("div");
      row.className = "order-line";
      row.dataset.line = item.id;

      const main = document.createElement("div");
      main.className = "ol-main";
      const name = document.createElement("span");
      name.className = "ol-name";
      name.textContent = item.name || "Item";
      const meta = document.createElement("span");
      meta.className = "ol-meta";
      meta.textContent = `${FNB_LABELS[item.category] || "Other"} · ${peso2(item.unitPrice)} each`;
      main.append(name, meta);

      const qtyWrap = document.createElement("div");
      qtyWrap.className = "ol-qty";
      const busy = busyLines.has(item.id);
      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "qty-btn";
      minus.textContent = "−";
      minus.title = `Decrease ${item.name || "item"} quantity`;
      minus.setAttribute("aria-label", `Decrease ${item.name || "item"} quantity`);
      minus.disabled = !editable || busy || Number(item.qty) <= 1;
      minus.addEventListener("click", () => setLineQty(item, Number(item.qty) - 1));

      const qtyInput = document.createElement("input");
      qtyInput.className = "qty-input";
      qtyInput.type = "number";
      qtyInput.min = "1";
      qtyInput.max = "99";
      qtyInput.step = "1";
      qtyInput.value = String(item.qty);
      qtyInput.setAttribute("aria-label", `Quantity for ${item.name || "item"}`);
      qtyInput.disabled = !editable || busy;
      qtyInput.addEventListener("change", () => {
        const q = Number(qtyInput.value);
        if (!Number.isInteger(q) || q < 1 || q > 99) {
          showErr("Quantity must be a whole number from 1 to 99.");
          qtyInput.value = String(item.qty);
          return;
        }
        if (q !== Number(item.qty)) setLineQty(item, q);
      });
      qtyInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); qtyInput.blur(); }
      });

      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "qty-btn";
      plus.textContent = "+";
      plus.title = `Increase ${item.name || "item"} quantity`;
      plus.setAttribute("aria-label", `Increase ${item.name || "item"} quantity`);
      plus.disabled = !editable || busy || Number(item.qty) >= 99;
      plus.addEventListener("click", () => setLineQty(item, Number(item.qty) + 1));
      qtyWrap.append(minus, qtyInput, plus);

      const total = document.createElement("span");
      total.className = "ol-total";
      total.textContent = peso2(item.lineTotal);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "rowbtn danger ol-remove";
      remove.textContent = "Remove";
      remove.disabled = !editable || busy;
      remove.addEventListener("click", () => removeLine(item));

      row.append(main, qtyWrap, total, remove);
      return row;
    }

    function renderBill(focusLineId = "") {
      if (!bill || !bill.session) return;
      const items = Array.isArray(bill.items) ? bill.items : [];
      const editable = isEditable();
      renderStatus();
      sub.textContent = `${tableName || bill.session.tableName || "Session"} · ${customerName || bill.session.customerName || "Customer"}`;

      linesEl.innerHTML = "";
      for (const item of items) linesEl.appendChild(lineRow(item, editable));
      emptyEl.hidden = items.length > 0;
      emptyEl.textContent = editable
        ? "No F&B on this bill yet — add something from the menu below."
        : "No F&B items on this bill.";

      totalsEl.hidden = false;
      fnbSubtotalEl.textContent = peso2(bill.fnbTotal);
      if (bill.session.status === "closed") {
        sessionRow.hidden = false;
        sessionChargeEl.textContent = peso2(bill.sessionTotal);
        grandRow.hidden = false;
        grandTotalEl.textContent = peso2(bill.total);
      } else if (bill.session.status === "cancelled") {
        sessionRow.hidden = false;
        sessionChargeEl.textContent = "Not billable";
        grandRow.hidden = true;
      } else {
        sessionRow.hidden = false;
        sessionChargeEl.textContent = "Calculated when the session ends";
        grandRow.hidden = true;
      }

      picker.hidden = !editable;
      if (notice) {
        billMsg.textContent = notice;
        billMsg.className = "dash-msg ok";
      } else if (items.length > 0) {
        billMsg.textContent = `${items.length} F&B line${items.length === 1 ? "" : "s"} · subtotal ${peso2(bill.fnbTotal)}.`;
        billMsg.className = "dash-msg";
      } else {
        billMsg.textContent = "No F&B lines yet.";
        billMsg.className = "dash-msg";
      }
      billMsg.hidden = false;

      if (focusLineId) {
        const input = linesEl.querySelector(`[data-line="${focusLineId}"] .qty-input`);
        if (input && !input.disabled) input.focus();
      }
    }

    function setRowBusy(lineId, busy) {
      const row = linesEl.querySelector(`[data-line="${lineId}"]`);
      if (!row) return;
      row.classList.toggle("busy", busy);
      row.setAttribute("aria-busy", busy ? "true" : "false");
      row.querySelectorAll("button, input").forEach((el) => { el.disabled = busy; });
    }

    async function setLineQty(line, qty) {
      if (!isEditable() || busyLines.has(line.id)) return;
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        showErr("Quantity must be a whole number from 1 to 99.");
        return;
      }
      clearErr();
      notice = "";
      busyLines.add(line.id);
      setRowBusy(line.id, true);
      startPending();
      try {
        const data = await updateOrderLine(sessionId, line.id, qty);
        if (closed) return;
        bill = data.bill;
        changed = true;
        notice = `${line.name || "Item"} quantity updated to ${qty}.`;
      } catch (e) {
        if (!closed) showErr(e.message);
      } finally {
        busyLines.delete(line.id);
        endPending();
      }
      if (!closed) {
        setRowBusy(line.id, false);
        renderBill(line.id);
      }
    }

    async function removeLine(line) {
      if (!isEditable() || busyLines.has(line.id)) return;
      const yes = await dashConfirm(
        `Remove ${line.name || "this item"} (x${line.qty}) from the bill? The F&B subtotal will be recalculated.`,
        "Remove item"
      );
      if (!yes || closed) return;
      clearErr();
      notice = "";
      busyLines.add(line.id);
      setRowBusy(line.id, true);
      startPending();
      try {
        const data = await removeOrderLine(sessionId, line.id);
        if (closed) return;
        bill = data.bill;
        changed = true;
        notice = `${line.name || "Item"} removed from the bill.`;
      } catch (e) {
        if (!closed) showErr(e.message);
      } finally {
        busyLines.delete(line.id);
        endPending();
      }
      if (!closed) renderBill();
    }

    function productRow(product) {
      const row = document.createElement("div");
      row.className = "order-product";
      row.dataset.product = product.id;

      const main = document.createElement("div");
      main.className = "op-main";
      const name = document.createElement("span");
      name.className = "op-name";
      name.textContent = product.name || "Item";
      const meta = document.createElement("span");
      meta.className = "op-meta";
      meta.textContent = `${FNB_LABELS[product.category] || "Other"} · ${peso2(product.price)}`;
      main.append(name, meta);

      const qty = document.createElement("input");
      qty.className = "qty-input op-qty";
      qty.type = "number";
      qty.min = "1";
      qty.max = "99";
      qty.step = "1";
      qty.value = "1";
      qty.setAttribute("aria-label", `Quantity of ${product.name || "item"} to add`);
      qty.disabled = !!busyProductId;

      const add = document.createElement("button");
      add.type = "button";
      add.className = "rowbtn go op-add";
      add.textContent = "Add";
      add.disabled = !!busyProductId;
      add.addEventListener("click", () => {
        const q = Number(qty.value);
        if (!Number.isInteger(q) || q < 1 || q > 99) {
          showErr("Quantity must be a whole number from 1 to 99.");
          qty.focus();
          return;
        }
        addProduct(product, q, qty);
      });

      row.append(main, qty, add);
      return row;
    }

    function paintMenu() {
      const q = (search.value || "").trim().toLowerCase();
      const list = menu.filter((p) => {
        if (menuCategory && p.category !== menuCategory) return false;
        if (q && !String(p.name || "").toLowerCase().includes(q)) return false;
        return true;
      });
      productsEl.innerHTML = "";
      for (const product of list) productsEl.appendChild(productRow(product));
      menuEmpty.hidden = list.length > 0;
      menuEmpty.textContent = menu.length === 0
        ? "No active menu items yet — ask an administrator."
        : "No active items match this search or category.";
      if (menuLoaded) {
        menuMsg.textContent = menu.length === 0
          ? "The menu is empty."
          : `Showing ${list.length} of ${menu.length} active item${menu.length === 1 ? "" : "s"}.`;
        menuMsg.className = "dash-msg";
      }
    }

    async function addProduct(product, qty, qtyInput) {
      if (!isEditable() || busyProductId) return;
      clearErr();
      notice = "";
      busyProductId = product.id;
      const row = productsEl.querySelector(`[data-product="${product.id}"]`);
      if (row) {
        row.classList.add("busy");
        row.setAttribute("aria-busy", "true");
        row.querySelectorAll("button, input").forEach((el) => { el.disabled = true; });
      }
      startPending();
      try {
        const data = await addOrderLine(sessionId, product.id, qty);
        if (closed) return;
        bill = data.bill;
        changed = true;
        notice = `${qty} × ${product.name || "item"} added to the bill.`;
        if (qtyInput) qtyInput.value = "1";
      } catch (e) {
        if (!closed) showErr(e.message);
      } finally {
        busyProductId = null;
        endPending();
      }
      if (!closed) {
        paintMenu();
        renderBill();
      }
    }

    async function loadBill() {
      billRetry.hidden = true;
      billMsg.hidden = false;
      billMsg.textContent = "Loading bill…";
      billMsg.className = "dash-msg loading";
      linesEl.innerHTML = "";
      emptyEl.hidden = true;
      totalsEl.hidden = true;
      picker.hidden = true;
      startPending();
      try {
        const data = await getBill(sessionId);
        if (closed) return;
        bill = data.bill;
        renderBill();
      } catch (e) {
        if (closed) return;
        bill = null;
        status.hidden = true;
        billMsg.textContent = e.message;
        billMsg.className = "dash-msg err";
        billRetry.hidden = false;
      } finally {
        endPending();
      }
    }

    async function loadMenu() {
      menuRetry.hidden = true;
      menuLoaded = false;
      menuMsg.textContent = "Loading menu…";
      menuMsg.className = "dash-msg loading";
      menuEmpty.hidden = true;
      startPending();
      try {
        const data = await listMenuProducts();
        if (closed) return;
        menu = Array.isArray(data.products) ? data.products : [];
        menuLoaded = true;
        paintMenu();
      } catch (e) {
        if (closed) return;
        menu = [];
        menuLoaded = false;
        productsEl.innerHTML = "";
        menuMsg.textContent = e.message;
        menuMsg.className = "dash-msg err";
        menuEmpty.hidden = true;
        menuRetry.hidden = false;
      } finally {
        endPending();
      }
    }

    function onKey(e) {
      if (!isTopModal(overlay)) return;
      if (e.key === "Escape") { e.stopPropagation(); requestClose(); return; }
      if (e.key !== "Tab") return;
      const list = Array.from(box.querySelectorAll("button:not(:disabled), input:not(:disabled)"))
        .filter((el) => el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }

    search.addEventListener("input", paintMenu);
    overlay.querySelectorAll(".order-chips .chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        menuCategory = chip.dataset.cat || "";
        overlay.querySelectorAll(".order-chips .chip").forEach((c) => {
          const on = c === chip;
          c.classList.toggle("on", on);
          c.setAttribute("aria-pressed", on ? "true" : "false");
        });
        paintMenu();
      }));
    menuRetry.addEventListener("click", loadMenu);
    billRetry.addEventListener("click", loadBill);
    closeBtn.addEventListener("click", requestClose);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) requestClose(); });
    document.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";

    loadBill();
    loadMenu();
    closeBtn.focus();
  });
}

// ---------------------------------------------------------------------------
// Single-sheet billing dialog (build + show + a11y + payment). Fetches the
// fresh bill from the server so session charge + F&B lines are authoritative.
// ---------------------------------------------------------------------------
function billSheet({ sessionId, tableName = "", customerName = "" }) {
  return new Promise((resolve) => {
    let bill = null;
    let method = "cash";
    let settled = false;
    let closed = false;
    let pending = 0;
    let closeRequested = false;
    let closeValue = false;
    let total = 0;
    let paying = false;

    const overlay = document.createElement("div");
    overlay.className = "dash-modal open bill-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "billTitle");
    overlay.innerHTML =
      '<div class="dash-modal-box sheet bill-box" tabindex="-1">' +
      '<div class="bill-sheet">' +
      '<p class="dash-modal-title" id="billTitle">Collect payment</p>' +
      '<p class="bill-sub"></p>' +
      '<p class="dash-msg" id="billLoadMsg" role="status">Loading bill…</p>' +
      '<div id="billPay" hidden>' +
      '<div class="bill-items" id="billItems" hidden></div>' +
      '<div class="bill-summary">' +
      '<span class="bs-row" id="billSessionRow"><span>Session charge</span><strong data-r="session"></strong></span>' +
      '<span class="bs-row" id="billFnbRow" hidden><span>F&amp;B subtotal</span><strong data-r="fnb"></strong></span>' +
      '<span class="bs-row total"><span>Total due</span><strong data-r="total"></strong></span>' +
      '<span class="bs-row"><span>Method</span><strong data-r="method">Cash</strong></span>' +
      '<span class="bs-row"><span>Received</span><strong data-r="received">—</strong></span>' +
      '<span class="bs-row total"><span>Change</span><strong data-r="change">—</strong></span>' +
      "</div>" +
      '<span class="field-label">Payment method</span>' +
      '<div class="bill-methods" role="group" aria-label="Payment method">' +
      '<button type="button" class="chip on" data-m="cash" aria-pressed="true">Cash</button>' +
      '<button type="button" class="chip" data-m="gcash" aria-pressed="false">GCash</button>' +
      "</div>" +
      '<label class="field" for="billAmount"><span class="field-label">Amount received (₱)</span>' +
      '<input id="billAmount" name="amount" type="text" inputmode="decimal" autocomplete="off" /></label>' +
      '<p class="bill-change" id="billChangeLine" role="status"></p>' +
      '<p class="dash-msg err" id="billErr" role="alert" hidden></p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" id="billCancel">Cancel</button>' +
      '<button type="button" class="btn btn-solid" id="billConfirm" disabled>Confirm payment</button>' +
      "</div></div>" +
      '<div class="bill-state" id="billState" hidden>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" id="billStateRetry" hidden>Retry</button>' +
      '<a class="btn btn-solid" id="billStateReceipt" target="_blank" rel="noopener" hidden>Open receipt</a>' +
      '<button type="button" class="btn btn-ghost" id="billStateClose">Close</button>' +
      "</div></div>" +
      "</div></div>";
    document.body.appendChild(overlay);

    const box = overlay.querySelector(".dash-modal-box");
    const sub = overlay.querySelector(".bill-sub");
    const titleEl = overlay.querySelector("#billTitle");
    const loadMsg = overlay.querySelector("#billLoadMsg");
    const pay = overlay.querySelector("#billPay");
    const itemsEl = overlay.querySelector("#billItems");
    const rSessionRow = overlay.querySelector("#billSessionRow");
    const rFnbRow = overlay.querySelector("#billFnbRow");
    const rSession = overlay.querySelector('[data-r="session"]');
    const rFnb = overlay.querySelector('[data-r="fnb"]');
    const rTotal = overlay.querySelector('[data-r="total"]');
    const rMethod = overlay.querySelector('[data-r="method"]');
    const rReceived = overlay.querySelector('[data-r="received"]');
    const rChange = overlay.querySelector('[data-r="change"]');
    const input = overlay.querySelector("#billAmount");
    const changeLine = overlay.querySelector("#billChangeLine");
    const err = overlay.querySelector("#billErr");
    const confirmBtn = overlay.querySelector("#billConfirm");
    const cancelBtn = overlay.querySelector("#billCancel");
    const state = overlay.querySelector("#billState");
    const stateRetry = overlay.querySelector("#billStateRetry");
    const stateReceipt = overlay.querySelector("#billStateReceipt");
    const stateClose = overlay.querySelector("#billStateClose");
    sub.textContent = `${tableName || "Session"} · ${customerName || "Customer"}`;

    const lastFocus = document.activeElement;
    function finalize(value) {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      restoreBodyScroll();
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch { /* gone */ } }
      resolve(value);
    }
    function endPending() {
      pending = Math.max(0, pending - 1);
      if (pending === 0 && closeRequested) finalize(closeValue);
    }
    function requestClose(value) {
      closeValue = value;
      if (pending > 0) { closeRequested = true; return; }
      finalize(value);
    }
    function showState(message, kind = "err", { retry = false, receiptRef = null, title = "Collect payment" } = {}) {
      titleEl.textContent = title;
      pay.hidden = true;
      state.hidden = false;
      loadMsg.hidden = false;
      loadMsg.textContent = message;
      loadMsg.className = `dash-msg ${kind}`.trim();
      stateRetry.hidden = !retry;
      stateReceipt.hidden = !receiptRef;
      if (receiptRef) {
        stateReceipt.href = `../shared/receipt.html?ref=${encodeURIComponent(receiptRef)}`;
      }
      stateClose.focus();
    }

    function renderItems(items) {
      itemsEl.innerHTML = "";
      if (!items.length) {
        itemsEl.hidden = true;
        return;
      }
      itemsEl.hidden = false;
      for (const item of items) {
        const row = document.createElement("div");
        row.className = "bill-item";
        const name = document.createElement("span");
        name.className = "bi-name";
        name.textContent = item.name || "Item";
        const meta = document.createElement("span");
        meta.className = "bi-meta";
        meta.textContent = `${item.qty} × ${peso2(item.unitPrice)}`;
        const line = document.createElement("strong");
        line.className = "bi-total";
        line.textContent = peso2(item.lineTotal);
        row.append(name, meta, line);
        itemsEl.appendChild(row);
      }
    }

    function refresh() {
      if (!bill) {
        confirmBtn.disabled = true;
        return;
      }
      const received = Number(String(input.value).replace(/[^0-9.]/g, ""));
      rTotal.textContent = peso2(total);
      rMethod.textContent = method === "gcash" ? "GCash" : "Cash";
      rReceived.textContent = received > 0 ? peso2(received) : "—";
      if (!(received > 0)) {
        rChange.textContent = "—";
        changeLine.textContent = "Enter the amount received.";
        changeLine.classList.remove("short");
        confirmBtn.disabled = true;
      } else if (received < total) {
        const short = roundMoney(total - received);
        rChange.textContent = `short ${peso2(short)}`;
        changeLine.textContent = `Short ${peso2(short)} — the amount received must cover the total.`;
        changeLine.classList.add("short");
        confirmBtn.disabled = true;
      } else {
        const change = roundMoney(received - total);
        rChange.textContent = peso2(change);
        changeLine.textContent = `Change to give back: ${peso2(change)}`;
        changeLine.classList.remove("short");
        confirmBtn.disabled = false;
      }
    }

    function renderPayable() {
      const items = Array.isArray(bill.items) ? bill.items : [];
      total = Number(bill.total);
      if (!Number.isFinite(total) || total <= 0) {
        showState("The server returned an invalid bill total. Close and retry from To bill.", "err", { retry: true });
        return;
      }
      loadMsg.hidden = true;
      state.hidden = true;
      pay.hidden = false;
      titleEl.textContent = "Collect payment";
      renderItems(items);
      rSessionRow.hidden = false;
      rSession.textContent = peso2(bill.sessionTotal);
      rFnbRow.hidden = !(Number(bill.fnbTotal) > 0);
      rFnb.textContent = peso2(bill.fnbTotal);
      const full = `${tableName || bill.session.tableName || "Session"} · ${customerName || bill.session.customerName || "Customer"}`;
      sub.textContent = full;
      input.value = total.toFixed(2);
      refresh();
      input.focus();
      input.select();
    }

    async function loadBill() {
      bill = null;
      pay.hidden = true;
      state.hidden = true;
      loadMsg.hidden = false;
      loadMsg.textContent = "Loading bill…";
      loadMsg.className = "dash-msg loading";
      confirmBtn.disabled = true;
      pending += 1;
      try {
        const data = await getBill(sessionId);
        if (closed) return;
        bill = data.bill;
        if (bill.session.finalized) {
          settled = true;
          const ref = bill.session.paidRef || "";
          showState(
            `This bill was already paid${ref ? ` (${ref})` : ""}. No further changes are possible.`,
            "ok",
            { receiptRef: ref || null, title: "Bill already paid" }
          );
          return;
        }
        if (bill.session.status !== "closed") {
          showState("End the session before collecting payment. F&B items can still be changed from Orders.", "err");
          return;
        }
        renderPayable();
      } catch (e) {
        if (closed) return;
        showState(e.message, "err", { retry: true });
      } finally {
        pending = Math.max(0, pending - 1);
        if (pending === 0 && closeRequested) finalize(closeValue);
      }
    }

    function successView(t) {
      const paidTotal = Number(t.total != null ? t.total : total);
      const sessionPaid = Number(t.sessionTotal != null ? t.sessionTotal : paidTotal);
      const fnbPaid = Number(t.fnbTotal != null ? t.fnbTotal : 0);
      const receiptRef = t.ref || "";
      titleEl.textContent = "Payment recorded";
      pay.innerHTML =
        '<div class="bill-done">' +
        '<span class="bill-ok" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 13l4 4L19 7" /></svg></span>' +
        '<div class="bill-summary">' +
        '<span class="bs-row"><span>Reference</span><strong data-d="ref"></strong></span>' +
        '<span class="bs-row"><span>Table</span><strong data-d="table"></strong></span>' +
        '<span class="bs-row"><span>Method</span><strong data-d="method"></strong></span>' +
        '<span class="bs-row"><span>Session charge</span><strong data-d="session"></strong></span>' +
        (fnbPaid > 0 ? '<span class="bs-row"><span>F&amp;B subtotal</span><strong data-d="fnb"></strong></span>' : "") +
        '<span class="bs-row"><span>Total</span><strong data-d="total"></strong></span>' +
        '<span class="bs-row total"><span>Paid / Change</span><strong data-d="paid"></strong></span>' +
        "</div>" +
        '<div class="modal-actions">' +
        '<button type="button" class="btn btn-ghost" id="billDone">Done</button>' +
        '<a class="btn btn-solid" id="billReceipt" target="_blank" rel="noopener">Open receipt</a>' +
        "</div></div>";
      pay.hidden = false;
      state.hidden = true;
      loadMsg.hidden = true;
      const set = (key, value) => {
        const el = pay.querySelector(`[data-d="${key}"]`);
        if (el) el.textContent = value;
      };
      set("ref", t.ref || "—");
      set("table", tableName || "—");
      set("method", (t.method || method) === "gcash" ? "GCash" : "Cash");
      set("session", peso2(sessionPaid));
      set("fnb", peso2(fnbPaid));
      set("total", peso2(paidTotal));
      set("paid", `${peso2(t.received)} / ${peso2(t.change)}`);
      const done = pay.querySelector("#billDone");
      const receipt = pay.querySelector("#billReceipt");
      receipt.href = `../shared/receipt.html?ref=${encodeURIComponent(receiptRef)}`;
      settled = true;
      closeValue = true;
      done.addEventListener("click", () => requestClose(true));
      receipt.addEventListener("click", () => requestClose(true));
      done.focus();
      loadSessions(true);
      loadBilling(true);
      dashToast(`${peso2(paidTotal)} collected · ref ${t.ref} · change ${peso2(t.change)}.`, "ok", { title: "Payment recorded" });
    }

    function onKey(e) {
      if (!isTopModal(overlay)) return;
      if (e.key === "Escape") { e.stopPropagation(); if (paying) return; requestClose(settled); return; }
      if (e.key !== "Tab") return;
      const list = Array.from(box.querySelectorAll("button:not(:disabled), input:not(:disabled), a[href]"))
        .filter((el) => el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
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
    cancelBtn.addEventListener("click", () => requestClose(false));
    stateClose.addEventListener("click", () => requestClose(settled));
    stateRetry.addEventListener("click", loadBill);
    overlay.addEventListener("click", (e) => {
      if (e.target !== overlay || paying) return;
      requestClose(settled);
    });
    stateReceipt.addEventListener("click", () => requestClose(true));

    confirmBtn.addEventListener("click", async () => {
      const received = Number(String(input.value).replace(/[^0-9.]/g, ""));
      if (!(received > 0) || received > 1000000) {
        err.textContent = `Enter an amount between ₱0.01 and ₱1,000,000.00 (got "${input.value}").`;
        err.hidden = false;
        input.focus();
        return;
      }
      if (received < total) {
        err.textContent = `Short payment: received ${peso2(received)} < total ${peso2(total)}.`;
        err.hidden = false;
        input.focus();
        return;
      }
      err.hidden = true;
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      confirmBtn.classList.add("busy");
      paying = true;
      pending += 1;
      try {
        const { transaction: t } = await createTransaction(sessionId, method, received);
        if (closed) return;
        successView(t);
      } catch (e2) {
        if (closed) return;
        confirmBtn.classList.remove("busy");
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        err.textContent = e2.message;
        err.hidden = false;
      } finally {
        paying = false;
        pending = Math.max(0, pending - 1);
        if (pending === 0 && closeRequested) finalize(closeValue);
      }
    });

    document.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    loadBill();
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
    tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td><td></td><td></td>";
    tr.children[0].textContent = s.tableName || "—";
    tr.children[1].textContent = s.customerName || "—";
    tr.children[2].textContent = fmtClock(s.startTime);
    tr.children[3].textContent = fmtClock(s.endTime);
    tr.children[4].appendChild(timer);
    fnbCell(tr.children[5], s);
    const act = tr.children[6];
    act.classList.add("actions-cell");

    const orders = document.createElement("button");
    orders.textContent = "Orders";
    orders.className = "rowbtn";
    orders.title = "Add or change food and beverage items";
    orders.onclick = async () => {
      const changed = await orderSheet({
        sessionId: s.id,
        tableName: s.tableName,
        customerName: s.customerName,
      });
      if (changed) {
        loadSessions(true);
        loadBilling(true);
      }
    };

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
        const sessionAmount = Number(r.amount !== undefined ? r.amount : 0);
        const combined = roundMoney(sessionAmount + Number(s.fnbTotal || 0));
        setSessMsg(`Session ended. Charge ${peso2(combined)} including F&B — collecting payment…`, "ok");
        loadSessions(true);
        const paid = await billSheet({
          sessionId: s.id,
          tableName: s.tableName,
          customerName: s.customerName,
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
        `Void this session on ${s.tableName || "this table"}? Use only for mistakes — it frees the table without billing. Any F&B lines are discarded and never charged.`,
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
    act.append(orders, ex, end, vd);
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
    dashSkeleton(document.querySelector("#sessTbl tbody"), 7, 3);
  }
  try {
    const { sessions } = await listCashierSessions("active");
    const n = paintSessions(sessions || []);
    setSessMsg(`Showing ${n} active ${n === 1 ? "session" : "sessions"}.`, "ok");
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
    dashSkeleton(billBody, 5, 3);
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
        : `${unbilled.length} closed ${unbilled.length === 1 ? "session" : "sessions"} awaiting payment.`,
      unbilled.length === 0 ? "ok" : ""
    );
    for (const s of unbilled.slice(0, 20)) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td>";
      tr.children[0].textContent = s.tableName || "—";
      tr.children[1].textContent = s.customerName || "—";
      fnbCell(tr.children[2], s);
      tr.children[3].textContent = peso2(estimateBillTotal(s));
      tr.children[3].classList.add("num");
      const act = tr.children[4];
      act.classList.add("actions-cell");

      const orders = document.createElement("button");
      orders.textContent = "Orders";
      orders.className = "rowbtn";
      orders.title = "Add or change F&B before payment";
      orders.onclick = async () => {
        const changed = await orderSheet({
          sessionId: s.id,
          tableName: s.tableName,
          customerName: s.customerName,
        });
        if (changed) {
          loadBilling(true);
          loadSessions(true);
        }
      };

      const btn = document.createElement("button");
      btn.textContent = "Bill";
      btn.className = "rowbtn gold";
      btn.onclick = async () => {
        const paid = await billSheet({
          sessionId: s.id,
          tableName: s.tableName,
          customerName: s.customerName,
        });
        if (paid) {
          loadBilling(true);
          loadSessions(true);
        }
      };
      act.append(orders, btn);
      billBody.appendChild(tr);
    }
    paidBody.innerHTML = "";
    for (const t of (transactions || []).slice(0, 10)) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td><td></td>";
      tr.children[0].textContent = t.ref || "—";
      tr.children[1].textContent = t.customerName || "—";
      tr.children[2].textContent = peso2(t.total);
      tr.children[2].classList.add("num");
      tr.children[2].title = `Session ${peso2(t.sessionTotal)} · F&B ${peso2(t.fnbTotal)}`;
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
    setSessionExpiryHandler(() => refreshSessions(true));
    ensureCashierTick();
    refreshSessions(false);
    startCashierPolling(refreshSessions);
  } catch {
    location.href = "../auth/login.html";
  }
})();
