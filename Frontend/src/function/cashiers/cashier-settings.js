// src/function/cashiers/cashier-settings.js - cashier profile settings.
// Guard: cashiers only. Profile name/nickname and profile picture are editable;
// email, username, role and status are read-only.
(function () {
  const msg = document.getElementById("settingsMsg");
  const editBtn = document.getElementById("editProfileBtn");

  let me = null;

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
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

  function setMsg(text, kind = "") {
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || "";
    msg.className = `dash-msg${kind ? ` ${kind}` : ""}`;
  }

  function displayNameOf(user) {
    return user.displayName || user.email || user.username || "Cashier";
  }

  function paint() {
    if (!me) return;
    const name = displayNameOf(me);

    setText("who", name);
    dashRenderAvatar("avatar", { name, avatarUrl: me.avatarUrl, fallbackLetter: "C" });
    dashRenderAvatar("profileAvatar", { name, avatarUrl: me.avatarUrl, fallbackLetter: "C" });
    setText("profileName", name);
    setText("profileEmail", me.email || "");
    setText("pfEmail", me.email || "—");
    setText("pfUsername", me.username || "—");
    setText("pfRole", "Cashier");
    setText("pfProvider", me.authProvider === "google" ? "Google" : "Local");
    setText("pfCreated", formatDate(me.createdAt));

    const status = document.getElementById("pfStatus");
    if (status) {
      status.textContent = me.status || "unknown";
      status.className = `settings-badge is-${me.status || "unknown"}`;
    }
  }

  if (editBtn) {
    editBtn.addEventListener("click", () => {
      if (!me) return;
      dashEditProfile({
        user: me,
        onSave: async ({ displayName, avatarUrl }) => {
          const result = await updateMyProfile({ displayName, avatarUrl });
          me.displayName = result.displayName || displayName;
          me.avatarUrl = result.avatarUrl !== undefined ? result.avatarUrl : avatarUrl;
          paint();
          dashToast("Profile updated.", "ok");
        },
      });
    });
  }

  (async () => {
    try {
      me = await cashierGuard();
      paint();
      setMsg("", "");
    } catch (e) {
      if (e && e.message === "redirect") return;
      setText("who", "Signed out");
      setMsg(`${e.message} - redirecting to login.`, "err");
      setTimeout(() => {
        location.href = "../auth/login.html";
      }, 1400);
    }
  })();
})();
