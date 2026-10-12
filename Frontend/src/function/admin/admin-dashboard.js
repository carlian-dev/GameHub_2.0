// src/function/admin/admin-dashboard.js - admin home logic. Pair: admin-dashboard.html.
// Guard: only role=admin stays (cashiers go to their dashboard, guests to
// login). Stat cards read REAL endpoints: active cashiers, pending
// invitations, tables, admins. Shell behavior (menu/theme/date) lives in js/dash.js.
(async () => {
  try {
    const me = await getMe();
    if (me.role !== "admin") {
      location.href = me.role === "cashier" ? "../cashiers/cashier-dashboard.html" : "../auth/login.html";
      return;
    }
    const name = me.email || "admin";
    document.getElementById("who").textContent = name;
    document.getElementById("avatar").textContent = name.charAt(0).toUpperCase();
    const [inv, ac, ad, tb] = await Promise.all([
      listInvites(),
      listCashiers("active", "cashier"),
      listCashiers("all", "admin"),
      listTables("all"),
    ]);
    document.getElementById("stPending").textContent =
      inv.invitations.filter((v) => v.status === "pending").length;
    document.getElementById("stActive").textContent = ac.cashiers.length;
    document.getElementById("stTables").textContent = tb.tables.length;
    document.getElementById("stAdmins").textContent =
      ad.cashiers.filter((u) => u.status === "active").length;
  } catch {
    location.href = "../auth/login.html";
  }
})();
document.getElementById("out").addEventListener("click", async () => {
  await logout(); location.href = "../auth/login.html";
});