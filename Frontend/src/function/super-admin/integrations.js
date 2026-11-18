// src/function/super-admin/integrations.js - super admin integration control.
// Pair: integrations.html <-> /api/super-admin/settings/integrations.
// Guard: role=super_admin stays; admin/cashier go to their dashboards and
// guests go to login. This role owns both the on/off switch and the credentials.
// Credential values are always replaced blind: the API only returns masked hints.
(function () {
  const msg = document.getElementById("msg");
  const list = document.getElementById("apiList");
  let loading = false;
  // null = status not loaded yet; true/false = authenticator app paired or not.
  let tfaPaired = null;

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

  function makeButton(label, className, onClick) {
    const b = make("button", className, label);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
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

  function sourceLabel(source) {
    if (source === "env") return "from .env";
    if (source === "override") return "saved here";
    if (source === "db") return "saved";
    return "";
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
    } else if (integration.key === "receiptPdf") {
      message +=
        " Cashiers and administrators will no longer be able to preview or download customer receipt PDFs.";
    } else if (integration.key === "csvExport") {
      message +=
        " Administrators will no longer be able to export the income report as CSV.";
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
      const res = await updateSuperAdminIntegration(integration.key, {
        enabled: next,
      });
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

  /**
   * Credential changes are step-up protected: the server also requires a
   * current 6-digit authenticator code. Returns null when cancelled.
   */
  async function promptAuthenticatorCode(title) {
    const entered = await dashPrompt(
      "Enter the current 6-digit code from your authenticator app to confirm this credential change.",
      "6-digit code",
      "",
      title
    );
    if (entered === null) return null;
    const code = String(entered).replace(/\D/g, "");
    if (code.length !== 6) {
      dashToast("Enter the 6-digit code from your authenticator app.", "err");
      return null;
    }
    return code;
  }

  /**
   * Provider check summary returned by the server after a credential change.
   * The server refuses to store a rejected key, so reaching this point means the
   * provider accepted it (or could not check it, which comes with a note).
   */
  function verificationText(updated, credName) {
    const v = updated && updated.verification ? updated.verification : null;
    if (!v) return "";
    const provider = v.provider || "the provider";
    const verified =
      Array.isArray(v.credentials) && v.credentials.includes(credName);
    const notes = Array.isArray(v.notes)
      ? v.notes.filter((note) => typeof note === "string" && note.trim() !== "")
      : [];
    const parts = [];
    if (verified) parts.push(`Verified with ${provider}.`);
    if (notes.length) parts.push(notes.join(" "));
    return parts.length ? ` ${parts.join(" ")}` : "";
  }

  /**
   * Credential changes are step-up protected: the server requires a current
   * authenticator code, which cannot exist until an app is paired. Point the
   * super admin at the Security panel instead of letting the save fail with 409.
   */
  function requireAuthenticator() {
    if (tfaPaired !== false) return true;
    dashToast(
      "Pair an authenticator app in the Security panel below before changing API keys.",
      "err",
      { title: "Authenticator required", timeout: 7000 }
    );
    document.getElementById("security")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    return false;
  }

  // ---- Credential rows (add / replace / clear) ----
  function credentialRow(card, integration, cred) {
    const row = make("div", "api-credential");
    const label = make("div", "api-cred-label");
    label.appendChild(make("span", "", cred.label));
    if (cred.required) label.appendChild(make("span", "api-required", "Required"));

    const value = make("div", "api-cred-value");
    value.appendChild(make("code", "api-mask", cred.configured ? cred.masked : "Not set"));
    const source = sourceLabel(cred.source);
    if (source) value.appendChild(make("span", "api-cred-source", source));

    const actions = make("div", "api-actions");
    const editor = make("div", "api-edit");
    editor.hidden = true;

    function closeEditor() {
      editor.hidden = true;
      editor.replaceChildren();
      actions.hidden = false;
    }

    async function save(next, code) {
      const res = await updateSuperAdminIntegration(integration.key, {
        credentials: { [cred.name]: next },
        code,
      });
      const updated = res && res.integration ? res.integration : null;
      if (!updated) {
        await load();
        return;
      }
      const turnedOff = updated.enabled === false && integration.enabled === true;
      // A cleared value has nothing for the provider to check.
      const check = next === "" ? "" : verificationText(updated, cred.name);
      const message = turnedOff
        ? `${cred.label} updated. ${updated.name} is now off because a required credential is missing.`
        : `${cred.label} updated.${check}`;
      // Provider notes can be a full sentence, so keep them on screen longer.
      dashToast(message, "ok", { timeout: message.length > 110 ? 9000 : 4200 });
      card.replaceWith(cardFor(updated));
    }

    function openEditor() {
      if (!requireAuthenticator()) return;
      actions.hidden = true;
      editor.hidden = false;
      editor.replaceChildren();

      const field = make("label", "api-edit-field");
      field.appendChild(make("span", "api-edit-label", `New ${cred.label}`));
      const input = document.createElement("input");
      input.type = "password";
      input.className = "api-input";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.placeholder = "Enter a new value";
      input.setAttribute("aria-label", `New ${cred.label}`);
      field.appendChild(input);

      const codeField = make("label", "api-edit-field");
      codeField.appendChild(make("span", "api-edit-label", "Authenticator code"));
      const codeInput = document.createElement("input");
      codeInput.type = "text";
      codeInput.className = "api-input";
      codeInput.inputMode = "numeric";
      codeInput.autocomplete = "one-time-code";
      codeInput.maxLength = 6;
      codeInput.placeholder = "123456";
      codeInput.setAttribute("aria-label", "Authenticator code");
      codeInput.addEventListener("input", (e) => {
        const digits = e.currentTarget.value.replace(/\D/g, "").slice(0, 6);
        if (e.currentTarget.value !== digits) e.currentTarget.value = digits;
      });
      codeField.appendChild(codeInput);

      const fields = make("div", "api-edit-fields");
      fields.append(field, codeField);

      const error = make("p", "api-error");
      error.hidden = true;
      const buttons = make("div", "api-edit-actions");
      const saveBtn = makeButton("Save", "btn btn-solid api-btn", async () => {
        const next = input.value.trim();
        const code = codeInput.value.replace(/\D/g, "");
        if (!next) {
          error.textContent = "Enter a new value, or Cancel.";
          error.hidden = false;
          input.focus();
          return;
        }
        if (code.length !== 6) {
          error.textContent = "Enter the 6-digit code from your authenticator app.";
          error.hidden = false;
          codeInput.focus();
          return;
        }
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        saveBtn.textContent = "Verifying…";
        error.hidden = true;
        try {
          await save(next, code);
        } catch (e) {
          const message = e && e.message ? String(e.message) : "The value was not saved.";
          const rejected = /not valid|invalid|rejected|not recognise/i.test(message);
          error.textContent = message;
          error.hidden = false;
          dashToast(message, "err", {
            title: rejected ? "API key not accepted" : "Not saved",
            timeout: 8000,
          });
        } finally {
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
          saveBtn.textContent = "Save";
        }
      });
      const cancelBtn = makeButton("Cancel", "btn btn-ghost api-btn", closeEditor);
      buttons.append(saveBtn, cancelBtn);
      editor.append(fields, error, buttons);
      input.focus();
    }

    async function clear() {
      if (!requireAuthenticator()) return;
      const ok = await dashConfirm(
        `Clear the saved value for ${cred.label} on ${integration.name}? The .env default will be used again if one is set.`,
        "Clear credential"
      );
      if (!ok) return;
      const code = await promptAuthenticatorCode(`Clear ${cred.label}`);
      if (!code) return;
      try {
        await save("", code);
      } catch (e) {
        dashToast(e.message, "err");
      }
    }

    if (integration.available) {
      if (cred.configured) {
        actions.appendChild(makeButton("Replace", "btn btn-ghost api-btn", openEditor));
        // A base .env value is not a saved value, so there is nothing to clear.
        if (cred.source !== "env") {
          actions.appendChild(
            makeButton("Clear", "btn btn-ghost api-btn api-btn-danger", clear)
          );
        }
      } else {
        actions.appendChild(makeButton("Add", "btn btn-ghost api-btn", openEditor));
      }
    }

    row.append(label, value, actions, editor);
    return row;
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

    const creds = make("div", "api-credentials");
    const credList = Array.isArray(integration.credentials) ? integration.credentials : [];
    if (credList.length) {
      credList.forEach((cred) => creds.appendChild(credentialRow(card, integration, cred)));
    } else {
      creds.appendChild(
        make(
          "p",
          "api-readonly",
          integration.available
            ? "No credentials needed."
            : "No credentials for this integration."
        )
      );
    }
    card.appendChild(creds);

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
    tfaPaired = enabled;
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
          `An authenticator app is paired. It is required when adding, replacing or clearing an API credential.${enrolled}${used}`;
      } else {
        tfaNote.textContent =
          "2FA is off. Pair an authenticator app before adding, replacing or clearing API keys. Sign-in does not require it.";
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
    let code = "";
    if (tfaPaired) {
      const entered = await dashPrompt(
        "Enter the current 6-digit code from your authenticator app before pairing a new device.",
        "6-digit code",
        "",
        "Set up a new device"
      );
      if (entered === null) return;
      code = String(entered).replace(/\D/g, "");
      if (code.length !== 6) {
        tfaSetMsg("Enter the current 6-digit code from your authenticator app.", "err");
        return;
      }
    }
    const btn = document.getElementById("tfaReenroll");
    if (btn) btn.disabled = true;
    tfaSetMsg("Preparing your QR code…");
    try {
      const data = await setupSuperAdminTwoFactor(code);
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
      tfaSetMsg("Authenticator app confirmed. You’ll use it when changing API keys.", "ok");
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
      "Enter the current 6-digit code from your authenticator app. Turning 2FA off blocks API key changes until you pair an app again.",
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
      tfaSetMsg("2FA is off. Pair an authenticator before changing API keys.", "ok");
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
