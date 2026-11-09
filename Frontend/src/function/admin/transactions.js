// src/function/admin/transactions.js - bills + period income logic.
// Pair: transactions.html <-> Backend transactions_admin_list + reports_income/export.
// Guard: admin-only. One filter form feeds both the income cards and the table:
// day+month = that date, month only = that month, no month = the whole year.
// Table = client-side pagination (10/page), method badges, "Updated" stamp.
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
    tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>";
    tr.children[0].textContent = t.ref || "—";
    tr.children[1].textContent = fmtPaid(t.paidAt);
    tr.children[2].textContent = t.tableName || "—";
    tr.children[3].textContent = t.customerName || "—";
    tr.children[4].textContent = fmtPeso(t.total);
    tr.children[4].classList.add("num");
    tr.children[4].title = `Session ${fmtPeso(t.sessionTotal)} · F&B ${fmtPeso(t.fnbTotal)}`;
    const fnb = Number(t.fnbTotal || 0);
    tr.children[5].textContent = fnb > 0 ? fmtPeso(fnb) : "—";
    tr.children[5].classList.add("num");
    if (fnb > 0) {
      const count = Array.isArray(t.items) ? t.items.length : 0;
      tr.children[5].title = `${count} F&B line${count === 1 ? "" : "s"}`;
    }
    const badge = document.createElement("span");
    const m = String(t.method || "").toLowerCase();
    badge.className = `badge method-${m === "gcash" ? "gcash" : "cash"}`;
    badge.textContent =
      t.provider === "paymongo"
        ? "GCash · PayMongo"
        : t.method || "—";
    if (t.provider === "paymongo") badge.title = "Paid online via PayMongo";
    tr.children[6].appendChild(badge);
    tr.children[7].textContent = fmtPeso(t.change);
    const link = document.createElement("a");
    link.href = `../shared/receipt.html?ref=${encodeURIComponent(t.ref || "")}`;
    link.textContent = "Receipt";
    link.target = "_blank";
    link.rel = "noopener";
    tr.children[8].appendChild(link);
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
    month: document.getElementById("fMonth").value, // "01"–"12"
    day: document.getElementById("fDay").value, // "" = whole month
    year: document.getElementById("fYear").value,
    method: document.getElementById("fMethod").value || "all",
  };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Month dropdown: blank (whole year) + January–December.
function populateMonths() {
  const sel = document.getElementById("fMonth");
  addOption(sel, "", "All months");
  for (let m = 1; m <= 12; m++) {
    addOption(sel, pad2(m), MONTH_NAMES[m - 1]);
  }
  const now = new Date();
  sel.value = pad2(now.getMonth() + 1);
}

// Day dropdown: blank (all days) + 1–31.
function populateDays() {
  const sel = document.getElementById("fDay");
  addOption(sel, "", "All days");
  for (let d = 1; d <= 31; d++) addOption(sel, String(d), String(d));
  sel.value = "";
}

// Year dropdown: current year and the five before it.
function populateYears() {
  const sel = document.getElementById("fYear");
  const now = new Date();
  for (let y = now.getFullYear(); y >= now.getFullYear() - 5; y--) {
    addOption(sel, String(y), String(y));
  }
  sel.value = String(now.getFullYear());
}

function addOption(sel, value, label) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  sel.appendChild(opt);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function selectedDate() {
  const f = currentFilter();
  const now = new Date();
  return {
    year: Number(f.year) || now.getFullYear(),
    month: Number(f.month) || 0, // 0 = all months
    day: Number(f.day) || 0, // 0 = whole month/year
  };
}

// Range for the income cards and the table alike:
// day + month → that date, month only → that month, neither → the whole year.
function filterRange() {
  const { year, month, day } = selectedDate();
  if (month && day >= 1) {
    const d = `${year}-${pad2(month)}-${pad2(day)}`;
    return { from: d, to: d };
  }
  if (month) {
    const last = new Date(year, month, 0).getDate();
    return { from: `${year}-${pad2(month)}-01`, to: `${year}-${pad2(month)}-${pad2(last)}` };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function incomeLabel() {
  const { year, month, day } = selectedDate();
  if (month && day) return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
  if (month) return MONTH_NAMES[month - 1];
  return String(year);
}

async function loadIncome() {
  const { from, to } = filterRange();
  const { month, day } = selectedDate();
  try {
    const r = await getIncomeReport(from, to);
    const on = month && day >= 1 ? "on" : "in";
    document.getElementById("incGross").textContent = fmtPeso(r.gross);
    document.getElementById("incCount").textContent = `${r.count} payment(s) ${on} ${incomeLabel()}`;
    document.getElementById("incFnb").textContent =
      `F&B ${fmtPeso(r.fnbGross)} · Sessions ${fmtPeso(r.sessionGross)}`;
    document.getElementById("incCash").textContent = fmtPeso(r.byMethod.cash.gross);
    document.getElementById("incCashCount").textContent = `${r.byMethod.cash.count} cash`;
    document.getElementById("incGcash").textContent = fmtPeso(r.byMethod.gcash.gross);
    document.getElementById("incGcashCount").textContent = `${r.byMethod.gcash.count} gcash`;
  } catch (e) {
    document.getElementById("incGross").textContent = "–";
    document.getElementById("incCount").textContent = e.message;
    document.getElementById("incFnb").textContent = "–";
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
    const { from, to } = filterRange();
    const params = { from, to };
    if (f.method && f.method !== "all") params.method = f.method;
    const { transactions } = await listTransactions(params, true);
    const n = paintTransactions(transactions || []);
    msg.textContent = `Showing ${n} ${n === 1 ? "bill" : "bills"}.`;
    msg.className = "dash-msg ok";
    dashStamp(document.getElementById("stamp"));
  } catch (e) {
    msg.textContent = e.message;
    msg.className = "dash-msg err";
    document.getElementById("empty").hidden = false;
    document.getElementById("empty").textContent = "Couldn't load transactions — change the filter or refresh to retry.";
  }
}

// Filter changes stay pending until Apply is pressed.
document.getElementById("filterForm").addEventListener("submit", (e) => {
  e.preventDefault();
  loadTransactions();
  loadIncome();
});

document.getElementById("export").addEventListener("click", () => {
  // CSV download: anchor navigation keeps the session cookie (credentials),
  // while api() would try to parse the CSV as JSON and fail.
  const f = currentFilter();
  const { from, to } = filterRange();
  const url = exportReportUrl({ from, to, method: f.method });
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
  dashToast(
    `CSV for ${from === to ? from : `${from} → ${to}`} (${f.method}) is downloading.`,
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
    populateMonths();
    populateDays();
    populateYears();
    loadIncome();
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
