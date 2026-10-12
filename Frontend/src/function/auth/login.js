// src/function/auth/login.js - single-step login logic. Pair: src/function/auth/login.html <-> Backend/src/function/auth/login.php + google.php.
// Valid ACTIVE accounts log straight in (email/username + password, or Google)
// and redirect by role: admin -> ./admin-dashboard.html,
// cashier -> ./cashier-dashboard.html. Pending/archived/declined show the
// Backend message verbatim.
function welcomeAndGo(data) {
  const who = data.email || data.username || "staff";
  const msg = document.getElementById("msg");
  msg.textContent = `Welcome ${who} (${data.role}).`;
  msg.className = "ok";
  location.href = data.role === "admin" ? "../admin/admin-dashboard.html" : "../cashiers/cashier-dashboard.html";
}

document.getElementById("go").addEventListener("click", async () => {
  const msg = document.getElementById("msg");
  msg.textContent = "Checking..."; msg.className = "";
  try {
    welcomeAndGo(await login(
      document.getElementById("email").value.trim(),
      document.getElementById("password").value
    ));
  } catch (e) {
    msg.textContent = e.message; msg.className = "err";
  }
});

// "Continue with Google": verified email either finds your ACTIVE account
// (direct session) or creates a pending one needing admin approval.
async function initGoogleLogin() {
  try {
    const { googleClientId } = await getAppConfig();
    if (!googleClientId || !window.google) return;
    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async ({ credential }) => {
        const msg = document.getElementById("msg");
        try {
          const data = await loginWithGoogle(credential);
          if (data.step === "approval") {
            msg.textContent = "Google account created! Status: pending — awaiting admin approval.";
            msg.className = "ok";
          } else welcomeAndGo(data);
        } catch (e) { msg.textContent = e.message; msg.className = "err"; }
      },
    });
    google.accounts.id.renderButton(document.getElementById("gbtn"), {
      theme: "outline", size: "large", text: "signin_with", width: 280,
    });
  } catch { /* Google unavailable offline — password form still works */ }
}
initGoogleLogin();