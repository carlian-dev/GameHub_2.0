// src/function/admin/settings.js - admin settings page logic.
// Guard: only role=admin stays (cashiers go to their dashboard, guests to
// login). Renders the read-only profile tab and owns tab/deep-link behavior.
// Shell (menu/theme/date) lives in js/dash.js. API cards are added in Task 6.
(function () {
  const msg = document.getElementById("settingsMsg");
  const profileView = document.getElementById("profileView");
  const apiView = document.getElementById("apiView");
  const panel = document.getElementById("settingsPanel");

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

  function showTab(tab) {
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

  (async () => {
    try {
      const me = await getMe();
      if (me.role !== "admin") {
        location.href = me.role === "cashier"
          ? "../cashiers/cashier-dashboard.html"
          : "../auth/login.html";
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
      setText("pfRole", me.role === "admin" ? "Administrator" : (me.role || "—"));
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
      const wanted = location.hash === "#api" ? "api" : "profile";
      const btn = document.querySelector(`.dash-tabs [data-t="${wanted}"]`);
      if (btn) btn.click();
      else showTab(wanted);
    } catch (e) {
      if (!msg) return;
      setText("who", "Signed out");
      msg.textContent = `${e.message} - redirecting to login.`;
      msg.className = "dash-msg err";
      setTimeout(() => { location.href = "../auth/login.html"; }, 1400);
    }
  })();
})();
