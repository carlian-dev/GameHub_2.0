// src/function/auth/reset-password.js - reset password execution logic.
// Pair: reset-password.html <-> server/src/routes/auth.routes.js (GET/POST /api/reset-password)

const resetToken = new URLSearchParams(location.search).get("token") || "";

const COMMON_WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "admin123",
  "gamehub123",
  "letmein123",
  "welcome123",
  "changeme123",
  "iloveyou123",
]);

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

function evaluatePassword(pw, email = "") {
  const len = pw ? pw.length : 0;
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const poolCount =
    (hasLower ? 1 : 0) +
    (hasUpper ? 1 : 0) +
    (hasNumber ? 1 : 0) +
    (hasSymbol ? 1 : 0);

  const lowerPw = (pw || "").toLowerCase();
  let containsPersonalInfo = false;
  const emailPrefix = (email || "").split("@")[0].toLowerCase();
  if (emailPrefix.length >= 3 && lowerPw.includes(emailPrefix)) {
    containsPersonalInfo = true;
  }

  const isCommon = COMMON_WEAK_PASSWORDS.has(lowerPw);

  const checks = {
    length: len >= 8,
    cases: hasLower && hasUpper,
    number: hasNumber,
    symbol: hasSymbol,
  };

  if (len === 0) {
    return {
      level: "",
      label: "—",
      score: 0,
      checks: { length: false, cases: false, number: false, symbol: false },
      isValid: false,
      message: "Please enter a password.",
    };
  }

  const isWeak =
    len < 8 ||
    containsPersonalInfo ||
    isCommon ||
    poolCount < 2 ||
    (len < 10 && poolCount < 3);

  if (isWeak) {
    let message = "Weak password — add uppercase letters, numbers, or symbols.";
    if (len < 8) {
      message = "Password must be at least 8 characters.";
    } else if (containsPersonalInfo) {
      message = "Password should not contain your email address.";
    } else if (isCommon) {
      message = "Password is too common and predictable.";
    }
    return {
      level: "weak",
      label: "Weak",
      score: 1,
      checks,
      isValid: false,
      message,
    };
  }

  const isStrong = (len >= 10 && poolCount >= 3) || (len >= 8 && poolCount === 4);

  if (isStrong) {
    return {
      level: "strong",
      label: "Strong",
      score: 3,
      checks,
      isValid: true,
      message: "Strong password! Excellent account security.",
    };
  }

  return {
    level: "moderate",
    label: "Moderate",
    score: 2,
    checks,
    isValid: true,
    message: "Moderate password — add symbols or more characters for a strong password.",
  };
}

function updatePasswordUI() {
  const pwEl = document.getElementById("password");
  const emailEl = document.getElementById("email");
  const strengthBox = document.getElementById("pwStrengthBox");
  const strengthVal = document.getElementById("pwStrengthVal");

  if (!pwEl || !strengthBox || !strengthVal) return;

  const pw = pwEl.value;
  const email = emailEl ? emailEl.value : "";
  const evalResult = evaluatePassword(pw, email);

  strengthBox.setAttribute("data-strength", evalResult.level);
  strengthVal.textContent = evalResult.label;

  const ruleMap = [
    { id: "rule-length", ok: evalResult.checks.length },
    { id: "rule-cases", ok: evalResult.checks.cases },
    { id: "rule-number", ok: evalResult.checks.number },
    { id: "rule-symbol", ok: evalResult.checks.symbol },
  ];

  ruleMap.forEach(({ id, ok }) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle("valid", Boolean(pw && ok));
    }
  });

  updateConfirmUI();
}

function updateConfirmUI() {
  const pwEl = document.getElementById("password");
  const cfEl = document.getElementById("confirm");
  const hint = document.getElementById("confirmHint");
  if (!pwEl || !cfEl || !hint) return;

  const pw = pwEl.value;
  const cf = cfEl.value;

  if (!cf) {
    hint.hidden = true;
    hint.textContent = "";
    hint.className = "field-hint";
    setFieldError(cfEl, false);
    return;
  }

  hint.hidden = false;
  if (pw === cf) {
    hint.textContent = "✓ Passwords match.";
    hint.className = "field-hint valid";
    setFieldError(cfEl, false);
  } else {
    hint.textContent = "✗ Passwords do not match.";
    hint.className = "field-hint invalid";
  }
}

function initPasswordToggles() {
  document.querySelectorAll(".pw-eye").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target") || "password";
      const input = document.getElementById(targetId);
      if (!input) return;

      const isPw = input.type === "password";
      input.type = isPw ? "text" : "password";
      btn.setAttribute("aria-label", isPw ? "Hide password" : "Show password");
      btn.setAttribute("aria-pressed", isPw ? "true" : "false");
      const icEye = btn.querySelector(".ic-eye");
      const icEyeOff = btn.querySelector(".ic-eye-off");
      if (icEye) icEye.hidden = isPw;
      if (icEyeOff) icEyeOff.hidden = !isPw;
      input.focus();
    });
  });
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

  initPasswordToggles();

  const pwEl = document.getElementById("password");
  const cfEl = document.getElementById("confirm");
  if (pwEl) pwEl.addEventListener("input", updatePasswordUI);
  if (cfEl) cfEl.addEventListener("input", updateConfirmUI);
}

async function submitReset() {
  const msg = document.getElementById("msg");
  const pwEl = document.getElementById("password");
  const cfEl = document.getElementById("confirm");
  const emailEl = document.getElementById("email");
  const go = document.getElementById("go");
  clearErrors();

  const pw = pwEl.value;
  const cf = cfEl.value;
  const email = emailEl ? emailEl.value : "";

  const pwEval = evaluatePassword(pw, email);

  if (!pw || pw.length < 8) {
    setFieldError(pwEl, true);
    msg.textContent = "Password must be at least 8 characters.";
    msg.className = "err";
    pwEl.focus();
    return;
  }

  if (!pwEval.isValid || pwEval.level === "weak") {
    setFieldError(pwEl, true);
    msg.textContent = pwEval.message || "Password is too weak. Please choose a moderate or strong password.";
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
