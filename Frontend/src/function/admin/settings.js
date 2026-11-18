// src/function/admin/settings.js - admin settings page logic.
// Guard: only role=admin stays (super admins go to integration toggles,
// cashiers to their dashboard, guests to login). Renders the read-only profile
// tab and the read-only API integration status cards. Activation and credentials
// belong to the super administrator, so this page never sends an update.
// Shell (menu/theme/date) lives in js/dash.js.
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

  function setApiStatus(text, kind = "") {
    if (!apiStatus) return;
    apiStatus.hidden = !text;
    apiStatus.textContent = text || "";
    apiStatus.className = `dash-msg${kind ? ` ${kind}` : ""}`;
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

  // ---- API integration status cards (read-only) ----
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

    card.appendChild(
      make(
        "p",
        "api-readonly",
        !integration.available
          ? "This integration is not available yet."
          : integration.enabled
            ? "Turned on by the super administrator."
            : "Turned off by the super administrator."
      )
    );

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

  async function loadIntegrations() {
    if (!apiList || apiLoading) return false;
    if (apiLoaded) return true;
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

      function paint() {
        const displayName = me.displayName || me.email || me.username || "Admin";
        const signedIn = me.authProvider === "google" ? "Google" : "Local";

        setText("who", displayName);
        dashRenderAvatar("avatar", { name: displayName, avatarUrl: me.avatarUrl, fallbackLetter: "A" });
        dashRenderAvatar("profileAvatar", { name: displayName, avatarUrl: me.avatarUrl, fallbackLetter: "A" });
        setText("profileName", displayName);
        setText("profileEmail", me.email || "");
        setText("pfEmail", me.email || "—");
        setText("pfUsername", me.username || "—");
        setText("pfRole", "Administrator");
        setText("pfProvider", signedIn);
        setText("pfGoogle", me.googleLinked ? "Linked" : "Not linked");
        setText("pfCreated", formatDate(me.createdAt));

        const status = document.getElementById("pfStatus");
        if (status) {
          status.textContent = me.status || "unknown";
          status.className = `settings-badge is-${me.status || "unknown"}`;
        }
      }

      paint();

      const editBtn = document.getElementById("editProfileBtn");
      if (editBtn) {
        editBtn.addEventListener("click", () => {
          dashEditProfile({
            user: me,
            onSave: async ({ displayName, avatarUrl }) => {
              const res = await updateMyProfile({ displayName, avatarUrl });
              me.displayName = res.displayName || displayName;
              me.avatarUrl = res.avatarUrl !== undefined ? res.avatarUrl : avatarUrl;
              paint();
              dashToast("Profile updated.", "ok");
            },
          });
        });
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
