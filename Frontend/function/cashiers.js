// function/cashiers.js - staff table logic. Pair: function/cashiers.html <-> Backend/function/cashiers.php.
// guard() bounces non-admins to ./login.html via getMe(). load() renders the
// table for the current filter; Approve/Edit/Archive call the matching api.js
// function then reload. Non-admins never reach here, and password hashes are
// never shown because the Backend never sends them.
let filter = "pending";
async function guard() {
  try {
    const me = await getMe();
    if (me.role !== "admin") location.href = "./login.html";
  } catch { location.href = "./login.html"; }
}
async function load() {
  const msg = document.getElementById("msg");
  const tb = document.querySelector("#tbl tbody");
  msg.textContent = "Loading...";
  tb.innerHTML = "";
  try {
    const { cashiers } = await listCashiers(filter);
    msg.textContent = `${cashiers.length} shown (filter: ${filter}).`;
    for (const c of cashiers) {
      const tr = document.createElement("tr");
      if (c.status === "archived") tr.style.opacity = "0.55";
      tr.innerHTML =
        `<td>${c.email}</td><td>${c.status}</td>` +
        `<td>${c.displayName || ""}</td><td>${c.schedule || ""}</td><td></td>`;
      const act = tr.lastChild;
      if (c.status === "pending") {
        const b = document.createElement("button");
        b.textContent = "Approve";
        b.onclick = async () => { await approveCashier(c.id); load(); };
        act.appendChild(b);
      }
      const e = document.createElement("button");
      e.textContent = "Edit";
      e.onclick = async () => {
        const n = prompt("Display name:", c.displayName || "");
        if (n === null) return;
        const s = prompt("Schedule:", c.schedule || "");
        if (s === null) return;
        await updateCashier(c.id, { displayName: n, schedule: s });
        load();
      };
      act.appendChild(e);
      if (c.status !== "archived") {
        const a = document.createElement("button");
        a.textContent = "Archive";
        a.onclick = async () => {
          if (confirm(`Archive ${c.email}? They will no longer be able to log in.`)) {
            await archiveCashier(c.id); load();
          }
        };
        act.appendChild(a);
      }
      tb.appendChild(tr);
    }
  } catch (e) { msg.textContent = e.message; }
}
document.querySelectorAll("[data-f]").forEach(b =>
  b.addEventListener("click", () => { filter = b.dataset.f; load(); }));
document.getElementById("out").addEventListener("click", async () => {
  await logout(); location.href = "./login.html";
});
guard().then(load);
