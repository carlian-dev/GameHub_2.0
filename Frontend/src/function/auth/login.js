// src/function/auth/login.js - single-step login logic.
// Pair: src/function/auth/login.html <-> Backend/src/function/auth/login.php + google.php.
// Valid ACTIVE accounts log straight in (email/username + password, or Google)
// and redirect by role: admin -> ../admin/admin-dashboard.html,
// cashier -> ../cashiers/cashier-dashboard.html. Pending/archived/declined show
// the Backend message verbatim. Enter submits via the real <form>; per-field
// validation marks aria-invalid + red border until fixed.

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
  location.href = data.role === "admin" ? "../admin/admin-dashboard.html" : "../cashiers/cashier-dashboard.html";
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
    welcomeAndGo(await login(emailEl.value.trim(), pwEl.value));
  } catch (e) {
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
        } catch (e) { msg.textContent = e.message; msg.className = "err"; }
      },
    });
    google.accounts.id.renderButton(gbtn, {
      theme: "outline", size: "large", text: "signin_with", width: 280,
    });
    // Reveal only after the button rendered successfully.
    if (divider) divider.hidden = false;
    gbtn.hidden = false;
  } catch { /* Google unavailable/disabled — password form still works */ }
}
initGoogleLogin();
