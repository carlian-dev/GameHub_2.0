// src/function/auth/register.js - invitation-gated signup logic.
// Pair: register.html <-> server/src/routes/auth.routes.js (token,
// expiry, single-use, and email match are ALL re-enforced server-side;
// page checks below are convenience only).
// Flow: ?token=... -> checkInvite -> valid: lock invited email into the form;
// invalid/expired/used/missing -> dead-end state (contact administrator).
// Enter submits via the real <form>; per-field validation marks aria-invalid
// + red border until fixed.
const inviteToken = new URLSearchParams(location.search).get("token") || "";
let inviteEmail = "";

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

async function boot() {
  if (!inviteToken) {
    dead("An invitation is required. Ask your administrator for an invitation link.");
    return;
  }
  try {
    const data = await checkInvite(inviteToken);
    inviteEmail = data.email;
    document.getElementById("email").value = inviteEmail;
    document.getElementById("form").hidden = false;
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
  if (first.length < 2) { setFieldError(firstEl, true); bad.push(firstEl); }
  if (last.length < 2) { setFieldError(lastEl, true); bad.push(lastEl); }
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) { setFieldError(userEl, true); bad.push(userEl); }
  if (pw.length < 8) { setFieldError(pwEl, true); bad.push(pwEl); }
  if (pw !== cf) { setFieldError(cfEl, true); bad.push(cfEl); }
  if (bad.length) {
    const reason =
      first.length < 2 || last.length < 2 ? "First name and last name are required (min 2 letters)."
        : !/^[a-z0-9._-]{3,30}$/.test(username) ? "Username must be 3-30 characters: letters, numbers, dot, underscore or dash."
        : pw.length < 8 ? "Password must be at least 8 characters."
        : "Passwords do not match.";
    msg.textContent = reason;
    msg.className = "err";
    bad[0].focus();
    return;
  }
  msg.textContent = "Sending...";
  msg.className = "";
  go.disabled = true;
  try {
    await register({ token: inviteToken, firstName: first, lastName: last, username, email: inviteEmail, password: pw });
    msg.textContent = "Created! You can now log in.";
    msg.className = "ok";
    setTimeout(() => { location.href = "./login.html"; }, 1200);
  } catch (e) {
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
