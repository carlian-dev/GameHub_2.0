// src/function/auth/reset-password.js - reset password execution logic.
// Pair: reset-password.html <-> server/src/routes/auth.routes.js (GET/POST /api/reset-password)

const resetToken = new URLSearchParams(location.search).get("token") || "";

function setFieldError(input, hasError) {
  input.setAttribute("aria-invalid", hasError ? "true" : "false");
  const field = input.closest(".field");
  if (field) field.classList.toggle("invalid", hasError);
}

function clearErrors() {
  ["password", "confirm"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) setFieldError(el, false);
  });
}

function showDead(msg) {
  document.getElementById("formCard").hidden = true;
  document.getElementById("successCard").hidden = true;
  const deadCard = document.getElementById("deadCard");
  deadCard.hidden = false;
  if (msg) {
    document.getElementById("deadMsg").textContent = msg;
  }
}

async function boot() {
  if (!resetToken) {
    showDead("A valid password reset token is required. Please check your link or request a new one.");
    return;
  }

  try {
    const result = await checkResetToken(resetToken);
    if (result && result.valid) {
      document.getElementById("email").value = result.email || "";
      document.getElementById("formCard").hidden = false;
      const slot = document.getElementById("recaptchaSlot");
      if (slot && window.GameHubRecaptcha) {
        GameHubRecaptcha.render(slot);
      }
    } else {
      showDead("This password reset link is invalid or has expired.");
    }
  } catch (e) {
    const m = (e.message || "").toLowerCase();
    if (m.includes("expired")) {
      showDead("This password reset link has expired (links expire after 1 hour). Please request a new one.");
    } else {
      showDead("This password reset link is invalid or has already been used. Please request a new one.");
    }
  }
}

// Password eye toggle
(() => {
  const btn = document.querySelector(".pw-eye");
  const input = document.getElementById("password");
  if (!btn || !input) return;
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    btn.setAttribute("aria-pressed", show ? "true" : "false");
    btn.querySelector(".ic-eye").hidden = show;
    btn.querySelector(".ic-eye-off").hidden = !show;
    input.focus();
  });
})();

async function submitReset() {
  const msg = document.getElementById("msg");
  const pwEl = document.getElementById("password");
  const cfEl = document.getElementById("confirm");
  const go = document.getElementById("go");
  clearErrors();

  const pw = pwEl.value;
  const cf = cfEl.value;

  let ok = true;
  if (!pw || pw.length < 8) {
    setFieldError(pwEl, true);
    msg.textContent = "Password must be at least 8 characters.";
    msg.className = "err";
    pwEl.focus();
    return;
  }

  if (pw !== cf) {
    setFieldError(cfEl, true);
    msg.textContent = "Passwords do not match.";
    msg.className = "err";
    cfEl.focus();
    return;
  }

  msg.textContent = "Updating password...";
  msg.className = "";
  go.disabled = true;

  try {
    const human = window.GameHubRecaptcha ? await GameHubRecaptcha.config() : { enabled: false };
    const recaptchaToken = human.enabled ? await GameHubRecaptcha.token() : "";

    await resetPassword(resetToken, pw, recaptchaToken);
    document.getElementById("formCard").hidden = true;
    document.getElementById("pageLede").hidden = true;
    document.getElementById("successCard").hidden = false;
  } catch (e) {
    if (window.GameHubRecaptcha) GameHubRecaptcha.reset();
    msg.textContent = e.message || "Failed to update password.";
    msg.className = "err";
  } finally {
    go.disabled = false;
  }
}

document.getElementById("resetForm").addEventListener("submit", (e) => {
  e.preventDefault();
  submitReset();
});

boot();
