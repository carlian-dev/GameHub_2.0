// src/function/auth/login.js - single-step login logic.
// Pair: src/function/auth/login.html <-> server/src/routes/auth.routes.js
// (POST /api/login, POST /api/auth/google, POST /api/login/2fa...).
// Valid ACTIVE accounts log straight in (email/username + password, or Google)
// and redirect by role (staffHome): super_admin -> integration toggles,
// admin -> admin dashboard, cashier -> cashier dashboard. Pending/archived/
// declined show the Backend message verbatim. Enter submits via the real
// <form>; per-field validation marks aria-invalid + red border until fixed.
// Super admins must pass a second step: an authenticator-app code, or a
// one-time QR enrollment when no app is paired yet. No session is created
// until that code is verified.

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

// --- Super-admin second step: authenticator app (TOTP) ---
let tfaMode = "challenge";

const TFA_COPY = {
  challenge: {
    title: "Check your authenticator app",
    text: "Enter the 6-digit code from your authenticator app to finish signing in.",
  },
  enroll: {
    title: "Secure your super admin account",
    text: "Super admin sign-ins require an authenticator app. Scan the QR code, then enter the 6-digit code it shows.",
  },
};

function tfaMsg(text, kind = "") {
  const msg = document.getElementById("tfaMsg");
  if (!msg) return;
  msg.textContent = text || "";
  msg.className = kind;
}

function setTfaMode(mode) {
  tfaMode = mode === "enroll" ? "enroll" : "challenge";
  const copy = TFA_COPY[tfaMode];
  document.getElementById("tfaTitle").textContent = copy.title;
  document.getElementById("tfaText").textContent = copy.text;
  document.getElementById("tfaQrWrap").hidden = tfaMode !== "enroll";
  document.getElementById("tfaGo").textContent =
    tfaMode === "enroll" ? "Confirm and sign in" : "Verify and continue";
}

async function loadEnrollmentQr() {
  const wrap = document.getElementById("tfaQrWrap");
  tfaMsg("Preparing your QR code…");
  try {
    const data = await getTwoFactorSetup();
    document.getElementById("tfaQr").src = data.qrDataUrl;
    document.getElementById("tfaSecret").textContent =
      String(data.secret || "").match(/.{1,4}/g)?.join(" ") || data.secret;
    wrap.hidden = false;
    tfaMsg("");
    document.getElementById("tfaCode").focus();
  } catch (e) {
    // Another tab may have completed enrollment; fall back to the code step.
    if (/already enabled/i.test(e.message)) {
      setTfaMode("challenge");
      tfaMsg("This account already has an authenticator. Enter its 6-digit code.");
      document.getElementById("tfaCode").focus();
      return;
    }
    tfaMsg(e.message, "err");
  }
}

function showTwoFactor(resp) {
  document.getElementById("step1").hidden = true;
  const step2 = document.getElementById("step2fa");
  step2.hidden = false;
  document.getElementById("tfaCode").value = "";
  document.getElementById("tfaCode").setAttribute("aria-invalid", "false");
  tfaMsg("");
  setTfaMode(resp && resp.enrollmentRequired ? "enroll" : "challenge");
  if (tfaMode === "enroll") loadEnrollmentQr();
  else document.getElementById("tfaCode").focus();
}

function showPasswordStep() {
  document.getElementById("step2fa").hidden = true;
  document.getElementById("step1").hidden = false;
  document.getElementById("tfaCode").value = "";
  tfaMsg("");
  const msg = document.getElementById("msg");
  msg.textContent = "";
  msg.className = "";
  document.getElementById("email").focus();
}

async function submitTwoFactor() {
  const input = document.getElementById("tfaCode");
  const code = input.value.replace(/\D/g, "");
  if (code.length !== 6) {
    input.setAttribute("aria-invalid", "true");
    tfaMsg("Enter the 6-digit code from your authenticator app.", "err");
    input.focus();
    return;
  }
  const go = document.getElementById("tfaGo");
  go.disabled = true;
  tfaMsg("Verifying…");
  try {
    const data = await verifyTwoFactorLogin(code);
    welcomeAndGo(data);
  } catch (e) {
    tfaMsg(e.message, "err");
    input.value = "";
    input.setAttribute("aria-invalid", "false");
    input.focus();
    // Expired/too many attempts: the pending session is gone; start over.
    if (/sign in again/i.test(e.message)) setTimeout(showPasswordStep, 1600);
  } finally {
    go.disabled = false;
  }
}

async function backToPassword() {
  try {
    await cancelTwoFactorLogin();
  } catch {
    // The pending session may already have expired; still return to step 1.
  }
  showPasswordStep();
}

async function submitLogin() {
  const msg = document.getElementById("msg");
  const emailEl = document.getElementById("email");
  const pwEl = document.getElementById("password");
  const go = document.getElementById("go");
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
    if (resp.twoFactorRequired) {
      showTwoFactor(resp);
      return;
    }
    welcomeAndGo(resp);
  } catch (e) {
    // Tokens are single-use: let the guest retry after any rejected attempt.
    GameHubRecaptcha.reset();
    msg.textContent = e.message;
    msg.className = "err";
  } finally {
    go.disabled = false;
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

// Authenticator step listeners.
document.getElementById("tfaForm").addEventListener("submit", (e) => {
  e.preventDefault();
  submitTwoFactor();
});
document.getElementById("tfaBack").addEventListener("click", backToPassword);
document.getElementById("tfaCode").addEventListener("input", (e) => {
  // Keep only digits: authenticator apps sometimes show "123 456".
  const digits = e.currentTarget.value.replace(/\D/g, "").slice(0, 6);
  if (e.currentTarget.value !== digits) e.currentTarget.value = digits;
  e.currentTarget.setAttribute("aria-invalid", "false");
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
          if (resp.twoFactorRequired) {
            showTwoFactor(resp);
          } else if (resp.step === "approval") {
            msg.textContent = "Google account created! Status: pending — awaiting admin approval.";
            msg.className = "ok";
          } else welcomeAndGo(resp);
        } catch (e) { msg.textContent = e.message; msg.className = "err"; }
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
    if (divider) divider.hidden = false;
    gbtn.hidden = false;
  } catch { /* Google unavailable/disabled — password form still works */ }
}
initGoogleLogin();
GameHubRecaptcha.render(document.getElementById("recaptchaSlot"));
