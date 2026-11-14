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

  // --- Authenticator app (2FA) ---
  const tfaStatus = document.getElementById("tfaStatus");
  const tfaNote = document.getElementById("tfaNote");
  const tfaActions = document.getElementById("tfaActions");
  const tfaSetup = document.getElementById("tfaSetup");
  const tfaSetupCode = document.getElementById("tfaSetupCode");
  const tfaMsgEl = document.getElementById("tfaSecurityMsg");

  function tfaSetMsg(text, kind = "") {
    if (!tfaMsgEl) return;
    tfaMsgEl.textContent = text || "";
    tfaMsgEl.className = `security-msg${kind ? ` is-${kind}` : ""}`;
  }

  function renderSecurity(status) {
    const enabled = !!(status && status.enabled);
    if (tfaStatus) {
      tfaStatus.textContent = enabled ? "Enabled" : "Off";
      tfaStatus.className = `settings-badge ${enabled ? "is-active" : "is-declined"}`;
    }
    if (tfaNote) {
      if (enabled) {
        const enrolled = status.enrolledAt
          ? ` Enrolled ${formatDate(status.enrolledAt)}.`
          : "";
        const used = status.lastUsedAt
          ? ` Last used ${formatDate(status.lastUsedAt)}.`
          : "";
        tfaNote.textContent =
          `An authenticator app is paired. Every super admin sign-in asks for a fresh 6-digit code.${enrolled}${used}`;
      } else {
        tfaNote.textContent =
          "2FA is off. The next super admin sign-in will require pairing an authenticator app before the dashboard opens.";
      }
    }
    if (tfaActions) tfaActions.hidden = false;
    if (tfaSetup) tfaSetup.hidden = true;
    const reenroll = document.getElementById("tfaReenroll");
    const disable = document.getElementById("tfaDisable");
    if (reenroll) reenroll.textContent = enabled ? "Set up a new device" : "Set up authenticator";
    if (disable) disable.hidden = !enabled;
  }

  async function loadSecurity() {
    try {
      const status = await getSuperAdminTwoFactor();
      renderSecurity(status);
    } catch (e) {
      if (tfaStatus) {
        tfaStatus.textContent = "Unavailable";
        tfaStatus.className = "settings-badge is-declined";
      }
      tfaSetMsg(e.message, "err");
    }
  }

  async function beginSecuritySetup() {
    const btn = document.getElementById("tfaReenroll");
    if (btn) btn.disabled = true;
    tfaSetMsg("Preparing your QR code…");
    try {
      const data = await setupSuperAdminTwoFactor();
      document.getElementById("tfaSetupQr").src = data.qrDataUrl;
      document.getElementById("tfaSetupSecret").textContent =
        String(data.secret || "").match(/.{1,4}/g)?.join(" ") || data.secret;
      tfaSetup.hidden = false;
      tfaActions.hidden = true;
      tfaSetupCode.value = "";
      tfaSetMsg("Scan the QR code, then enter the 6-digit code to confirm.", "ok");
      document.getElementById("tfaSetup").scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
      tfaSetupCode.focus();
    } catch (e) {
      tfaSetMsg(e.message, "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function cancelSecuritySetup() {
    if (tfaSetup) tfaSetup.hidden = true;
    if (tfaActions) tfaActions.hidden = false;
    tfaSetMsg("");
  }

  async function enableSecurity(event) {
    event.preventDefault();
    const code = tfaSetupCode.value.replace(/\D/g, "");
    if (code.length !== 6) {
      tfaSetMsg("Enter the 6-digit code from your authenticator app.", "err");
      tfaSetupCode.focus();
      return;
    }
    const btn = document.getElementById("tfaEnable");
    if (btn) btn.disabled = true;
    tfaSetMsg("Verifying…");
    try {
      const status = await enableSuperAdminTwoFactor(code);
      renderSecurity(status);
      tfaSetMsg("Authenticator app confirmed. You’ll use it at every sign-in.", "ok");
      dashToast("Two-factor authentication is on.", "ok");
    } catch (e) {
      tfaSetMsg(e.message, "err");
      tfaSetupCode.value = "";
      tfaSetupCode.focus();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function disableSecurity() {
    const entered = await dashPrompt(
      "Enter the current 6-digit code from your authenticator app. Turning 2FA off means the next sign-in must pair the app again.",
      "6-digit code",
      "",
      "Turn off two-factor authentication"
    );
    if (entered === null) return;
    const code = String(entered).replace(/\D/g, "");
    if (code.length !== 6) {
      tfaSetMsg("Enter the current 6-digit code to turn 2FA off.", "err");
      return;
    }
    const btn = document.getElementById("tfaDisable");
    if (btn) btn.disabled = true;
    tfaSetMsg("Turning off 2FA…");
    try {
      const status = await disableSuperAdminTwoFactor(code);
      renderSecurity(status);
      tfaSetMsg("2FA is off. Pair an authenticator before your next sign-in.", "ok");
      dashToast("Two-factor authentication is off.", "ok");
    } catch (e) {
      tfaSetMsg(e.message, "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.getElementById("tfaReenroll")?.addEventListener("click", beginSecuritySetup);
  document.getElementById("tfaCancelSetup")?.addEventListener("click", cancelSecuritySetup);
  document.getElementById("tfaDisable")?.addEventListener("click", disableSecurity);
  document.getElementById("tfaEnableForm")?.addEventListener("submit", enableSecurity);
  tfaSetupCode?.addEventListener("input", (e) => {
    const digits = e.currentTarget.value.replace(/\D/g, "").slice(0, 6);
    if (e.currentTarget.value !== digits) e.currentTarget.value = digits;
  });

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
      await loadSecurity();
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
