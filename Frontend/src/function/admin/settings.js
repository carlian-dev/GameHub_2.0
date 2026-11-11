// src/function/admin/settings.js - admin settings page logic.
// Guard: only role=admin stays (super admins go to integration toggles,
// cashiers to their dashboard, guests to login). Renders the read-only profile
// tab and the API integration credential cards. Turning an integration on or
// off belongs to the super-admin role, so this page never sends `enabled`.
// Shell (menu/theme/date) lives in js/dash.js. Credentials arrive masked and
// are never written into the DOM in full.
(function () {
  const msg = document.getElementById("settingsMsg");
  const profileView = document.getElementById("profileView");
  const apiView = document.getElementById("apiView");
  const panel = document.getElementById("settingsPanel");
  const apiStatus = document.getElementById("apiStatus");
  const apiList = document.getElementById("apiList");

  let apiLoaded = false;
  let apiLoading = false;

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
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

  function setApiStatus(text, kind = "") {
    if (!apiStatus) return;
    apiStatus.hidden = !text;
    apiStatus.textContent = text || "";
    apiStatus.className = `dash-msg${kind ? ` ${kind}` : ""}`;
  }

  function cardError(card, message) {
    const err = card.querySelector(".api-card-error");
    if (!err) return;
    err.hidden = !message;
    err.textContent = message || "";
  }

  function refreshTabHash(tab) {
    const isApi = tab === "api";
    if (profileView) profileView.hidden = isApi;
    if (apiView) apiView.hidden = !isApi;
    if (panel) {
      panel.setAttribute(
        "aria-labelledby",
        isApi ? "settingsTabApi" : "settingsTabProfile"
      );
    }
    history.replaceState(null, "", isApi ? "#api" : "#profile");
  }

  function showTab(tab) {
    refreshTabHash(tab);
    if (tab === "api") loadIntegrations();
  }

  // Keep the visible tab in sync with the URL hash. The gear menu links to
  // settings.html#profile / #api; when Settings is already open the browser
  // only fires hashchange (no reload), so the page must switch tabs itself.
  function selectTab(tab) {
    const wanted = tab === "api" ? "api" : "profile";
    const btn = document.querySelector(`.dash-tabs [data-t="${wanted}"]`);
    if (btn && !btn.classList.contains("on")) {
      btn.click();
      return;
    }
    showTab(wanted);
  }

  function tabFromHash() {
    return location.hash === "#api" ? "api" : "profile";
  }

  // ---- API integration cards ----
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

  function closeEditor(row) {
    const editor = row.querySelector(".api-edit");
    const actions = row.querySelector(".api-actions");
    if (editor) {
      editor.hidden = true;
      editor.replaceChildren();
    }
    if (actions) actions.hidden = false;
  }

  function openEditor(row, integration, cred) {
    const editor = row.querySelector(".api-edit");
    const actions = row.querySelector(".api-actions");
    const card = row.closest(".api-card");
    if (!editor || !actions || !card) return;
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

    const err = make("p", "api-error");
    err.hidden = true;
    const buttons = make("div", "api-edit-actions");
    const save = makeButton("Save", "btn btn-solid api-btn", async () => {
      const value = input.value.trim();
      if (!value) {
        err.textContent = "Enter a new value, or Cancel.";
        err.hidden = false;
        input.focus();
        return;
      }
      save.disabled = true;
      cancel.disabled = true;
      err.hidden = true;
      try {
        const res = await updateAdminIntegration(integration.key, {
          credentials: { [cred.name]: value },
        });
        input.value = "";
        dashToast(`${cred.label} updated.`, "ok");
        closeEditor(row);
        await applySaveResult(card, res);
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
        dashToast(e.message, "err");
      } finally {
        save.disabled = false;
        cancel.disabled = false;
      }
    });
    const cancel = makeButton("Cancel", "btn btn-ghost api-btn", () => closeEditor(row));
    buttons.append(save, cancel);
    editor.append(field, err, buttons);
    input.focus();
  }

  async function clearCredential(card, integration, cred) {
    const extra = cred.required
      ? ` If no .env default exists, ${integration.name} will turn off.`
      : "";
    const ok = await dashConfirm(
      `Clear the admin value for ${cred.label} on ${integration.name}? The .env default will be used again if one is set.${extra}`,
      "Clear admin value"
    );
    if (!ok) return;
    cardError(card, "");
    try {
      const res = await updateAdminIntegration(integration.key, {
        credentials: { [cred.name]: "" },
      });
      const updated =
        res && res.integration && Array.isArray(res.integration.credentials)
          ? res.integration.credentials.find((c) => c.name === cred.name)
          : null;
      const disabled = res && res.integration && res.integration.enabled === false;
      const fallback = updated && updated.configured && updated.source === "env";
      dashToast(
        disabled
          ? `Admin value cleared. ${integration.name} is now off.`
          : fallback
            ? `Admin value cleared. ${integration.name} is now using the .env default.`
            : "Admin value cleared.",
        "ok"
      );
      await applySaveResult(card, res);
    } catch (e) {
      cardError(card, e.message);
      dashToast(e.message, "err");
    }
  }

  function credentialRow(card, integration, cred) {
    const row = make("div", "api-credential");
    const label = make("div", "api-cred-label");
    label.appendChild(make("span", "", cred.label));
    if (cred.required) label.appendChild(make("span", "api-required", "Required"));

    const value = make("div", "api-cred-value");
    value.appendChild(make("code", "api-mask", cred.configured ? cred.masked : "Not set"));
    if (cred.configured) {
      const sourceLabel =
        cred.source === "env"
          ? "from .env"
          : cred.source === "override"
            ? "admin override"
            : cred.source === "db"
              ? "saved"
              : "";
      if (sourceLabel) {
        value.appendChild(make("span", "api-cred-source", sourceLabel));
      }
    }

    const actions = make("div", "api-actions");
    const editor = make("div", "api-edit");
    editor.hidden = true;

    if (integration.available) {
      if (cred.configured) {
        actions.appendChild(makeButton("Replace", "btn btn-ghost api-btn", () => {
          openEditor(row, integration, cred);
        }));
        // A base .env value is not an admin value, so there is nothing to
        // clear. Replacing it creates an override; the super admin owns the
        // integration on/off switch.
        if (cred.source !== "env") {
          actions.appendChild(makeButton("Clear", "btn btn-ghost api-btn api-btn-danger", () => {
            clearCredential(card, integration, cred);
          }));
        }
      } else {
        actions.appendChild(makeButton("Add", "btn btn-ghost api-btn", () => {
          openEditor(row, integration, cred);
        }));
      }
    }

    row.append(label, value, actions, editor);
    return row;
  }

  function integrationCard(integration) {
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
    head.append(title, state);
    card.appendChild(head);

    const creds = make("div", "api-credentials");
    const list = Array.isArray(integration.credentials) ? integration.credentials : [];
    if (list.length) {
      list.forEach((cred) => creds.appendChild(credentialRow(card, integration, cred)));
    } else {
      creds.appendChild(make("p", "api-empty", "No credentials for this integration."));
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

    const err = make("p", "api-error api-card-error");
    err.hidden = true;
    card.appendChild(err);
    return card;
  }

  async function applySaveResult(card, res) {
    const integration = res && res.integration;
    if (integration && Array.isArray(integration.credentials) && typeof integration.available === "boolean") {
      card.replaceWith(integrationCard(integration));
      return true;
    }
    // Older/partial responses fall back to a list reload, but a failure here
    // must not leave the saved form or switch stuck.
    const loaded = await loadIntegrations(true);
    if (!loaded) {
      setApiStatus("Saved, but the latest state could not be reloaded. Switch tabs to retry.", "err");
    }
    return loaded;
  }

  async function loadIntegrations(force = false) {
    if (!apiList || apiLoading) return false;
    if (apiLoaded && !force) return true;
    apiLoading = true;
    setApiStatus("Loading integrations…", "loading");
    try {
      const data = await getAdminIntegrations();
      const integrations = data && Array.isArray(data.integrations) ? data.integrations : [];
      apiList.replaceChildren();
      integrations.forEach((integration) => apiList.appendChild(integrationCard(integration)));
      apiLoaded = true;
      setApiStatus(integrations.length ? "" : "No integrations are available.");
      return true;
    } catch (e) {
      apiLoaded = false;
      setApiStatus(e.message, "err");
      dashToast(e.message, "err");
      return false;
    } finally {
      apiLoading = false;
    }
  }

  // ---- Guard + profile ----
  (async () => {
    try {
      const me = await getMe();
      if (me.role !== "admin") {
        location.href = staffHome(me.role);
        return;
      }

      const displayName = me.displayName || me.email || me.username || "Admin";
      const initial = String(displayName).trim().charAt(0).toUpperCase() || "A";
      const signedIn = me.authProvider === "google" ? "Google" : "Local";

      setText("who", displayName);
      setText("avatar", initial);
      setText("profileAvatar", initial);
      setText("profileName", displayName);
      setText("profileEmail", me.email || "");
      setText("pfEmail", me.email || "—");
      setText("pfUsername", me.username || "—");
      setText(
        "pfRole",
        me.role === "admin"
          ? "Administrator"
          : me.role === "super_admin"
            ? "Super administrator"
            : (me.role || "—")
      );
      setText("pfProvider", signedIn);
      setText("pfGoogle", me.googleLinked ? "Linked" : "Not linked");
      setText("pfCreated", formatDate(me.createdAt));

      const status = document.getElementById("pfStatus");
      if (status) {
        status.textContent = me.status || "unknown";
        status.className = `settings-badge is-${me.status || "unknown"}`;
      }

      if (msg) {
        msg.textContent = "";
        msg.className = "dash-msg";
      }

      dashTabsInit(showTab);
      selectTab(tabFromHash());
      window.addEventListener("hashchange", () => selectTab(tabFromHash()));
    } catch (e) {
      if (!msg) return;
      setText("who", "Signed out");
      msg.textContent = `${e.message} - redirecting to login.`;
      msg.className = "dash-msg err";
      setTimeout(() => { location.href = "../auth/login.html"; }, 1400);
    }
  })();
})();
