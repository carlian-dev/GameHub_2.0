// function/register.js - registration page logic. Pair: function/register.html <-> Backend/function/register.php.
// Checks the two passwords match locally, then calls register() from ../js/api.js.
// Success -> "awaiting admin approval". Duplicate -> "email already used" (409).
document.getElementById("go").addEventListener("click", async () => {
  const msg = document.getElementById("msg");
  const email = document.getElementById("email").value.trim();
  const pw = document.getElementById("password").value;
  const cf = document.getElementById("confirm").value;
  if (pw !== cf) { msg.textContent = "Passwords do not match."; msg.className = "err"; return; }
  msg.textContent = "Sending..."; msg.className = "";
  try {
    await register(email, pw);
    msg.textContent = "Created! Status: pending — awaiting admin approval.";
    msg.className = "ok";
  } catch (e) {
    msg.textContent = e.message; msg.className = "err";
  }
});
