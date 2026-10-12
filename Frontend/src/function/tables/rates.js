// src/function/tables/rates.js - hourly rates page logic. Pair: rates.html <->
// Backend/src/function/tables/rates.php (AD-016 regular, AD-017 special).
// Split from tables.js so Rates is its own sidebar page. Guard: admin-only.
async function guard() {
  try {
    const me = await getMe();
    if (me.role !== "admin") { location.href = "../auth/login.html"; return null; }
    const name = me.email || "admin";
    document.getElementById("who").textContent = name;
    document.getElementById("avatar").textContent = name.charAt(0).toUpperCase();
    return me;
  } catch { location.href = "../auth/login.html"; return null; }
}

async function loadRates() {
  const msg = document.getElementById("rateMsg");
  msg.textContent = "Loading...";
  try {
    const { rates } = await getRates();
    for (const r of rates) {
      if (r.type === "regular") document.getElementById("rateRegular").value = r.pricePerHour;
      if (r.type === "special") document.getElementById("rateSpecial").value = r.pricePerHour;
    }
    msg.textContent = "";
  } catch (e) { msg.textContent = e.message; }
}

document.getElementById("saveRates").addEventListener("click", async () => {
  const msg = document.getElementById("rateMsg");
  try {
    await setRate("regular", Number(document.getElementById("rateRegular").value));
    await setRate("special", Number(document.getElementById("rateSpecial").value));
    msg.textContent = "Rates saved.";
    loadRates();
  } catch (e) { msg.textContent = e.message; }
});
document.getElementById("out").addEventListener("click", async () => {
  await logout(); location.href = "../auth/login.html";
});
guard().then((me) => { if (me) loadRates(); });
