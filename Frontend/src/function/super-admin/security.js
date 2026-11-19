// src/function/super-admin/security.js - authenticator app (TOTP) devices.
// Pair: security.html <-> /api/super-admin/2fa.
// Sign-in stays single-step; a code from any paired device is the step-up
// check for API credential changes. Pairing is multi-device (server limit 5)
// and removing a device requires a current code.
(function () {
  const msg = document.getElementById("msg");
  const tfaStatus = document.getElementById("tfaStatus");
  const tfaNote = document.getElementById("tfaNote");
  const tfaActions = document.getElementById("tfaActions");
  const tfaSetup = document.getElementById("tfaSetup");
  const tfaSetupCode = document.getElementById("tfaSetupCode");
  const tfaMsgEl = document.getElementById("tfaSecurityMsg");
  let paired = false;

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

  function setMsg(text, kind = "") {
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || "";
    msg.className = `dash-msg${kind ? ` ${kind}` : ""}`;
  }

  function setTfaMsg(text, kind = "") {
    if (!tfaMsgEl) return;
    tfaMsgEl.textContent = text || "";
    tfaMsgEl.className = `security-msg${kind ? ` is-${kind}` : ""}`;
  }

  function renderDevices(devices) {
    const list = document.getElementById("tfaDevices");
    if (!list) return;
    list.replaceChildren();
    if (!Array.isArray(devices) || devices.length === 0) {
      list.hidden = true;
      return;
    }
    devices.forEach((device) => {
      const item = make("li", "security-device");
      const info = make("div", "security-device-info");
      info.appendChild(make("strong", "", device.label || "Authenticator device"));
      const meta = [];
      if (device.createdAt) meta.push(`Added ${formatDate(device.createdAt)}`);
      meta.push(
        device.lastUsedAt ? `Last used ${formatDate(device.lastUsedAt)}` : "Not used yet"
      );
      info.appendChild(make("span", "", meta.join(" · ")));
      item.appendChild(info);

      // The server refuses to remove the last device; hide the button too.
      if (devices.length > 1) {
        const remove = make(
          "button",
          "btn btn-ghost security-danger security-device-remove",
          "Remove"
        );
        remove.type = "button";
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            await removeSecurityDevice(device.id, device.label || "this device");
          } finally {
            remove.disabled = false;
          }
        });
        item.appendChild(remove);
      }
      list.appendChild(item);
    });
    list.hidden = false;
  }

  function renderSecurity(status) {
    const enabled = !!(status && status.enabled);
    const devices = Array.isArray(status && status.devices) ? status.devices : [];
    paired = enabled;
    if (tfaStatus) {
      tfaStatus.textContent = enabled
        ? `${devices.length} device${devices.length === 1 ? "" : "s"}`
        : "Off";
      tfaStatus.className = `settings-badge ${enabled ? "is-active" : "is-declined"}`;
    }
    if (tfaNote) {
      const enrolled = status && status.enrolledAt
        ? ` First paired ${formatDate(status.enrolledAt)}.`
        : "";
      const used = status && status.lastUsedAt
        ? ` Last used ${formatDate(status.lastUsedAt)}.`
        : "";
      if (!enabled) {
        tfaNote.textContent =
          "2FA is off. Pair an authenticator app before adding, replacing or clearing API keys. Sign-in does not require it.";
      } else if (devices.length === 1) {
        tfaNote.textContent =
          `1 authenticator device paired. A code from it is required when adding, replacing or clearing an API credential. Add a second device so a lost phone doesn’t lock you out.${enrolled}${used}`;
      } else {
        tfaNote.textContent =
          `${devices.length} authenticator devices paired. A code from any of them is accepted when adding, replacing or clearing an API credential.${enrolled}${used}`;
      }
    }
    renderDevices(enabled ? devices : []);
    if (tfaActions) tfaActions.hidden = false;
    if (tfaSetup) tfaSetup.hidden = true;
    const reenroll = document.getElementById("tfaReenroll");
    const disable = document.getElementById("tfaDisable");
    if (reenroll) {
      const limit = Number(status && status.deviceLimit) || 5;
      const atLimit = enabled && devices.length >= limit;
      reenroll.textContent = enabled ? "Add another device" : "Set up authenticator";
      reenroll.hidden = atLimit;
    }
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
      setTfaMsg(e.message, "err");
    }
  }

  async function beginSecuritySetup() {
    let code = "";
    if (paired) {
      const entered = await dashPrompt(
        "Enter the current 6-digit code from an already-paired device before adding another one.",
        "6-digit code",
        "",
        "Add authenticator device"
      );
      if (entered === null) return;
      code = String(entered).replace(/\D/g, "");
      if (code.length !== 6) {
        setTfaMsg("Enter the current 6-digit code from an already-paired device.", "err");
        return;
      }
    }
    const enteredLabel = await dashPrompt(
      paired
        ? "Name this device so you can tell it apart later (for example “Pixel 9” or “Office tablet”)."
        : "Name this device so you can tell it apart later. Optional — leave blank for “Primary device”.",
      "Device name",
      "",
      paired ? "Add authenticator device" : "Set up authenticator"
    );
    if (enteredLabel === null) return;
    const label = String(enteredLabel).trim().slice(0, 40);

    const btn = document.getElementById("tfaReenroll");
    if (btn) btn.disabled = true;
    setTfaMsg("Preparing your QR code…");
    try {
      const data = await setupSuperAdminTwoFactor(code, label);
      document.getElementById("tfaSetupQr").src = data.qrDataUrl;
      document.getElementById("tfaSetupSecret").textContent =
        String(data.secret || "").match(/.{1,4}/g)?.join(" ") || data.secret;
      tfaSetup.hidden = false;
      tfaActions.hidden = true;
      tfaSetupCode.value = "";
      setTfaMsg(
        `Scan this QR code with “${data.label || label || "the new device"}”, then enter the 6-digit code to confirm. The devices already paired stay active.`,
        "ok"
      );
      document.getElementById("tfaSetup").scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
      tfaSetupCode.focus();
    } catch (e) {
      setTfaMsg(e.message, "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function cancelSecuritySetup() {
    if (tfaSetup) tfaSetup.hidden = true;
    if (tfaActions) tfaActions.hidden = false;
    setTfaMsg("");
  }

  async function enableSecurity(event) {
    event.preventDefault();
    const code = tfaSetupCode.value.replace(/\D/g, "");
    if (code.length !== 6) {
      setTfaMsg("Enter the 6-digit code from your authenticator app.", "err");
      tfaSetupCode.focus();
      return;
    }
    const btn = document.getElementById("tfaEnable");
    if (btn) btn.disabled = true;
    setTfaMsg("Verifying…");
    try {
      const status = await enableSuperAdminTwoFactor(code);
      renderSecurity(status);
      const count = Array.isArray(status.devices) ? status.devices.length : 1;
      setTfaMsg(
        count > 1
          ? `Device confirmed. ${count} devices can now approve API key changes.`
          : "Authenticator app confirmed. You’ll use it when changing API keys.",
        "ok"
      );
      dashToast(
        count > 1 ? "Authenticator device added." : "Two-factor authentication is on.",
        "ok"
      );
    } catch (e) {
      setTfaMsg(e.message, "err");
      tfaSetupCode.value = "";
      tfaSetupCode.focus();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /** Remove one paired device. Any remaining device keeps working. */
  async function removeSecurityDevice(deviceId, label) {
    const entered = await dashPrompt(
      `Enter the current 6-digit code to remove “${label}”. The other paired devices keep working.`,
      "6-digit code",
      "",
      "Remove authenticator device"
    );
    if (entered === null) return;
    const code = String(entered).replace(/\D/g, "");
    if (code.length !== 6) {
      setTfaMsg("Enter the 6-digit code from an authenticator app.", "err");
      return;
    }
    setTfaMsg(`Removing “${label}”…`);
    try {
      const status = await removeSuperAdminTwoFactorDevice(deviceId, code);
      renderSecurity(status);
      const left = Array.isArray(status.devices) ? status.devices.length : 0;
      setTfaMsg(
        `Removed “${label}”. ${left} device${left === 1 ? "" : "s"} remain.`,
        "ok"
      );
      dashToast("Authenticator device removed.", "ok");
    } catch (e) {
      setTfaMsg(e.message, "err");
    }
  }

  async function disableSecurity() {
    const entered = await dashPrompt(
      "Enter the current 6-digit code from any authenticator device. Turning 2FA off removes every paired device and blocks API key changes until you pair one again.",
      "6-digit code",
      "",
      "Turn off two-factor authentication"
    );
    if (entered === null) return;
    const code = String(entered).replace(/\D/g, "");
    if (code.length !== 6) {
      setTfaMsg("Enter the current 6-digit code to turn 2FA off.", "err");
      return;
    }
    const btn = document.getElementById("tfaDisable");
    if (btn) btn.disabled = true;
    setTfaMsg("Turning off 2FA…");
    try {
      const status = await disableSuperAdminTwoFactor(code);
      renderSecurity(status);
      setTfaMsg("2FA is off. Pair an authenticator before changing API keys.", "ok");
      dashToast("Two-factor authentication is off.", "ok");
    } catch (e) {
      setTfaMsg(e.message, "err");
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
      dashRenderAvatar("avatar", {
        name: displayName,
        avatarUrl: me.avatarUrl,
        fallbackLetter: "S",
      });
      setMsg("");
      await loadSecurity();
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
