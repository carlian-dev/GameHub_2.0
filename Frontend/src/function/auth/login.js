// src/function/auth/login.js - single-step login logic.
// Pair: src/function/auth/login.html <-> server/src/routes/auth.routes.js
// (POST /api/login, POST /api/auth/google).
// Valid ACTIVE accounts log straight in (email/username + password, or Google)
// and redirect by role (staffHome): super_admin -> integration toggles,
// admin -> admin dashboard, cashier -> cashier dashboard. Pending/archived/
// declined show the Backend message verbatim. Enter submits via the real
// <form>; per-field validation marks aria-invalid + red border until fixed.
// Super-admin sign-in is single-step; the authenticator app is only requested
// later, when adding, replacing or clearing an API credential.

function setFieldError(input, hasError) {
  input.setAttribute("aria-invalid", hasError ? "true" : "false");
  const field = input.closest(".field");
  if (field) field.classList.toggle("invalid", hasError);
}

function clearErrors() {
  ["email", "password"].forEach((id) => setFieldError(document.getElementById(id), false));
}

function welcomeAndGo(data) {
  const who = data.email || data.username || "staff";
  const msg = document.getElementById("msg");
  msg.textContent = `Welcome ${who} (${data.role}).`;
  msg.className = "ok";
  location.href = staffHome(data.role);
}

let loginCooldownUntil = 0;
let loginCooldownTimer = null;
let googleLoginAvailable = false;

function updateLoginCooldown() {
  const remaining = Math.max(0, Math.ceil((loginCooldownUntil - Date.now()) / 1000));
  const cooldown = document.getElementById("loginCooldown");
  if (!remaining) {
    clearInterval(loginCooldownTimer);
    loginCooldownTimer = null;
    loginCooldownUntil = 0;
    cooldown.hidden = true;
    cooldown.textContent = "";
    document.getElementById("go").disabled = false;
    if (googleLoginAvailable) {
      document.querySelector(".auth-divider").hidden = false;
      document.getElementById("gbtn").hidden = false;
    }
    const msg = document.getElementById("msg");
    msg.textContent = "You can try signing in again.";
    msg.className = "";
    const attempts = document.getElementById("loginAttempts");
    attempts.hidden = true;
    attempts.textContent = "";
    attempts.className = "login-attempts";
    return;
  }

  cooldown.hidden = false;
  cooldown.textContent =
    `Retry available in ${Math.floor(remaining / 60)}:` +
    `${String(remaining % 60).padStart(2, "0")}`;
}

function startLoginCooldown(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return false;
  loginCooldownUntil = Date.now() + Math.ceil(seconds) * 1000;
  document.getElementById("go").disabled = true;
  if (googleLoginAvailable) {
    document.querySelector(".auth-divider").hidden = true;
    document.getElementById("gbtn").hidden = true;
  }
  clearInterval(loginCooldownTimer);
  updateLoginCooldown();
  loginCooldownTimer = setInterval(updateLoginCooldown, 1000);
  return true;
}

function showRateLimit(error) {
  if (!error || error.status !== 429) return false;
  const msg = document.getElementById("msg");
  msg.textContent = "Too many requests. Please wait before trying to sign in again.";
  msg.className = "err";
  startLoginCooldown(error.retryAfterSeconds);
  return true;
}

function showAttemptsRemaining(error) {
  const attempts = document.getElementById("loginAttempts");
  if (!Number.isInteger(error && error.authAttemptsRemaining)) {
    attempts.hidden = true;
    attempts.textContent = "";
    return;
  }

  const remaining = error.authAttemptsRemaining;
  attempts.hidden = false;
  if (remaining === 0) {
    attempts.textContent =
      "No failed authentication attempts remain for this IP. Sign-in is temporarily paused.";
    attempts.classList.add("is-exhausted");
    if (error.status !== 429) {
      startLoginCooldown(
        error.authAttemptsResetSeconds || error.retryAfterSeconds
      );
    }
    return;
  }

  attempts.classList.remove("is-exhausted");
  attempts.textContent =
    `${remaining} unsuccessful authentication ` +
    `${remaining === 1 ? "request remains" : "requests remain"} for this IP before temporary lockout.`;
}

function showLoginError(error) {
  if (!showRateLimit(error)) {
    const msg = document.getElementById("msg");
    msg.textContent = error.message;
    msg.className = "err";
  }
  showAttemptsRemaining(error);
}

async function submitLogin() {
  const msg = document.getElementById("msg");
  const emailEl = document.getElementById("email");
  const pwEl = document.getElementById("password");
  const go = document.getElementById("go");
  if (loginCooldownUntil > Date.now()) return;
  clearErrors();
  let ok = true;
  if (!emailEl.value.trim()) { setFieldError(emailEl, true); ok = false; }
  if (!pwEl.value) { setFieldError(pwEl, true); ok = false; }
  if (!ok) {
    msg.textContent = "Enter your username (or email) and password.";
    msg.className = "err";
    (emailEl.getAttribute("aria-invalid") === "true" ? emailEl : pwEl).focus();
    return;
  }
  msg.textContent = "Checking...";
  msg.className = "";
  go.disabled = true;
  try {
    // reCAPTCHA is injected only when the admin enabled it; when off this
    // resolves immediately and no token is sent.
    const human = await GameHubRecaptcha.config();
    const recaptchaToken = human.enabled ? await GameHubRecaptcha.token() : "";
    if (human.enabled && !recaptchaToken) {
      msg.textContent = "Please complete the reCAPTCHA check.";
      msg.className = "err";
      return;
    }
    const resp = await login(emailEl.value.trim(), pwEl.value, recaptchaToken);
    welcomeAndGo(resp);
  } catch (e) {
    // Tokens are single-use: let the guest retry after any rejected attempt.
    GameHubRecaptcha.reset();
    showLoginError(e);
  } finally {
    go.disabled = loginCooldownUntil > Date.now();
  }
}

document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  submitLogin();
});
document.getElementById("go").addEventListener("click", (e) => {
  // Backstop for browsers without form support; submit handler does the work.
  if (e.currentTarget.form) return;
  submitLogin();
});

// Password visibility toggle (reference: eye icon inside the field).
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

// "Continue with Google": the admin API decides whether the integration is
// on. The GIS script is injected only after /api/config confirms Google Auth
// is enabled AND a client ID exists; otherwise the divider/button stay hidden
// and the password form works normally.
let googleScriptPromise = null;
function loadGoogleScript() {
  if (window.google && window.google.accounts) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google sign-in is unavailable"));
    document.head.appendChild(s);
  });
  return googleScriptPromise;
}

async function initGoogleLogin() {
  const divider = document.querySelector(".auth-divider");
  const gbtn = document.getElementById("gbtn");
  try {
    const data = await getAppConfig();
    const auth = data && data.integrations ? data.integrations.googleAuth : null;
    if (!auth || !auth.enabled || !auth.clientId) return;
    await loadGoogleScript();
    if (!window.google || !window.google.accounts) return;
    google.accounts.id.initialize({
      client_id: auth.clientId,
      callback: async ({ credential }) => {
        const msg = document.getElementById("msg");
        try {
          const resp = await loginWithGoogle(credential);
          if (resp.step === "approval") {
            msg.textContent = "Google account created! Status: pending — awaiting admin approval.";
            msg.className = "ok";
          } else welcomeAndGo(resp);
        } catch (e) {
          showLoginError(e);
        }
      },
    });
    const card = gbtn.closest(".staff-card");
    let buttonWidth = 320;
    if (card) {
      const cs = getComputedStyle(card);
      const inner =
        card.clientWidth -
        parseFloat(cs.paddingLeft || 0) -
        parseFloat(cs.paddingRight || 0);
      buttonWidth = Math.max(240, Math.min(340, Math.floor(inner)));
    }
    google.accounts.id.renderButton(gbtn, {
      theme: "filled_black",
      size: "large",
      text: "signin_with",
      locale: "en",
      width: buttonWidth,
    });
    // Reveal only after the button rendered successfully.
    googleLoginAvailable = true;
    if (divider) divider.hidden = false;
    gbtn.hidden = false;
  } catch { /* Google unavailable/disabled — password form still works */ }
}
initGoogleLogin();
GameHubRecaptcha.render(document.getElementById("recaptchaSlot"));
