// src/function/auth/register.js - invitation-gated signup logic.
// Pair: register.html <-> Backend/src/function/auth/register.php (token,
// expiry, single-use, and email match are ALL re-enforced server-side;
// page checks below are convenience only).
// Flow: ?token=... -> checkInvite -> valid: lock invited email into the form;
// invalid/expired/used/missing -> dead-end state (contact administrator).
const inviteToken = new URLSearchParams(location.search).get("token") || "";
let inviteEmail = "";

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

document.getElementById("go").addEventListener("click", async () => {
  const msg = document.getElementById("msg");
  const first = document.getElementById("first").value.trim();
  const last = document.getElementById("last").value.trim();
  const username = document.getElementById("username").value.trim().toLowerCase();
  const pw = document.getElementById("password").value;
  const cf = document.getElementById("confirm").value;
  if (first.length < 2 || last.length < 2) { msg.textContent = "First name and last name are required."; msg.className = "err"; return; }
  if (pw !== cf) { msg.textContent = "Passwords do not match."; msg.className = "err"; return; }
  msg.textContent = "Sending..."; msg.className = "";
  try {
    await register({ token: inviteToken, firstName: first, lastName: last, username, email: inviteEmail, password: pw });
    msg.textContent = "Created! You can now log in.";
    msg.className = "ok";
    setTimeout(() => { location.href = "./login.html"; }, 1200);
  } catch (e) { msg.textContent = e.message; msg.className = "err"; }
});

boot();
