// src/function/super-admin/login-protection.js - failed auth attempt limit.
// Pair: login-protection.html <-> /api/super-admin/settings/login-protection.
// Guard: role=super_admin stays; admin/cashier go to their dashboards and
// guests go to login. Settings apply immediately and keep active IP counters.
(function () {
  const msg = document.getElementById("msg");
  const form = document.getElementById("loginProtectionForm");
  const maxAttemptsInput = document.getElementById("authMaxAttempts");
  const windowMinutesInput = document.getElementById("authWindowMinutes");
  const statusEl = document.getElementById("loginProtectionMsg");
  const saveBtn = document.getElementById("saveLoginProtection");

  function setMsg(text, kind = "") {
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || "";
    msg.className = `dash-msg${kind ? ` ${kind}` : ""}`;
  }

  function setStatus(text, kind = "") {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = `security-msg${kind ? ` is-${kind}` : ""}`;
  }

  async function load() {
    try {
      const data = await getSuperAdminAuthRateLimit();
      const settings = data && data.authRateLimit;
      if (!settings) throw new Error("Login protection settings were not returned.");
      maxAttemptsInput.value = String(settings.maxAttempts);
      windowMinutesInput.value = String(settings.windowMinutes);
      setStatus(
        settings.enabled
          ? "Current limits are active."
          : "Rate limiting is disabled by the server environment; these values will apply when it is enabled."
      );
    } catch (e) {
      setStatus(e.message, "err");
      dashToast(e.message, "err");
    }
  }

  async function save(event) {
    event.preventDefault();
    const maxAttempts = Number(maxAttemptsInput.value);
    const windowMinutes = Number(windowMinutesInput.value);
    if (
      !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100 ||
      !Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440
    ) {
      setStatus("Enter 1–100 attempts and a 1–1,440 minute window.", "err");
      return;
    }

    if (saveBtn) saveBtn.disabled = true;
    setStatus("Saving login protection settings…");
    try {
      const data = await updateSuperAdminAuthRateLimit({
        maxAttempts,
        windowMinutes,
      });
      const settings = data && data.authRateLimit;
      if (!settings) throw new Error("Updated login protection settings were not returned.");
      maxAttemptsInput.value = String(settings.maxAttempts);
      windowMinutesInput.value = String(settings.windowMinutes);
      setStatus(
        settings.enabled
          ? `Saved: ${settings.maxAttempts} failed attempts per ${settings.windowMinutes} minutes.`
          : "Saved, but rate limiting is disabled by the server environment.",
        "ok"
      );
      dashToast("Login protection settings saved.", "ok");
    } catch (e) {
      setStatus(e.message, "err");
      dashToast(e.message, "err");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  form?.addEventListener("submit", save);

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
