// function/login.js - login page logic. Pair: function/login.html <-> Backend/function/login.php.
// On click it calls login() from ../js/api.js, then redirects by role:
// admin -> ./cashiers.html, cashier -> ../index.html. Errors show verbatim.
document.getElementById("go").addEventListener("click", async () => {
  const msg = document.getElementById("msg");
  msg.textContent = "Checking..."; msg.className = "";
  try {
    const data = await login(
      document.getElementById("email").value.trim(),
      document.getElementById("password").value
    );
    msg.textContent = `Welcome ${data.email} (${data.role}).`;
    msg.className = "ok";
    location.href = data.role === "admin" ? "./cashiers.html" : "../index.html";
  } catch (e) {
    msg.textContent = e.message; msg.className = "err";
  }
});
