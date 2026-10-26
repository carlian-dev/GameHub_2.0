// src/function/tables/rates.js - hourly rates page logic. Pair: rates.html <->
// server/src/routes/tables.routes.js (AD-016 regular, AD-017 special).
// Split from tables.js so Rates is its own sidebar page. Guard: admin-only.
// Real <form>: Enter saves. Both fields validate (> 0), summary updates live,
// and outcomes raise toasts (backend stays the source of truth).

function peso(n) {
  return `₱${Number(n || 0).toFixed(2)}`;
}

function rateValues() {
  return {
    regular: Number(document.getElementById("rateRegular").value),
    special: Number(document.getElementById("rateSpecial").value),
  };
}

function updateSummary() {
  const el = document.getElementById("rateSummary");
  const { regular, special } = rateValues();
  if (!regular || !special) {
    el.textContent = "Load the current rates to review them before saving.";
    return;
  }
  const diff = special - regular;
  el.innerHTML = "";
  const line = document.createElement("span");
  line.append(
    document.createTextNode(`Regular ${peso(regular)}/h · Special ${peso(special)}/h · difference `),
  );
  const strong = document.createElement("strong");
  strong.textContent = diff === 0 ? "none" : `${diff > 0 ? "+" : "−"}${peso(Math.abs(diff))}`;
  line.appendChild(strong);
  el.appendChild(line);
}

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
  msg.textContent = "Loading current rates…";
  msg.className = "dash-msg loading";
  try {
    const { rates } = await getRates();
    for (const r of rates) {
      if (r.type === "regular") document.getElementById("rateRegular").value = r.pricePerHour;
      if (r.type === "special") document.getElementById("rateSpecial").value = r.pricePerHour;
    }
    msg.textContent = "Current rates loaded.";
    msg.className = "dash-msg ok";
    updateSummary();
  } catch (e) {
    msg.textContent = e.message;
    msg.className = "dash-msg err";
  }
}

document.getElementById("ratesForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("rateMsg");
  const regEl = document.getElementById("rateRegular");
  const spEl = document.getElementById("rateSpecial");
  const { regular, special } = rateValues();
  const bad = [];
  dashFieldError(regEl, false);
  dashFieldError(spEl, false);
  if (!(regular > 0)) { dashFieldError(regEl, true); bad.push(regEl); }
  if (!(special > 0)) { dashFieldError(spEl, true); bad.push(spEl); }
  if (bad.length) {
    msg.textContent = "Both rates must be a number greater than 0.";
    msg.className = "dash-msg err";
    bad[0].focus();
    return;
  }
  const btn = document.getElementById("saveRates");
  btn.disabled = true;
  btn.classList.add("busy");
  msg.textContent = "Saving…";
  msg.className = "dash-msg loading";
  try {
    await setRate("regular", regular);
    await setRate("special", special);
    msg.textContent = "Rates saved.";
    msg.className = "dash-msg ok";
    dashToast(`Regular ${peso(regular)}/h · Special ${peso(special)}/h saved.`, "ok", { title: "Rates saved" });
    loadRates();
  } catch (e2) {
    msg.textContent = e2.message;
    msg.className = "dash-msg err";
    dashToast(e2.message, "err", { title: "Save failed" });
  } finally {
    btn.disabled = false;
    btn.classList.remove("busy");
  }
});

["rateRegular", "rateSpecial"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateSummary));
guard().then((me) => { if (me) loadRates(); });
