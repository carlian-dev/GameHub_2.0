// src/function/super-admin/access.js - feature access matrix (RBAC).
// Pair: access.html <-> /api/super-admin/settings/feature-access.
// One row per feature, one column per role. Each switch stores one cell
// (`<feature>.<role>`); the server enforces the same cell on every request.
(function () {
  const msg = document.getElementById("msg");
  const matrix = document.getElementById("featureMatrix");
  const meta = document.getElementById("featureMeta");
  const ROLE_LABEL = { admin: "Administrator", cashier: "Cashier" };
  const COLUMNS = ["admin", "cashier"];
  let saving = false;

  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function setMsg(text, kind = "") {
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || "";
    msg.className = `dash-msg${kind ? ` ${kind}` : ""}`;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function renderMeta(state) {
    if (!meta) return;
    meta.textContent = state && state.updatedAt
      ? `Last changed ${formatDate(state.updatedAt)}${
          state.updatedBy ? ` by ${state.updatedBy}` : ""
        }. Cells without a saved value stay on.`
      : "No changes yet — every feature is on for both roles.";
  }

  function roleLabel(role) {
    return ROLE_LABEL[role] || role;
  }

  async function toggle(feature, role, row) {
    if (saving) return;
    const current = !!(feature.access && feature.access[role]);
    const next = !current;
    saving = true;
    setMsg("");
    try {
      const data = await updateSuperAdminFeatureAccess({
        [`${feature.key}.${role}`]: next,
      });
      const updated =
        data && data.featureAccess && Array.isArray(data.featureAccess.features)
          ? data.featureAccess
          : null;
      if (updated) {
        const fresh = updated.features.find((f) => f.key === feature.key);
        if (fresh) row.replaceWith(featureRow(fresh));
        renderMeta(updated);
      } else {
        await load();
      }
      dashToast(
        `${feature.label} is now ${next ? "on" : "off"} for ${roleLabel(role)} accounts.`,
        "ok"
      );
    } catch (e) {
      setMsg(e.message, "err");
      dashToast(e.message, "err");
    } finally {
      saving = false;
    }
  }

  function featureCell(feature, role, row) {
    const cell = make("td", "feature-cell");
    if (!feature.roles.includes(role)) {
      cell.appendChild(make("span", "feature-na", "—"));
      cell.title = `${roleLabel(role)} accounts do not have this feature.`;
      return cell;
    }

    const enabled = !!(feature.access && feature.access[role]);
    const wrap = make("div", "feature-cell-inner");
    wrap.appendChild(
      make("span", `api-status${enabled ? " is-on" : ""}`, enabled ? "On" : "Off")
    );

    const sw = make("button", "dash-switch");
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", enabled ? "true" : "false");
    sw.setAttribute(
      "aria-label",
      `${enabled ? "Turn off" : "Turn on"} ${feature.label} for ${roleLabel(role)} accounts`
    );
    sw.addEventListener("click", () => toggle(feature, role, row));
    wrap.appendChild(sw);
    cell.appendChild(wrap);
    return cell;
  }

  function featureRow(feature) {
    const row = make("tr");
    const name = make("td");
    name.appendChild(make("strong", "feature-name", feature.label));
    name.appendChild(make("p", "feature-desc", feature.description));
    row.appendChild(name);
    COLUMNS.forEach((role) => row.appendChild(featureCell(feature, role, row)));
    return row;
  }

  function render(features) {
    if (!matrix) return;
    matrix.replaceChildren();
    const table = make("table", "feature-table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    headRow.appendChild(make("th", "", "Feature"));
    COLUMNS.forEach((role) =>
      headRow.appendChild(make("th", "", roleLabel(role)))
    );
    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");
    features.forEach((feature) => tbody.appendChild(featureRow(feature)));

    table.append(thead, tbody);
    matrix.appendChild(table);
  }

  async function load() {
    if (!matrix) return;
    matrix.setAttribute("aria-busy", "true");
    try {
      const data = await getSuperAdminFeatureAccess();
      const state = data && data.featureAccess;
      const features = state && Array.isArray(state.features) ? state.features : [];
      render(features);
      renderMeta(state);
      setMsg(features.length ? "" : "No switchable features are registered.");
    } catch (e) {
      setMsg(e.message, "err");
      dashToast(e.message, "err");
    } finally {
      matrix.removeAttribute("aria-busy");
    }
  }

  (async () => {
    try {
      const me = await getMe();
      if (me.role !== "super_admin") {
        location.href = staffHome(me.role);
        return;
      }
      const displayName = me.displayName || me.email || me.username || "Super admin";
      document.getElementById("who").textContent = displayName;
      dashRenderAvatar("avatar", {
        name: displayName,
        avatarUrl: me.avatarUrl,
        fallbackLetter: "S",
      });
      setMsg("");
      await load();
    } catch (e) {
      setMsg(`${e.message} - redirecting to login.`, "err");
      setTimeout(() => {
        location.href = "../auth/login.html";
      }, 1400);
    }
  })();

  const out = document.getElementById("out");
  if (out) {
    out.addEventListener("click", async () => {
      try {
        await logout();
      } catch {
        /* still leave */
      }
      location.href = "../auth/login.html";
    });
  }
})();
