// src/function/super-admin/activity.js - super admin personal activity log viewer.
// Pair: activity.html <-> GET /api/me/activity-logs.
// Shows super admin's own sign-ins, 2FA setup/removal, and integration toggles. Newest first.
const PER_PAGE = 20;
const MAX_ROWS = 200;

const ACTION_LABELS = {
  login: "Signed in",
  logout: "Signed out",
  two_factor_enabled: "2FA enabled",
  two_factor_disabled: "2FA disabled",
  integration_toggle: "API integration toggled",
};

const ACTION_TONES = {
  login: "active",
  logout: "archived",
  two_factor_enabled: "active",
  two_factor_disabled: "pending",
  integration_toggle: "pending",
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

  if (action === "integration_toggle") {
    const state = m.enabled === true ? "enabled" : m.enabled === false ? "disabled" : "";
    return [log.target, state].filter(Boolean).join(" · ") || "—";
  }

  if (action === "two_factor_enabled" || action === "two_factor_disabled") {
    return m.reenrolled === true ? "Authenticator re-enrolled" : "Authenticator app";
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

async function guard() {
  try {
    const me = await getMe();
    if (me.role !== "super_admin") {
      location.href = staffHome(me.role);
      return null;
    }
    const displayName = me.displayName || me.email || me.username || "Super admin";
    document.getElementById("who").textContent = displayName;
    document.getElementById("avatar").textContent =
      String(displayName).trim().charAt(0).toUpperCase() || "S";
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
  document.getElementById("fAction").value = "";
  document.getElementById("fFrom").value = "";
  document.getElementById("fTo").value = "";
  load();
});

const out = document.getElementById("out");
if (out) {
  out.addEventListener("click", async () => {
    try { await logout(); } catch { /* still leave */ }
    location.href = "../auth/login.html";
  });
}

populateActions();
guard().then((me) => {
  if (!me) return;
  load();
});

// Quiet background refresh while looking at the newest page.
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  if (page !== 0) return;
  if (document.querySelector(".dash-modal.open")) return;
  load();
}, 60000);
