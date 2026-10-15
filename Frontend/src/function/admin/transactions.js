// src/function/admin/transactions.js - bills + daily income logic.
// Pair: transactions.html <-> Backend transactions_admin_list + reports_daily/export.
// Guard: admin-only. Filter: ?from&to&method (AD-023). Daily card follows the
// From date (or today UTC). Export downloads CSV via anchor URL (cookies sent,
// not api() JSON) so the file saves instead of parsing as JSON.
function fmtPeso(n) {
  const v = Number(n || 0);
  return `₱${v.toFixed(2)}`;
}

function fmtPaid(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function paintTransactions(list) {
  const tb = document.querySelector("#tbl tbody");
  tb.innerHTML = "";
  for (const t of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>`;
    tr.children[0].textContent = t.ref || "—";
    tr.children[1].textContent = fmtPaid(t.paidAt);
    tr.children[2].textContent = t.tableName || "—";
    tr.children[3].textContent = t.customerName || "—";
    tr.children[4].textContent = fmtPeso(t.total);
    const badge = document.createElement("span");
    badge.className = `badge ${t.method === "gcash" ? "reserved" : "available"}`;
    badge.textContent = t.method || "—";
    tr.children[5].appendChild(badge);
    tr.children[6].textContent = fmtPeso(t.change);
    const link = document.createElement("a");
    link.href = `../shared/receipt.html?ref=${encodeURIComponent(t.ref || "")}`;
    link.textContent = "Print";
    link.target = "_blank";
    link.rel = "noopener";
    tr.children[7].appendChild(link);
    tb.appendChild(tr);
  }
  document.getElementById("empty").hidden = list.length > 0;
  return list.length;
}

function currentFilter() {
  return {
    from: document.getElementById("fFrom").value,
    to: document.getElementById("fTo").value,
    method: document.getElementById("fMethod").value || "all",
  };
}

async function loadDaily() {
  const { from } = currentFilter();
  const day = from || new Date().toISOString().slice(0, 10);
  try {
    const r = await getDailyReport(day);
    document.getElementById("incGross").textContent = fmtPeso(r.gross);
    document.getElementById("incCount").textContent = `${r.count} payment(s) on ${r.date}`;
    document.getElementById("incCash").textContent = fmtPeso(r.byMethod.cash.gross);
    document.getElementById("incCashCount").textContent = `${r.byMethod.cash.count} cash`;
    document.getElementById("incGcash").textContent = fmtPeso(r.byMethod.gcash.gross);
    document.getElementById("incGcashCount").textContent = `${r.byMethod.gcash.count} gcash`;
  } catch (e) {
    document.getElementById("incGross").textContent = "–";
    document.getElementById("incCount").textContent = e.message;
  }
}

async function loadTransactions() {
  const msg = document.getElementById("msg");
  msg.textContent = "Loading...";
  try {
    const f = currentFilter();
    const params = {};
    if (f.from) params.from = f.from;
    if (f.to) params.to = f.to;
    if (f.method && f.method !== "all") params.method = f.method;
    const { transactions } = await listTransactions(params, true);
    msg.textContent = `${paintTransactions(transactions || [])} transaction(s) shown.`;
  } catch (e) {
    msg.textContent = e.message;
  }
  loadDaily();
}

document.getElementById("apply").addEventListener("click", loadTransactions);

document.getElementById("export").addEventListener("click", () => {
  // CSV download: anchor navigation keeps the session cookie (credentials),
  // while api() would try to parse the CSV as JSON and fail.
  const f = currentFilter();
  const url = exportReportUrl({ from: f.from, to: f.to, method: f.method });
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
});

(async () => {
  const msg = document.getElementById("msg");
  try {
    const me = await getMe();
    if (me.role !== "admin") { location.href = "../auth/login.html"; return; }
    const name = me.email || "admin";
    document.getElementById("who").textContent = name;
    document.getElementById("avatar").textContent = name.charAt(0).toUpperCase();
    await loadTransactions();
  } catch (e) {
    if (String(e.message || "").includes("401") || String(e.message || "").includes("not logged")) {
      location.href = "../auth/login.html";
    } else {
      msg.textContent = e.message;
    }
  }
})();
document.getElementById("out").addEventListener("click", async () => {
  await logout(); location.href = "../auth/login.html";
});
