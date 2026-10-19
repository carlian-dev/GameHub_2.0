// src/function/admin/admin-dashboard.js - admin home logic. Pair: admin-dashboard.html.
// Guard: only role=admin stays (cashiers go to their dashboard, guests to login).
// Real data only: 6 stat cards, table-status list (with live time-left for
// occupied tables), recent sessions, and a 7-day revenue chart built from
// listTransactions grouped client-side (no chart library, no sample values).
// Each request fails soft (–/empty state) so one broken endpoint can't blank
// the page. Shell behavior (menu/theme/date/scrims) lives in js/dash.js.

function peso(n) {
  const v = Number(n || 0);
  return `₱${v.toFixed(2)}`;
}

function pesoShort(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1000) return `₱${(v / 1000).toFixed(1)}k`;
  return `₱${v.toFixed(0)}`;
}

function ymd(d) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d)
    ? "—"
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtLeft(ms) {
  const over = ms < 0;
  const a = Math.abs(ms);
  const h = Math.floor(a / 3600000);
  const m = Math.floor((a % 3600000) / 60000);
  const s = Math.floor((a % 60000) / 1000);
  const body = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
  return (over ? "+" : "") + body;
}

// Per-second ticker for any [data-end] spans rendered on this page.
function startTick() {
  const tick = () => {
    document.querySelectorAll("[data-end]").forEach((el) => {
      const raw = el.getAttribute("data-end");
      if (!raw) return;
      const t = new Date(raw).getTime();
      if (isNaN(t)) return;
      const left = t - Date.now();
      el.textContent = fmtLeft(left);
      el.classList.toggle("over", left < 0);
      el.classList.toggle("warn", left >= 0 && left < 600000);
    });
  };
  tick();
  setInterval(tick, 1000);
}

const STATUS_RANK = { occupied: 0, reserved: 1, available: 2, maintenance: 3 };

function renderTableStatus(tables, sessions) {
  const box = document.getElementById("tableStatus");
  if (!box) return;
  const live = (sessions || []).filter((s) => s.status === "active");
  const byTable = new Map(live.map((s) => [String(s.tableId), s]));
  const rows = (tables || [])
    .filter((t) => !t.archived)
    .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || String(a.name).localeCompare(String(b.name)));

  if (!rows.length) {
    box.innerHTML = '<p class="sl-empty">No tables yet — add one on the Tables page.</p>';
    return;
  }
  box.innerHTML = "";
  for (const t of rows) {
    const row = document.createElement("div");
    row.className = "sl-row";
    const name = document.createElement("span");
    name.className = "sl-name";
    name.textContent = t.name;
    const badge = document.createElement("span");
    badge.className = `badge ${t.status || "archived"}`;
    badge.textContent = t.status || "—";
    const meta = document.createElement("span");
    meta.className = "sl-meta";
    const s = byTable.get(String(t.id));
    if (s && s.endTime) {
      const timer = document.createElement("span");
      timer.className = "timer";
      timer.setAttribute("data-end", s.endTime);
      timer.textContent = "…";
      meta.appendChild(timer);
    } else {
      meta.textContent = s ? "in session" : "—";
    }
    row.append(name, badge, meta);
    box.appendChild(row);
  }
}

function renderRecent(sessions) {
  const box = document.getElementById("recentSessions");
  if (!box) return;
  const rows = (sessions || []).slice(0, 6);
  if (!rows.length) {
    box.innerHTML = '<p class="sl-empty">No closed sessions yet — they appear here as they finish.</p>';
    return;
  }
  box.innerHTML = "";
  for (const s of rows) {
    const row = document.createElement("div");
    row.className = "sl-row";
    const name = document.createElement("span");
    name.className = "sl-name";
    name.textContent = s.tableName || "Table";
    const badge = document.createElement("span");
    badge.className = "badge available";
    badge.textContent = "closed";
    const meta = document.createElement("span");
    meta.className = "sl-meta";
    meta.textContent = fmtWhen(s.endTime || s.startTime);
    row.append(name, badge, meta);
    box.appendChild(row);
  }
}

function renderChart(transactions) {
  const chart = document.getElementById("revChart");
  if (!chart) return;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const sums = new Map(days.map((d) => [ymd(d), 0]));
  for (const t of transactions || []) {
    if (!t.paidAt) continue;
    const key = ymd(new Date(t.paidAt));
    if (sums.has(key)) sums.set(key, sums.get(key) + Number(t.total || 0));
  }
  const values = days.map((d) => sums.get(ymd(d)) || 0);
  const max = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0);
  chart.innerHTML = "";
  chart.setAttribute(
    "aria-label",
    `Bar chart of revenue for the last 7 days: ${days
      .map((d, i) => `${d.toLocaleDateString([], { weekday: "short" })} ${peso(values[i])}`)
      .join(", ")}. Total ${peso(total)}.`
  );
  days.forEach((d, i) => {
    const v = values[i];
    const col = document.createElement("div");
    col.className = "bar-col";
    const val = document.createElement("span");
    val.className = "bar-val";
    val.textContent = pesoShort(v);
    const bar = document.createElement("span");
    bar.className = "bar" + (v <= 0 ? " zero" : "");
    bar.style.height = `${Math.max(6, Math.round((v / max) * 110))}px`;
    bar.title = `${d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}: ${peso(v)}`;
    const lbl = document.createElement("span");
    lbl.className = "bar-lbl";
    lbl.textContent = d.toLocaleDateString([], { weekday: "short" });
    col.append(val, bar, lbl);
    chart.appendChild(col);
  });
  if (!total && !(transactions || []).length) {
    const note = document.createElement("p");
    note.className = "chart-empty";
    note.textContent = "No payments recorded in the last 7 days.";
    chart.appendChild(note);
  }
}

async function load() {
  const msg = document.getElementById("msg");
  msg.textContent = "Loading live stats…";
  msg.className = "dash-msg loading";
  const today = ymd(new Date());
  const [tb, act, closed, daily, tx] = await Promise.all([
    listTables("all").catch(() => null),
    listSessions("active").catch(() => null),
    listSessions("closed").catch(() => null),
    getDailyReport(today).catch(() => null),
    listTransactions({}, true).catch(() => null),
  ]);

  const tables = tb ? tb.tables || [] : null;
  const active = act ? act.sessions || [] : null;
  const closedRows = closed ? closed.sessions || [] : null;
  const transactions = tx ? tx.transactions || [] : null;

  if (tables) {
    const live = tables.filter((t) => !t.archived);
    const set = (id, v) => { document.getElementById(id).textContent = v; };
    set("stTables", live.length);
    set("stAvail", live.filter((t) => t.status === "available").length);
    set("stOcc", live.filter((t) => t.status === "occupied").length);
    set("stRes", live.filter((t) => t.status === "reserved").length);
    renderTableStatus(tables, active);
  }
  if (active) document.getElementById("stSessions").textContent = active.length;
  if (daily) {
    document.getElementById("stRevenue").textContent = peso(daily.gross);
    document.getElementById("stRevenueSub").textContent =
      `${daily.count} payment(s) today`;
  }
  if (closedRows) renderRecent(closedRows);
  if (transactions) renderChart(transactions);

  const missing = [tables, active, closedRows, daily, transactions].filter((x) => x === null).length;
  if (missing === 5) {
    msg.textContent = "Couldn't load dashboard stats. Check your connection and refresh.";
    msg.className = "dash-msg err";
  } else if (missing > 0) {
    msg.textContent = `Loaded with ${missing} section(s) unavailable.`;
    msg.className = "dash-msg";
  } else {
    msg.textContent = dashStamp();
    msg.className = "dash-msg ok";
  }
}

(async () => {
  const msg = document.getElementById("msg");
  try {
    const me = await getMe();
    if (me.role !== "admin") {
      location.href = me.role === "cashier" ? "../cashiers/cashier-dashboard.html" : "../auth/login.html";
      return;
    }
    const name = me.email || "admin";
    document.getElementById("who").textContent = name;
    document.getElementById("avatar").textContent = name.charAt(0).toUpperCase();
    await load();
    startTick();
  } catch (e) {
    if (!document.getElementById("who")) return;
    document.getElementById("who").textContent = "Signed out";
    msg.textContent = `${e.message} — redirecting to login…`;
    msg.className = "dash-msg err";
    setTimeout(() => { location.href = "../auth/login.html"; }, 1400);
  }
})();

document.getElementById("out").addEventListener("click", async () => {
  try { await logout(); } catch { /* already out */ }
  location.href = "../auth/login.html";
});
