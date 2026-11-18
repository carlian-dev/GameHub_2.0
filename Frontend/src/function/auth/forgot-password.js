// src/function/auth/forgot-password.js - password reset request logic.
// Pair: forgot-password.html <-> server/src/routes/auth.routes.js (POST /api/forgot-password)

function setFieldError(input, hasError) {
  input.setAttribute("aria-invalid", hasError ? "true" : "false");
  const field = input.closest(".field");
  if (field) field.classList.toggle("invalid", hasError);
}

function clearErrors() {
  setFieldError(document.getElementById("email"), false);
}

async function boot() {
  const slot = document.getElementById("recaptchaSlot");
  if (slot && window.GameHubRecaptcha) {
    GameHubRecaptcha.render(slot);
  }
}

async function submitForgot() {
  const msg = document.getElementById("msg");
  const emailEl = document.getElementById("email");
  const go = document.getElementById("go");
  clearErrors();

  const email = emailEl.value.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError(emailEl, true);
    msg.textContent = "Please enter a valid email address.";
    msg.className = "err";
    emailEl.focus();
    return;
  }

  msg.textContent = "Sending reset link...";
  msg.className = "";
  go.disabled = true;

  try {
    const human = window.GameHubRecaptcha ? await GameHubRecaptcha.config() : { enabled: false };
    const recaptchaToken = human.enabled ? await GameHubRecaptcha.token() : "";
    if (human.enabled && !recaptchaToken) {
      msg.textContent = "Please complete the reCAPTCHA check.";
      msg.className = "err";
      return;
    }

    const resp = await forgotPassword(email, recaptchaToken);
    document.getElementById("forgotCard").hidden = true;
    document.getElementById("formLede").hidden = true;
    const successCard = document.getElementById("successCard");
    successCard.hidden = false;
    if (resp && resp.message) {
      document.getElementById("successMsg").textContent = resp.message;
    }
  } catch (e) {
    if (window.GameHubRecaptcha) GameHubRecaptcha.reset();
    msg.textContent = e.message || "Failed to request password reset.";
    msg.className = "err";
  } finally {
    go.disabled = false;
  }
}

document.getElementById("forgotForm").addEventListener("submit", (e) => {
  e.preventDefault();
  submitForgot();
});

boot();
