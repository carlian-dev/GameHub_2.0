// src/function/cashiers/cashier-tables.js - Tables page logic.
// Pair: cashier-tables.html. Read-only live statuses (CA-003/CA-017) with the
// All / Available / Occupied / Reserved filter. Shared guard in
// cashier-common.js. Refresh: server truth every 30s.
let cashierTab = "all";

function setTablesMsg(t) {
  const el = document.getElementById("tablesMsg");
  if (el) el.textContent = t;
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
  if (!quiet) setTablesMsg("Loading...");
  try {
    const { tables } = await listCashierTables(cashierTab);
    setTablesMsg(`${paintCashierTables(tables || [])} shown (${cashierTab}).`);
    stampTables();
  } catch (e) {
    setTablesMsg(e.message);
  }
}

document.querySelectorAll("[data-t]").forEach((b) =>
  b.addEventListener("click", () => {
    cashierTab = b.dataset.t;
    document.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x === b));
    loadCashierTables();
  }));

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
