// src/function/cashiers/cashier-tables.js - Tables page logic.
// Pair: cashier-tables.html. Read-only live statuses (CA-003/CA-017) with the
// All / Available / Occupied / Reserved filter. Shared guard in
// cashier-common.js. Refresh: server truth every 30s.
let cashierTab = "all";

function setTablesMsg(t, kind = "") {
  const el = document.getElementById("tablesMsg");
  if (!el) return;
  el.textContent = t;
  el.className = `dash-msg${kind ? " " + kind : ""}`;
}

function stampTables() {
  const el = document.getElementById("tablesUpdated");
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString()} · auto-refresh 30s`;
}

function paintCashierTables(list) {
  const tb = document.querySelector("#cashierTbl tbody");
  if (!tb) return 0;
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
  if (!quiet) {
    setTablesMsg("Loading…", "loading");
    dashSkeleton(document.querySelector("#cashierTbl tbody"), 2, 4);
  }
  try {
    const { tables } = await listCashierTables(cashierTab);
    const n = paintCashierTables(tables || []);
    setTablesMsg(`${n} shown (${cashierTab}).`, "ok");
    const empty = document.getElementById("tablesEmpty");
    if (empty) empty.hidden = n > 0;
    stampTables();
  } catch (e) {
    setTablesMsg(e.message, "err");
    const empty = document.getElementById("tablesEmpty");
    if (empty) { empty.hidden = false; empty.textContent = "Couldn't load tables — refresh to retry."; }
  }
}

// Accessible tab strip: click + arrow keys, aria-selected, tabpanel labelledby.
dashTabsInit((t) => { cashierTab = t; loadCashierTables(); });

(async () => {
  try {
    await cashierGuard();
    bindCashierLogout();
    loadCashierTables(false);
    startCashierPolling(loadCashierTables);
  } catch {
    location.href = "../auth/login.html";
  }
})();
