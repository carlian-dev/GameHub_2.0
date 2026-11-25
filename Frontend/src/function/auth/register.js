// src/function/auth/register.js - invitation-gated signup logic.
// Pair: register.html <-> server/src/routes/auth.routes.js (token,
// expiry, single-use, and email match are ALL re-enforced server-side;
// page checks below are convenience only).
// Flow: ?token=... -> checkInvite -> valid: lock invited email into the form;
// invalid/expired/used/missing -> dead-end state (contact administrator).

const inviteToken = new URLSearchParams(location.search).get("token") || "";
let inviteEmail = "";
let inviteRole = "cashier";

const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "super_admin",
  "superadmin",
  "root",
  "system",
  "gamehub",
  "guest",
  "support",
  "api",
  "staff",
  "cashier",
  "null",
  "undefined",
]);

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

function dead(text) {
  document.getElementById("form").hidden = true;
  const d = document.getElementById("dead");
  document.getElementById("deadMsg").textContent = text;
  d.hidden = false;
}

function validateUsername(rawUsername) {
  const u = (rawUsername || "").trim().toLowerCase();
  if (u.length < 3 || u.length > 30) {
    return { valid: false, error: "Username must be 3-30 characters." };
  }
  if (!/^[a-z0-9._-]+$/.test(u)) {
    return { valid: false, error: "Only letters, numbers, dot, underscore, or dash allowed." };
  }
  if (!/^[a-z0-9]/.test(u) || !/[a-z0-9]$/.test(u)) {
    return { valid: false, error: "Must start and end with a letter or number." };
  }
  if (/[._-]{2,}/.test(u)) {
    return { valid: false, error: "Cannot have consecutive dots, underscores, or dashes." };
  }
  if (RESERVED_USERNAMES.has(u)) {
    return { valid: false, error: "This username is reserved. Please choose another." };
  }
  return { valid: true, error: "" };
}

function evaluatePassword(pw, { username = "", firstName = "", lastName = "" } = {}) {
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
  const personalTerms = [username, firstName, lastName]
    .filter(Boolean)
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t.length >= 3);

  for (const term of personalTerms) {
    if (lowerPw.includes(term)) {
      containsPersonalInfo = true;
      break;
    }
  }

  const isCommon = COMMON_WEAK_PASSWORDS.has(lowerPw);

  const checks = {
    length: len >= 8,
    cases: hasLower && hasUpper,
    number: hasNumber,
    symbol: hasSymbol,
    noUsername: !containsPersonalInfo,
  };

  if (len === 0) {
    return {
      level: "",
      label: "—",
      score: 0,
      checks: {
        length: false,
        cases: false,
        number: false,
        symbol: false,
        noUsername: true,
      },
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
      message = "Password should not contain your name or username.";
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
  const userEl = document.getElementById("username");
  const firstEl = document.getElementById("first");
  const lastEl = document.getElementById("last");
  const strengthBox = document.getElementById("pwStrengthBox");
  const strengthVal = document.getElementById("pwStrengthVal");

  if (!pwEl || !strengthBox || !strengthVal) return;

  const pw = pwEl.value;
  const username = userEl ? userEl.value : "";
  const firstName = firstEl ? firstEl.value : "";
  const lastName = lastEl ? lastEl.value : "";

  const evalResult = evaluatePassword(pw, { username, firstName, lastName });

  strengthBox.setAttribute("data-strength", evalResult.level);
  strengthVal.textContent = evalResult.label;

  // Update requirement checklist
  const ruleMap = [
    { id: "rule-length", ok: evalResult.checks.length },
    { id: "rule-cases", ok: evalResult.checks.cases },
    { id: "rule-number", ok: evalResult.checks.number },
    { id: "rule-symbol", ok: evalResult.checks.symbol },
    { id: "rule-nouser", ok: evalResult.checks.noUsername },
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

function updateUsernameUI() {
  const userEl = document.getElementById("username");
  const hint = document.getElementById("usernameHint");
  if (!userEl || !hint) return;

  const raw = userEl.value;
  if (!raw) {
    hint.textContent = "3-30 characters: letters, numbers, dot, underscore, dash. Must start and end with a letter or number.";
    hint.className = "field-hint";
    setFieldError(userEl, false);
    updatePasswordUI();
    return;
  }

  const result = validateUsername(raw);
  if (result.valid) {
    hint.textContent = "✓ Username is available and well-formed.";
    hint.className = "field-hint valid";
    setFieldError(userEl, false);
  } else {
    hint.textContent = `✗ ${result.error}`;
    hint.className = "field-hint invalid";
  }

  updatePasswordUI();
}

function initPasswordToggles() {
  document.querySelectorAll(".pw-eye").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
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
  if (!inviteToken) {
    dead("An invitation is required. Ask your administrator for an invitation link.");
    return;
  }
  try {
    const data = await checkInvite(inviteToken);
    inviteEmail = data.email;
    inviteRole = data.role || "cashier";
    const isAdm = inviteRole === "admin";
    const roleBadge = document.getElementById("roleBadge");
    if (roleBadge) {
      roleBadge.textContent = isAdm ? "Role: Administrator" : "Role: Cashier";
      roleBadge.className = `badge ${isAdm ? "admin" : "cashier"}`;
    }
    if (isAdm) {
      document.title = "Create administrator account — GameHub";
      const pageTitle = document.getElementById("pageTitle");
      if (pageTitle) pageTitle.innerHTML = "Create administrator <em>account.</em>";
      const lede = document.getElementById("lede");
      if (lede) lede.textContent = "Your administrator invitation is pre-approved — you will have full admin access.";
      const usernameInput = document.getElementById("username");
      if (usernameInput) usernameInput.placeholder = "juan.admin";
    } else {
      document.title = "Create cashier account — GameHub";
      const pageTitle = document.getElementById("pageTitle");
      if (pageTitle) pageTitle.innerHTML = "Create cashier <em>account.</em>";
      const lede = document.getElementById("lede");
      if (lede) lede.textContent = "Your invitation is pre-approved — your account is active right away.";
      const usernameInput = document.getElementById("username");
      if (usernameInput) usernameInput.placeholder = "juan.cashier";
    }
    document.getElementById("email").value = inviteEmail;
    document.getElementById("form").hidden = false;
    // Bot check is optional; the slot stays hidden unless the admin enabled it.
    GameHubRecaptcha.render(document.getElementById("recaptchaSlot"));
  } catch (e) {
    const m = (e.message || "").toLowerCase();
    if (m.includes("expired")) {
      dead("This invitation has expired. Ask your administrator for a new one.");
    } else if (m.includes("used")) {
      dead("This invitation is no longer valid. If you already registered, try logging in — otherwise ask your administrator.");
    } else {
      dead("An invitation is required. Ask your administrator for an invitation link.");
    }
  }

  initPasswordToggles();

  const userEl = document.getElementById("username");
  const pwEl = document.getElementById("password");
  const cfEl = document.getElementById("confirm");
  const firstEl = document.getElementById("first");
  const lastEl = document.getElementById("last");

  if (userEl) userEl.addEventListener("input", updateUsernameUI);
  if (pwEl) pwEl.addEventListener("input", updatePasswordUI);
  if (cfEl) cfEl.addEventListener("input", updateConfirmUI);
  if (firstEl) firstEl.addEventListener("input", updatePasswordUI);
  if (lastEl) lastEl.addEventListener("input", updatePasswordUI);
}

async function submitRegister() {
  const msg = document.getElementById("msg");
  const go = document.getElementById("go");
  const firstEl = document.getElementById("first");
  const lastEl = document.getElementById("last");
  const userEl = document.getElementById("username");
  const pwEl = document.getElementById("password");
  const cfEl = document.getElementById("confirm");
  const first = firstEl.value.trim();
  const last = lastEl.value.trim();
  const username = userEl.value.trim().toLowerCase();
  const pw = pwEl.value;
  const cf = cfEl.value;

  const bad = [];
  [firstEl, lastEl, userEl, pwEl, cfEl].forEach((el) => setFieldError(el, false));

  if (first.length < 2) {
    setFieldError(firstEl, true);
    bad.push({ el: firstEl, reason: "First name must be at least 2 characters." });
  }
  if (last.length < 2) {
    setFieldError(lastEl, true);
    bad.push({ el: lastEl, reason: "Last name must be at least 2 characters." });
  }

  const userValidation = validateUsername(username);
  if (!userValidation.valid) {
    setFieldError(userEl, true);
    bad.push({ el: userEl, reason: userValidation.error });
  }

  const pwEval = evaluatePassword(pw, { username, firstName: first, lastName: last });
  if (!pw || pw.length < 8) {
    setFieldError(pwEl, true);
    bad.push({ el: pwEl, reason: "Password must be at least 8 characters." });
  } else if (!pwEval.isValid || pwEval.level === "weak") {
    setFieldError(pwEl, true);
    bad.push({
      el: pwEl,
      reason: pwEval.message || "Password is too weak. Please choose a moderate or strong password.",
    });
  }

  if (pw !== cf) {
    setFieldError(cfEl, true);
    bad.push({ el: cfEl, reason: "Passwords do not match." });
  }

  if (bad.length) {
    msg.textContent = bad[0].reason;
    msg.className = "err";
    bad[0].el.focus();
    return;
  }

  // reCAPTCHA is injected only when the admin enabled it; when off this
  // resolves immediately and no token is sent.
  const human = await GameHubRecaptcha.config();
  const recaptchaToken = human.enabled ? await GameHubRecaptcha.token() : "";
  if (human.enabled && !recaptchaToken) {
    msg.textContent = "Please complete the reCAPTCHA check.";
    msg.className = "err";
    return;
  }

  msg.textContent = "Sending...";
  msg.className = "";
  go.disabled = true;
  try {
    await register({
      token: inviteToken,
      firstName: first,
      lastName: last,
      username,
      email: inviteEmail,
      password: pw,
      recaptchaToken,
    });
    msg.textContent = inviteRole === "admin"
      ? "Administrator account created! You can now log in to the admin dashboard."
      : "Cashier account created! You can now log in.";
    msg.className = "ok";
    setTimeout(() => {
      location.href = "./login.html";
    }, 1200);
  } catch (e) {
    GameHubRecaptcha.reset();
    msg.textContent = e.message;
    msg.className = "err";
    go.disabled = false;
  }
}

document.getElementById("registerForm").addEventListener("submit", (e) => {
  e.preventDefault();
  submitRegister();
});

boot();
