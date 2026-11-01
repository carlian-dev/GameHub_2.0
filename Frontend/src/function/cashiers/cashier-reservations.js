// src/function/cashiers/cashier-reservations.js - Reservations page logic.
// Pair: cashier-reservations.html. Lists guest reservation requests and lets a
// cashier accept or reject the pending ones (CA reservation approval):
// POST /api/cashier/reservations/:ref/accept|reject. Accepted requests keep
// blocking the table slot; rejected ones release it. Shared guard/logout in
// cashier-common.js. Refresh: server truth every 30s.

// Server status -> badge styling / human label. Badge classes reuse the
// dashboard palette (pending = gold, available = green, declined = red).
const RES_BADGE = { reserved: "pending", accepted: "available", rejected: "declined", cancelled: "archived" };
const RES_LABEL = { reserved: "Pending", accepted: "Accepted", rejected: "Rejected", cancelled: "Cancelled" };

function setResMsg(t, kind = "") {
  const el = document.getElementById("resMsg");
  if (!el) return;
  el.textContent = t;
  el.className = `dash-msg${kind ? " " + kind : ""}`;
}

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d)
    ? "—"
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function decideReservation(r, mode) {
  const verb = mode === "accept" ? "Accept" : "Reject";
  const yes = await dashConfirm(
    mode === "accept"
      ? `Accept reservation ${r.ref} for ${r.customerName} on ${r.tableName}? The table slot stays booked for them.`
      : `Reject reservation ${r.ref} for ${r.customerName}? The table slot is released for other customers.`,
    `${verb} reservation`
  );
  if (!yes) return;
  try {
    if (mode === "accept") await acceptReservation(r.ref);
    else await rejectReservation(r.ref);
    dashToast(
      `Reservation ${r.ref} ${mode === "accept" ? "accepted" : "rejected"}.`,
      "ok",
      { title: mode === "accept" ? "Reservation accepted" : "Reservation rejected" }
    );
    loadReservations(true);
  } catch (e) {
    setResMsg(e.message, "err");
    dashToast(e.message, "err", { title: `${verb} failed` });
  }
}

function paintReservations(list) {
  const tb = document.querySelector("#resTbl tbody");
  if (!tb) return 0;
  tb.innerHTML = "";
  // Pending first (that is the work queue), then soonest start time.
  const rows = [...list].sort((a, b) => {
    const ap = a.status === "reserved" ? 0 : 1;
    const bp = b.status === "reserved" ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return new Date(a.startTime || 0) - new Date(b.startTime || 0);
  });
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>";
    tr.children[0].textContent = r.ref || "—";
    tr.children[1].textContent = r.tableName || "—";
    tr.children[2].textContent = r.customerName || "—";
    tr.children[3].textContent = r.contactNumber || "—";
    tr.children[4].textContent = fmtWhen(r.startTime);
    tr.children[5].textContent = fmtWhen(r.endTime);

    const badge = document.createElement("span");
    badge.className = `badge ${RES_BADGE[r.status] || "archived"}`;
    badge.textContent = RES_LABEL[r.status] || r.status || "—";
    tr.children[6].appendChild(badge);

    // Only a pending request can be decided; decided ones show a dash.
    if (r.status === "reserved") {
      const ok = document.createElement("button");
      ok.className = "rowbtn go";
      ok.textContent = "Accept";
      ok.onclick = () => decideReservation(r, "accept");
      const no = document.createElement("button");
      no.className = "rowbtn danger";
      no.textContent = "Reject";
      no.onclick = () => decideReservation(r, "reject");
      tr.children[7].append(ok, no);
    } else {
      tr.children[7].textContent = "—";
    }
    tb.appendChild(tr);
  }
  const empty = document.getElementById("resEmpty");
  if (empty) empty.hidden = rows.length > 0;
  return rows.length;
}

async function loadReservations(quiet = false) {
  const tbody = document.querySelector("#resTbl tbody");
  if (!quiet) {
    setResMsg("Loading…", "loading");
    dashSkeleton(tbody, 8, 3);
  }
  try {
    const { reservations } = await listCashierReservations();
    const rows = reservations || [];
    const n = paintReservations(rows);
    const pending = rows.filter((r) => r.status === "reserved").length;
    setResMsg(
      pending > 0
        ? `${pending} request(s) waiting for approval · ${n} reservation(s) total.`
        : `No requests waiting · ${n} reservation(s) total.`,
      "ok"
    );
    dashStamp(document.getElementById("resStamp"));
  } catch (e) {
    setResMsg(e.message, "err");
    const empty = document.getElementById("resEmpty");
    if (empty) { empty.hidden = false; empty.textContent = "Couldn't load reservations — refresh to retry."; }
  }
}

(async () => {
  try {
    await cashierGuard();
    bindCashierLogout();
    loadReservations(false);
    startCashierPolling(loadReservations);
  } catch {
    location.href = "../auth/login.html";
  }
})();
