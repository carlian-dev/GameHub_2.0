// src/function/cashiers/cashier-reservations.js - Reservations approval queue.
// Pair: cashier-reservations.html. Pending guest requests are accepted (slot
// stays booked + the customer gets an ACCEPTED email) or rejected (slot is
// released). Shared guard/logout in cashier-common.js; refresh every 30s.

const RES_BADGE = {
  reserved: "pending",
  accepted: "available",
  rejected: "declined",
  cancelled: "archived",
};
const RES_LABEL = {
  reserved: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const RES_FILTERS = {
  pending: (r) => r.status === "reserved",
  all: () => true,
  accepted: (r) => r.status === "accepted",
  rejected: (r) => r.status === "rejected",
};
const RES_EMPTY = {
  pending: "All caught up — no requests waiting. New guest bookings show up here automatically.",
  all: "No reservations yet. Guest bookings from the landing page show up here.",
  accepted: "No accepted reservations yet.",
  rejected: "No rejected reservations yet.",
};

const resState = { rows: [], filter: "pending" };

function setResMsg(t, kind = "") {
  const node = document.getElementById("resMsg");
  if (!node) return;
  node.textContent = t;
  node.className = `dash-msg${kind ? " " + kind : ""}`;
}

function fmtDay(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d)
    ? "—"
    : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function resClock(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtTimeRange(r) {
  if (!r.startTime || !r.endTime) return "—";
  return `${resClock(r.startTime)} – ${resClock(r.endTime)}`;
}

function durationLabel(r) {
  let minutes = Number(r.durationMinutes || 0);
  if (!minutes && r.startTime && r.endTime) {
    minutes = Math.round((new Date(r.endTime) - new Date(r.startTime)) / 60000);
  }
  if (!minutes) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} hr ${rest} min`;
  if (hours) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${rest} min`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function contactLine(r) {
  const p = el("p", "res-card-contact");
  if (r.customerEmail) {
    const mail = el("a", "", r.customerEmail);
    mail.href = `mailto:${r.customerEmail}`;
    p.appendChild(mail);
  } else {
    p.appendChild(el("span", "res-card-noemail", "No email on file"));
  }
  if (r.contactNumber) {
    p.appendChild(el("span", "res-card-sep", "·"));
    const tel = el("a", "", r.contactNumber);
    tel.href = `tel:${r.contactNumber.replace(/[^\d+]/g, "")}`;
    p.appendChild(tel);
  }
  return p;
}

function whenGrid(r) {
  const grid = el("div", "res-card-when");
  [
    ["Table", r.tableName || "—"],
    ["Date", fmtDay(r.startTime)],
    ["Time", fmtTimeRange(r)],
    ["Duration", durationLabel(r)],
  ].forEach(([label, value]) => {
    const cell = el("div", "res-card-cell");
    cell.append(el("span", "", label), el("strong", "", value));
    grid.appendChild(cell);
  });
  return grid;
}

function buildCard(r) {
  const card = el("article", `res-card status-${r.status || "reserved"}`);
  card.dataset.ref = r.ref || "";

  const head = el("div", "res-card-head");
  const badge = el("span", `badge ${RES_BADGE[r.status] || "archived"}`, RES_LABEL[r.status] || r.status || "—");
  head.append(badge, el("span", "res-card-ref", r.ref || "—"));

  const name = el("h3", "res-card-name", r.customerName || "—");
  const booked = el(
    "p",
    "res-card-booked",
    r.createdAt ? `Requested ${new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""
  );

  const foot = el("div", "res-card-foot");
  const actions = el("div", "res-card-actions");

  if (r.status === "reserved") {
    const accept = el("button", "res-btn res-btn-accept", "Accept");
    accept.type = "button";
    accept.onclick = () => decideReservation(r, "accept", card);
    const reject = el("button", "res-btn res-btn-reject", "Reject");
    reject.type = "button";
    reject.onclick = () => decideReservation(r, "reject", card);
    actions.append(accept, reject);
  } else {
    actions.appendChild(
      el(
        "span",
        "res-card-decision",
        r.status === "accepted" ? "Slot kept for this guest" : "Slot released"
      )
    );
  }

  foot.append(booked, actions);
  card.append(head, name, contactLine(r), whenGrid(r), foot);
  return card;
}

function updateCounts() {
  const counts = {
    pending: 0,
    accepted: 0,
    rejected: 0,
    all: resState.rows.length,
  };
  for (const r of resState.rows) {
    if (r.status === "reserved") counts.pending += 1;
    else if (r.status === "accepted") counts.accepted += 1;
    else if (r.status === "rejected") counts.rejected += 1;
  }
  const set = (id, n) => {
    const node = document.getElementById(id);
    if (node) node.textContent = String(n);
  };
  set("resPendingCount", counts.pending);
  set("resAllCount", counts.all);
  set("resAcceptedCount", counts.accepted);
  set("resRejectedCount", counts.rejected);
}

function syncFilterTabs() {
  document.querySelectorAll("[data-filter]").forEach((btn) => {
    const on = btn.dataset.filter === resState.filter;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function renderSkeleton() {
  const list = document.getElementById("resList");
  if (!list) return;
  const empty = document.getElementById("resEmpty");
  if (empty) empty.hidden = true;
  list.innerHTML = "";
  for (let i = 0; i < 3; i += 1) {
    const card = el("div", "res-card res-skel");
    card.setAttribute("aria-hidden", "true");
    ["w35", "w60", "w80", "w50"].forEach((w) => {
      const line = el("span", `sk-bar res-skel-line ${w}`);
      card.appendChild(line);
    });
    list.appendChild(card);
  }
}

function renderList() {
  const list = document.getElementById("resList");
  const empty = document.getElementById("resEmpty");
  if (!list) return;
  list.innerHTML = "";

  const filter = RES_FILTERS[resState.filter] || RES_FILTERS.all;
  const rows = resState.rows.filter(filter).sort((a, b) => {
    const ap = a.status === "reserved" ? 0 : 1;
    const bp = b.status === "reserved" ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return new Date(a.startTime || 0) - new Date(b.startTime || 0);
  });

  if (!rows.length) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = RES_EMPTY[resState.filter] || RES_EMPTY.all;
    }
    return;
  }

  if (empty) empty.hidden = true;
  const frag = document.createDocumentFragment();
  rows.forEach((r) => frag.appendChild(buildCard(r)));
  list.appendChild(frag);
}

function updateSummaryMessage() {
  const pending = resState.rows.filter((r) => r.status === "reserved").length;
  const total = resState.rows.length;
  setResMsg(
    pending > 0
      ? `${pending} request${pending === 1 ? "" : "s"} waiting for approval · ${total} reservation${total === 1 ? "" : "s"} total.`
      : `All caught up — no requests waiting · ${total} reservation${total === 1 ? "" : "s"} total.`,
    pending > 0 ? "" : "ok"
  );
}

async function decideReservation(r, mode, card) {
  const isAccept = mode === "accept";
  const verb = isAccept ? "Accept" : "Reject";
  const emailNote = r.customerEmail
    ? ` A confirmation email will be sent to ${r.customerEmail}.`
    : " This guest has no email on file, so no notification will be sent.";
  const message = isAccept
    ? `Accept reservation ${r.ref} for ${r.customerName} on ${r.tableName}? The table slot stays booked for them.${emailNote}`
    : `Reject reservation ${r.ref} for ${r.customerName}? The table slot is released for other customers.`;

  const yes = await dashConfirm(message, `${verb} reservation`);
  if (!yes) return;

  card.classList.add("is-busy");
  card.querySelectorAll("button").forEach((btn) => {
    btn.disabled = true;
  });

  try {
    if (isAccept) {
      const result = await acceptReservation(r.ref);
      if (result.notified) {
        dashToast(`Confirmation email sent to ${r.customerEmail}.`, "ok", {
          title: "Reservation accepted",
        });
      } else if (r.customerEmail) {
        dashToast(
          `Accepted, but the notification to ${r.customerEmail} could not be sent. Check the MAIL settings.`,
          "info",
          { title: "Reservation accepted" }
        );
      } else {
        dashToast("Accepted. No customer email is on file.", "info", {
          title: "Reservation accepted",
        });
      }
    } else {
      await rejectReservation(r.ref);
      dashToast(`Reservation ${r.ref} rejected.`, "ok", { title: "Reservation rejected" });
    }
    // Reflect the decision immediately; the server refresh is best-effort.
    const updated = resState.rows.find((x) => x.ref === r.ref);
    if (updated) updated.status = isAccept ? "accepted" : "rejected";
    updateCounts();
    renderList();
    updateSummaryMessage();
    await loadReservations(true);
  } catch (e) {
    card.classList.remove("is-busy");
    card.querySelectorAll("button").forEach((btn) => {
      btn.disabled = false;
    });
    setResMsg(e.message, "err");
    dashToast(e.message, "err", { title: `${verb} failed` });
  }
}

async function loadReservations(quiet = false) {
  if (!quiet) {
    setResMsg("Loading…", "loading");
    renderSkeleton();
  }
  try {
    const { reservations } = await listCashierReservations();
    resState.rows = reservations || [];
    updateCounts();
    renderList();
    updateSummaryMessage();
    dashStamp(document.getElementById("resStamp"));
  } catch (e) {
    setResMsg(e.message, "err");
    if (!resState.rows.length) {
      const empty = document.getElementById("resEmpty");
      if (empty) {
        empty.hidden = false;
        empty.textContent = "Couldn't load reservations — refresh to retry.";
      }
      const list = document.getElementById("resList");
      if (list) list.innerHTML = "";
    }
  }
}

function initFilters() {
  const tabs = Array.from(document.querySelectorAll("[data-filter]"));
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      resState.filter = btn.dataset.filter || "pending";
      syncFilterTabs();
      renderList();
    });
  });
}

(async () => {
  try {
    await cashierGuard();
    bindCashierLogout();
    initFilters();
    syncFilterTabs();
    loadReservations(false);
    startCashierPolling(loadReservations);
  } catch {
    location.href = "../auth/login.html";
  }
})();
