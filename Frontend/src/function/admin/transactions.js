// src/function/admin/transactions.js - bills + daily income logic.
// Pair: transactions.html <-> Backend transactions_admin_list + reports_daily/export.
// Guard: admin-only. Filter form: ?from&to&method (AD-023), Enter applies.
// Daily income card follows the From date (or today). Table = client-side
// pagination (10/page), proper method badges, "Updated" stamp + skeletons.
// Export downloads CSV via anchor URL (cookies sent, not api() JSON) so the
// file saves instead of parsing as JSON.

let allRows = [];
let page = 0;
const PER_PAGE = 10;

function fmtPeso(n) {
  const v = Number(n || 0);
  return `₱${v.toFixed(2)}`;
}

function fmtPaid(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderPage() {
  const tb = document.querySelector("#tbl tbody");
  tb.innerHTML = "";
  const start = page * PER_PAGE;
  const slice = allRows.slice(start, start + PER_PAGE);
  for (const t of slice) {
    const tr = document.createElement("tr");
    tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>";
    tr.children[0].textContent = t.ref || "—";
    tr.children[1].textContent = fmtPaid(t.paidAt);
    tr.children[2].textContent = t.tableName || "—";
    tr.children[3].textContent = t.customerName || "—";
    tr.children[4].textContent = fmtPeso(t.total);
    const badge = document.createElement("span");
    const m = String(t.method || "").toLowerCase();
    badge.className = `badge method-${m === "gcash" ? "gcash" : "cash"}`;
    badge.textContent = t.method || "—";
    tr.children[5].appendChild(badge);
    tr.children[6].textContent = fmtPeso(t.change);
    const link = document.createElement("a");
    link.href = `../shared/receipt.html?ref=${encodeURIComponent(t.ref || "")}`;
    link.textContent = "Receipt";
    link.target = "_blank";
    link.rel = "noopener";
    tr.children[7].appendChild(link);
    tb.appendChild(tr);
  }
  document.getElementById("empty").hidden = allRows.length > 0;
  renderPager();
}

function renderPager() {
  const pager = document.getElementById("pager");
  const info = document.getElementById("pagerInfo");
  const btns = document.getElementById("pagerBtns");
  const pages = Math.max(1, Math.ceil(allRows.length / PER_PAGE));
  if (allRows.length <= PER_PAGE) { pager.hidden = true; btns.innerHTML = ""; return; }
  pager.hidden = false;
  const from = page * PER_PAGE + 1;
  const to = Math.min(allRows.length, (page + 1) * PER_PAGE);
  info.textContent = `Showing ${from}–${to} of ${allRows.length} transactions`;
  btns.innerHTML = "";
  const mk = (label, target, opts = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "page-btn" + (opts.on ? " on" : "");
    b.textContent = label;
    if (opts.disabled) b.disabled = true;
    if (opts.on) b.setAttribute("aria-current", "page");
    b.addEventListener("click", () => { page = target; renderPage(); document.getElementById("tbl").scrollIntoView({ block: "nearest" }); });
    btns.appendChild(b);
  };
  mk("‹", Math.max(0, page - 1), { disabled: page === 0 });
  for (let i = 0; i < pages; i++) mk(String(i + 1), i, { on: i === page });
  mk("›", Math.min(pages - 1, page + 1), { disabled: page === pages - 1 });
}

function paintTransactions(list) {
  allRows = list;
  page = 0;
  renderPage();
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
  msg.textContent = "Loading…";
  msg.className = "dash-msg loading";
  dashSkeleton(document.querySelector("#tbl tbody"), 8, 5);
  document.getElementById("pager").hidden = true;
  try {
    const f = currentFilter();
    const params = {};
    if (f.from) params.from = f.from;
    if (f.to) params.to = f.to;
    if (f.method && f.method !== "all") params.method = f.method;
    const { transactions } = await listTransactions(params, true);
    const n = paintTransactions(transactions || []);
    msg.textContent = `${n} transaction(s) shown.`;
    msg.className = "dash-msg ok";
    dashStamp(document.getElementById("stamp"));
  } catch (e) {
    msg.textContent = e.message;
    msg.className = "dash-msg err";
    document.getElementById("empty").hidden = false;
    document.getElementById("empty").textContent = "Couldn't load transactions — change the filter or refresh to retry.";
  }
  loadDaily();
}

document.getElementById("filterForm").addEventListener("submit", (e) => {
  e.preventDefault();
  loadTransactions();
});

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
  dashToast(
    `CSV for ${f.from || "start"} → ${f.to || "today"} (${f.method}) is downloading.`,
    "ok",
    { title: "Export started" }
  );
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
      msg.className = "dash-msg err";
    }
  }
})();
