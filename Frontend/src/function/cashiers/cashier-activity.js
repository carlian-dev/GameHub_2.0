// src/function/cashiers/cashier-activity.js - cashier personal activity log viewer.
// Pair: cashier-activity.html <-> GET /api/me/activity-logs.
// Cashiers see only their own sign-ins, sessions, orders, and payments. Newest first.
const PER_PAGE = 20;
const MAX_ROWS = 200;

const ACTION_LABELS = {
  login: "Signed in",
  logout: "Signed out",
  session_start: "Session started",
  session_extend: "Session extended",
  session_end: "Session ended",
  session_cancel: "Session voided",
  session_auto_end: "Session auto-ended",
  payment_record: "Payment recorded",
  paymongo_checkout_create: "PayMongo link created",
  paymongo_checkout_cancel: "PayMongo link cancelled",
  paymongo_checkout_expire: "PayMongo link expired",
  reservation_accept: "Reservation accepted",
  reservation_reject: "Reservation rejected",
  fnb_order_add: "F&B added",
  fnb_order_update: "F&B quantity changed",
  fnb_order_remove: "F&B removed",
};

const ACTION_TONES = {
  login: "active",
  logout: "archived",
  session_start: "active",
  session_extend: "active",
  session_end: "closed",
  session_cancel: "declined",
  session_auto_end: "closed",
  payment_record: "paid",
  paymongo_checkout_create: "pending",
  paymongo_checkout_cancel: "declined",
  paymongo_checkout_expire: "closed",
  reservation_accept: "available",
  reservation_reject: "declined",
  fnb_order_add: "reserved",
  fnb_order_update: "pending",
  fnb_order_remove: "declined",
};

let allRows = [];
let totalRows = 0;
let page = 0;

function setMsg(text, kind = "") {
  const el = document.getElementById("msg");
  if (!el) return;
  el.textContent = text;
  el.className = `dash-msg${kind ? " " + kind : ""}`;
}

function setEmpty(show, text = "No activity matches this view.") {
  const el = document.getElementById("empty");
  if (!el) return;
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
  if (provider === "google+totp") return "Google + authenticator";
  if (provider === "password+totp") return "Password + authenticator";
  return "";
}

function staffText(log) {
  const name = log.actorName || "Me";
  const username = log.actorUsername && log.actorUsername !== name
    ? ` (@${log.actorUsername})`
    : "";
  const role = log.actorRole ? ` · ${log.actorRole}` : "";
  return `${name}${username}${role}`;
}

function detailsOf(log) {
  const m = log.meta || {};
  const action = String(log.action || "");

  if (action === "login" || action === "logout") {
    return providerText(m.provider) || "—";
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

  if (action === "fnb_order_add") {
    return `${m.productName || "F&B item"} × ${m.qty ?? "?"}`;
  }
  if (action === "fnb_order_update") {
    return `${m.productName || "F&B item"} ${m.oldQty ?? "?"} → ${m.newQty ?? "?"}`;
  }
  if (action === "fnb_order_remove") {
    return `${m.productName || "F&B item"} × ${m.qty ?? "?"}`;
  }

  if (action === "reservation_accept" || action === "reservation_reject" || action === "reservation_create") {
    return log.target ? `Ref ${log.target}` : "—";
  }

  if (action.startsWith("session_")) {
    if (action === "session_auto_end") return "Timer reached zero";
    return log.target ? `Session ${shortId(log.target)}` : "—";
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
    const data = await listMyActivityLogs({
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

document.getElementById("filterForm").addEventListener("submit", (e) => {
  e.preventDefault();
  load();
});

document.getElementById("reset").addEventListener("click", () => {
  document.getElementById("fAction").value = "";
  document.getElementById("fFrom").value = "";
  document.getElementById("fTo").value = "";
  load();
});

populateActions();
cashierGuard()
  .then(() => {
    bindCashierLogout();
    load();
  })
  .catch(() => {
    // Redirection is handled in cashierGuard
  });

// Quiet background refresh while looking at the newest page.
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  if (page !== 0) return;
  if (document.querySelector(".dash-modal.open")) return;
  load();
}, 60000);
