// src/function/cashiers/cashier-settings.js - cashier profile settings.
// Guard: cashiers only. The profile name/nickname is the only editable field;
// email, username, role and status are read-only (server also rejects them).
// Dark mode + logout live in the shared settings gear menu (js/dash.js).
(function () {
  const msg = document.getElementById("settingsMsg");
  const form = document.getElementById("profileForm");
  const input = document.getElementById("displayName");
  const hint = document.getElementById("displayNameHint");
  const saveBtn = document.getElementById("saveProfile");
  const resetBtn = document.getElementById("resetProfile");
  const DEFAULT_HINT =
    "Use your name or a nickname. This is shown across the dashboard, activity log and receipts.";

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

  function initialOf(name) {
    return String(name || "").trim().charAt(0).toUpperCase() || "C";
  }

  function paint() {
    if (!me) return;
    const name = displayNameOf(me);
    const initial = initialOf(name);

    setText("who", name);
    setText("avatar", initial);
    setText("profileAvatar", initial);
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

    input.value = me.displayName || "";
  }

  function clearFieldError() {
    dashFieldError(input, false);
    if (hint) {
      hint.textContent = DEFAULT_HINT;
      hint.classList.remove("err");
    }
  }

  function validate() {
    const value = input.value.trim();
    if (value.length < 2 || value.length > 60) {
      dashFieldError(input, true);
      if (hint) {
        hint.textContent = "Use 2-60 characters for your profile name.";
        hint.classList.add("err");
      }
      input.focus();
      return null;
    }
    clearFieldError();
    return value;
  }

  input.addEventListener("input", clearFieldError);

  resetBtn.addEventListener("click", () => {
    if (!me) return;
    input.value = me.displayName || "";
    clearFieldError();
    setMsg("", "");
    input.focus();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!me) return;

    const value = validate();
    if (value === null) return;

    const current = String(me.displayName || "").trim();
    if (value === current) {
      setMsg("That is already your profile name.", "ok");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.classList.add("busy");
    setMsg("Saving your profile…", "loading");

    try {
      const result = await updateMyProfile(value);
      me.displayName = result.displayName || value;
      paint();
      setMsg("Profile updated.", "ok");
      dashToast("Profile updated.", "ok");
    } catch (err) {
      setMsg(err.message, "err");
      dashToast(err.message, "err");
    } finally {
      saveBtn.disabled = false;
      saveBtn.classList.remove("busy");
    }
  });

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
