// src/function/admin/activity.js - admin activity log viewer (AD-026).
// Pair: activity.html <-> GET /api/admin/activity-logs.
// Shows cashier/admin sign-ins and sign-outs plus operational actions
// (sessions, payments, staff, menu, settings). Newest first; the server
// filters by staff/action/date, the page paginates locally.
const PER_PAGE = 20;
const MAX_ROWS = 200;

const ACTION_LABELS = {
  login: "Signed in",
  logout: "Signed out",
  approve_cashier: "Cashier approved",
  decline_application: "Application declined",
  approve_admin: "Admin approved",
  archive_cashier: "Cashier archived",
  unarchive_cashier: "Cashier unarchived",
  session_start: "Session started",
  session_extend: "Session extended",
  session_end: "Session ended",
  session_cancel: "Session voided",
  session_auto_end: "Session auto-ended",
  payment_record: "Payment recorded",
  paymongo_checkout_create: "PayMongo link created",
  paymongo_checkout_cancel: "PayMongo link cancelled",
  paymongo_checkout_expire: "PayMongo link expired",
  reservation_create: "Reservation created",
  reservation_accept: "Reservation accepted",
  reservation_reject: "Reservation rejected",
  fnb_product_add: "Menu item added",
  fnb_product_update: "Menu item updated",
  fnb_product_archive: "Menu item archived",
  fnb_product_unarchive: "Menu item restored",
  fnb_order_add: "F&B added",
  fnb_order_update: "F&B quantity changed",
  fnb_order_remove: "F&B removed",
  integration_settings_update: "API settings updated",
};

const ACTION_TONES = {
  login: "active",
  logout: "archived",
  approve_cashier: "available",
  decline_application: "declined",
  approve_admin: "available",
  archive_cashier: "archived",
  unarchive_cashier: "available",
  session_start: "active",
  session_extend: "active",
  session_end: "closed",
  session_cancel: "declined",
  session_auto_end: "closed",
  payment_record: "paid",
  paymongo_checkout_create: "pending",
  paymongo_checkout_cancel: "declined",
  paymongo_checkout_expire: "closed",
  reservation_create: "reserved",
  reservation_accept: "available",
  reservation_reject: "declined",
  fnb_product_add: "available",
  fnb_product_update: "pending",
  fnb_product_archive: "archived",
  fnb_product_unarchive: "available",
  fnb_order_add: "reserved",
  fnb_order_update: "pending",
  fnb_order_remove: "declined",
  integration_settings_update: "pending",
};

let allRows = [];
let totalRows = 0;
let page = 0;

function setMsg(text, kind = "") {
  const el = document.getElementById("msg");
  el.textContent = text;
  el.className = `dash-msg${kind ? " " + kind : ""}`;
}

function setEmpty(show, text = "No activity matches this view.") {
  const el = document.getElementById("empty");
  el.textContent = text;
  el.hidden = !show;
}

function addOption(sel, value, label) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  sel.appendChild(opt);
}

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtPeso(n) {
  const value = Number(n);
  return Number.isFinite(value) ? `₱${value.toFixed(2)}` : "";
}

function shortId(id) {
  const text = String(id || "");
  return text.length > 6 ? `#${text.slice(-6)}` : text;
}

function providerText(provider) {
  if (provider === "google") return "Google sign-in";
  if (provider === "password") return "Password sign-in";
  return "";
}

function staffText(log) {
  const name = log.actorName || "Unknown";
  const username = log.actorUsername && log.actorUsername !== name
    ? ` (@${log.actorUsername})`
    : "";
  const role = log.actorRole ? ` · ${log.actorRole}` : "";
  return `${name}${username}${role}`;
}

function detailsOf(log) {
  const m = log.meta || {};
  const action = String(log.action || "");

  if (action === "login") return providerText(m.provider) || "—";
  if (action === "logout") return providerText(m.provider) || "—";

  if (action === "approve_cashier" || action === "archive_cashier" || action === "unarchive_cashier") {
    return log.targetName ? `Account: ${log.targetName}` : `Account ${shortId(log.target)}`;
  }

  if (action === "payment_record") {
    const amount = fmtPeso(m.total);
    const online = String(m.provider || "").toLowerCase() === "paymongo";
    const method = String(m.method || "").toLowerCase() === "gcash"
      ? (online ? "GCash · PayMongo" : "GCash")
      : String(m.method || "").toLowerCase() === "cash" ? "Cash" : "";
    return [amount, method].filter(Boolean).join(" · ") || "—";
  }

  if (action === "paymongo_checkout_create" || action === "paymongo_checkout_cancel" || action === "paymongo_checkout_expire") {
    const amount = m.amount != null ? fmtPeso(m.amount) : "";
    const status = m.status ? String(m.status) : "";
    return [amount, status, log.target ? `Session ${shortId(log.target)}` : ""].filter(Boolean).join(" · ") || "—";
  }

  if (action === "fnb_product_add" || action === "fnb_product_archive" || action === "fnb_product_unarchive") {
    return m.productName || "—";
  }
  if (action === "fnb_product_update") {
    const parts = [m.productName || "Menu item"];
    if (m.oldPrice != null && m.newPrice != null) parts.push(`${fmtPeso(m.oldPrice)} → ${fmtPeso(m.newPrice)}`);
    else if (Array.isArray(m.changedFields) && m.changedFields.length) parts.push(`changed ${m.changedFields.join(", ")}`);
    return parts.join(" · ");
  }

  if (action === "fnb_order_add") {
    return `${m.productName || "F&B item"} × ${m.qty ?? "?"}`;
  }
  if (action === "fnb_order_update") {
    return `${m.productName || "F&B item"} ${m.oldQty ?? "?"} → ${m.newQty ?? "?"}`;
  }
  if (action === "fnb_order_remove") {
    return `${m.productName || "F&B item"} × ${m.qty ?? "?"}`;
  }

  if (action === "reservation_create" || action === "reservation_accept" || action === "reservation_reject") {
    return log.target ? `Ref ${log.target}` : "—";
  }

  if (action.startsWith("session_")) {
    if (action === "session_auto_end") return "Timer reached zero";
    return log.target ? `Session ${shortId(log.target)}` : "—";
  }

  if (action === "integration_settings_update") {
    const changed = Array.isArray(m.changed) ? m.changed.join(", ") : "";
    const state = m.enabled === true ? "enabled" : m.enabled === false ? "disabled" : "";
    return [log.target, changed ? `changed ${changed}` : "", state].filter(Boolean).join(" · ") || "—";
  }

  const extra = Object.entries(m)
    .filter(([key]) => !["role", "provider", "username", "email"].includes(key))
    .slice(0, 3)
    .map(([key, value]) => {
      if (value == null || value === "") return "";
      if (typeof value === "object") return `${key}: ${JSON.stringify(value)}`;
      return `${key}: ${value}`;
    })
    .filter(Boolean)
    .join(" · ");
  return extra || (log.target ? shortId(log.target) : "—");
}

function row(log) {
  const tr = document.createElement("tr");
  tr.innerHTML = "<td></td><td></td><td></td><td></td>";
  tr.children[0].textContent = fmtWhen(log.at);
  tr.children[1].textContent = staffText(log);

  const actionTd = tr.children[2];
  const badge = document.createElement("span");
  const tone = ACTION_TONES[log.action] || "archived";
  badge.className = `badge ${tone}`;
  badge.textContent = ACTION_LABELS[log.action] || log.action || "Unknown";
  actionTd.appendChild(badge);

  tr.children[3].textContent = detailsOf(log);
  if (log.id) tr.children[3].title = `Log ${log.id}`;
  return tr;
}

function renderPage() {
  const tb = document.querySelector("#tbl tbody");
  tb.innerHTML = "";
  const start = page * PER_PAGE;
  const slice = allRows.slice(start, start + PER_PAGE);
  for (const log of slice) tb.appendChild(row(log));
  setEmpty(allRows.length === 0);
  renderPager();
}

function renderPager() {
  const pager = document.getElementById("pager");
  const info = document.getElementById("pagerInfo");
  const btns = document.getElementById("pagerBtns");
  const pages = Math.max(1, Math.ceil(allRows.length / PER_PAGE));
  if (allRows.length <= PER_PAGE) {
    pager.hidden = true;
    btns.innerHTML = "";
    return;
  }
  pager.hidden = false;
  const from = page * PER_PAGE + 1;
  const to = Math.min(allRows.length, (page + 1) * PER_PAGE);
  info.textContent = `Showing ${from}–${to} of ${allRows.length} loaded events`;
  btns.innerHTML = "";
  const mk = (label, target, opts = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "page-btn" + (opts.on ? " on" : "");
    b.textContent = label;
    if (opts.disabled) b.disabled = true;
    if (opts.on) b.setAttribute("aria-current", "page");
    b.addEventListener("click", () => {
      page = target;
      renderPage();
      document.getElementById("tbl").scrollIntoView({ block: "nearest" });
    });
    btns.appendChild(b);
  };
  mk("‹", Math.max(0, page - 1), { disabled: page === 0 });
  for (let i = 0; i < pages; i++) mk(String(i + 1), i, { on: i === page });
  mk("›", Math.min(pages - 1, page + 1), { disabled: page === pages - 1 });
}

function currentFilter() {
  return {
    staff: document.getElementById("fStaff").value,
    action: document.getElementById("fAction").value,
    from: document.getElementById("fFrom").value,
    to: document.getElementById("fTo").value,
  };
}

async function load() {
  setMsg("Loading…", "loading");
  dashSkeleton(document.querySelector("#tbl tbody"), 4, 6);
  document.getElementById("pager").hidden = true;
  try {
    const filter = currentFilter();
    const data = await listActivityLogs({
      actorId: filter.staff,
      action: filter.action,
      from: filter.from,
      to: filter.to,
      limit: MAX_ROWS,
    });
    allRows = Array.isArray(data.logs) ? data.logs : [];
    totalRows = Number(data.total || allRows.length);
    page = 0;
    renderPage();
    const shown = allRows.length;
    if (totalRows > shown) {
      setMsg(
        `Showing the latest ${shown} of ${totalRows} events. Narrow the filters to see older ones.`,
        "ok"
      );
    } else {
      setMsg(`Showing ${shown} event${shown === 1 ? "" : "s"}.`, "ok");
    }
    dashStamp(document.getElementById("stamp"));
  } catch (err) {
    allRows = [];
    totalRows = 0;
    document.querySelector("#tbl tbody").innerHTML = "";
    setEmpty(false);
    document.getElementById("pager").hidden = true;
    setMsg(err.message, "err");
  }
}

function populateActions() {
  const sel = document.getElementById("fAction");
  addOption(sel, "", "All actions");
  for (const [value, label] of Object.entries(ACTION_LABELS)) {
    addOption(sel, value, label);
  }
}

async function populateStaff() {
  const sel = document.getElementById("fStaff");
  addOption(sel, "", "All staff");
  addOption(sel, "system", "System");
  addOption(sel, "guest", "Guest / public");
  try {
    const { cashiers } = await listCashiers("all", "all");
    for (const c of cashiers || []) {
      const name = c.displayName || c.username || c.email || c.id;
      const uname = c.username && c.username !== name ? ` (${c.username})` : "";
      const role = c.role === "admin" ? " · admin" : "";
      addOption(sel, c.id, `${name}${uname}${role}`);
    }
  } catch {
    // Filters degrade to the three default options; the table still works.
  }
}

async function guard() {
  try {
    const me = await getMe();
    if (me.role !== "admin") {
      location.href = "../auth/login.html";
      return null;
    }
    const name = me.email || me.username || "admin";
    document.getElementById("who").textContent = name;
    document.getElementById("avatar").textContent = name.charAt(0).toUpperCase();
    return me;
  } catch {
    location.href = "../auth/login.html";
    return null;
  }
}

document.getElementById("filterForm").addEventListener("submit", (e) => {
  e.preventDefault();
  load();
});

document.getElementById("reset").addEventListener("click", () => {
  document.getElementById("fStaff").value = "";
  document.getElementById("fAction").value = "";
  document.getElementById("fFrom").value = "";
  document.getElementById("fTo").value = "";
  load();
});

populateActions();
guard().then((me) => {
  if (!me) return;
  populateStaff().then(load);
});

// Quiet background refresh while looking at the newest page.
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  if (page !== 0) return;
  if (document.querySelector(".dash-modal.open")) return;
  load();
}, 60000);
