// src/function/super-admin/integrations.js - super admin integration toggles.
// Pair: integrations.html <-> /api/super-admin/settings/integrations.
// Guard: role=super_admin stays; admin/cashier go to their dashboards and
// guests go to login. This page never renders credentials: the super-admin
// API intentionally returns activation state only.
(function () {
  const msg = document.getElementById("msg");
  const list = document.getElementById("apiList");
  let loading = false;

  function setMsg(text, kind = "") {
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || "";
    msg.className = `dash-msg${kind ? ` ${kind}` : ""}`;
  }

  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleString([], {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function statusPill(integration) {
    let label = "Off";
    let kind = "off";
    if (!integration.available) {
      label = "Planned";
      kind = "planned";
    } else if (integration.enabled) {
      label = "On";
      kind = "on";
    }
    return make("span", `api-status is-${kind}`, label);
  }

  function offMessage(integration) {
    let message = `Turn off ${integration.name}?`;
    if (integration.key === "googleAuth") {
      message += " Google sign-in will stop working. Password sign-in remains available.";
    } else if (integration.key === "googleMaps") {
      message += " The landing page will stop showing the map.";
    } else if (integration.key === "googleCalendar") {
      message += " Accepted reservations will no longer create calendar events.";
    } else if (integration.key === "recaptcha") {
      message += " Staff login, cashier signup and reservations will stop showing the bot check.";
    } else if (integration.key === "paymongo") {
      message += " Cashiers will no longer be able to create GCash online payment links for session bills.";
    } else if (integration.key === "gemini") {
      message += " Google Gemini AI features and assistant services will be disabled.";
    }
    return message;
  }

  async function toggleIntegration(card, integration, next) {
    const sw = card.querySelector(".dash-switch");
    if (sw) sw.disabled = true;
    setMsg("");
    try {
      const res = await updateSuperAdminIntegration(integration.key, next);
      const updated =
        res && res.integration ? res.integration : { ...integration, enabled: next };
      dashToast(`${integration.name} is now ${updated.enabled ? "on" : "off"}.`, "ok");
      card.replaceWith(cardFor(updated));
    } catch (e) {
      if (sw) {
        sw.disabled = false;
        sw.setAttribute("aria-checked", integration.enabled ? "true" : "false");
      }
      setMsg(e.message, "err");
      dashToast(e.message, "err");
    }
  }

  function cardFor(integration) {
    const card = make("article", "api-card");
    if (!integration.available) card.classList.add("is-planned");
    card.dataset.key = integration.key;

    const head = make("div", "api-card-head");
    const title = make("div", "api-card-title");
    title.append(
      make("h3", "", integration.name),
      make("p", "", integration.description)
    );

    const state = make("div", "api-card-state");
    state.appendChild(statusPill(integration));
    const sw = make("button", "dash-switch");
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", integration.enabled ? "true" : "false");
    sw.setAttribute("aria-label", `Toggle ${integration.name}`);
    if (!integration.available) {
      sw.disabled = true;
    } else {
      sw.addEventListener("click", async () => {
        const next = !integration.enabled;
        if (!next) {
          const ok = await dashConfirm(
            offMessage(integration),
            `Turn off ${integration.name}?`
          );
          if (!ok) return;
        }
        await toggleIntegration(card, integration, next);
      });
    }
    state.appendChild(sw);
    head.append(title, state);
    card.appendChild(head);

    const meta = make("p", "api-meta");
    if (integration.updatedAt) {
      const when = formatDate(integration.updatedAt);
      meta.textContent = `Last updated ${when}${integration.updatedBy ? ` by ${integration.updatedBy}` : ""}`;
    } else {
      meta.textContent = "Not updated yet";
    }
    card.appendChild(meta);
    return card;
  }

  async function load() {
    if (!list || loading) return;
    loading = true;
    list.setAttribute("aria-busy", "true");
    try {
      const data = await getSuperAdminIntegrations();
      const integrations =
        data && Array.isArray(data.integrations) ? data.integrations : [];
      list.replaceChildren();
      integrations.forEach((integration) => list.appendChild(cardFor(integration)));
      setMsg(integrations.length ? "" : "No integrations are available.");
    } catch (e) {
      setMsg(e.message, "err");
      dashToast(e.message, "err");
    } finally {
      loading = false;
      list.removeAttribute("aria-busy");
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
      document.getElementById("avatar").textContent =
        String(displayName).trim().charAt(0).toUpperCase() || "S";
      setMsg("");
      await load();
    } catch (e) {
      setMsg(`${e.message} - redirecting to login.`, "err");
      setTimeout(() => { location.href = "../auth/login.html"; }, 1400);
    }
  })();

  const out = document.getElementById("out");
  if (out) {
    out.addEventListener("click", async () => {
      try { await logout(); } catch { /* still leave */ }
      location.href = "../auth/login.html";
    });
  }
})();
