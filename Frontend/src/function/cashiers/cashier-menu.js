// src/function/cashiers/cashier-menu.js - read-only F&B menu (Sprint 5 CA-026).
// Pair: cashier-menu.html <-> GET /api/cashier/products (active only).
// Loads the whole active menu once, then groups/filters locally so typing
// never waits on the network. No mutation controls exist on this page.
const MENU_CATEGORY_ORDER = ["food", "beverage", "other"];
const MENU_CATEGORY_LABEL = { food: "Food", beverage: "Beverage", other: "Other" };

let menuItems = [];
let menuCategory = "";
let menuLoaded = false;

function menuMsg(text, kind = "") {
  const el = document.getElementById("msg");
  if (!el) return;
  el.textContent = text;
  el.className = `dash-msg${kind ? " " + kind : ""}`;
}

function menuMoney(n) {
  return `₱${Number(n || 0).toFixed(2)}`;
}

function setMenuEmpty(show, text) {
  const el = document.getElementById("empty");
  if (!el) return;
  if (text) el.textContent = text;
  el.hidden = !show;
}

function menuFiltered() {
  const q = (document.getElementById("menuSearch").value || "").trim().toLowerCase();
  return menuItems.filter((p) => {
    if (menuCategory && p.category !== menuCategory) return false;
    if (q && !String(p.name || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

function menuCard(p) {
  const card = document.createElement("article");
  card.className = "menu-card";
  const name = document.createElement("span");
  name.className = "menu-name";
  name.textContent = p.name || "Unnamed item";
  const price = document.createElement("span");
  price.className = "menu-price";
  price.textContent = menuMoney(p.price);
  card.append(name, price);
  return card;
}

function paintMenu() {
  const groups = document.getElementById("menuGroups");
  groups.innerHTML = "";
  const list = menuFiltered();
  const q = (document.getElementById("menuSearch").value || "").trim();
  const category = MENU_CATEGORY_ORDER.includes(menuCategory) ? menuCategory : "";

  if (list.length === 0) {
    setMenuEmpty(
      true,
      menuItems.length === 0
        ? "No menu items yet — ask an administrator."
        : q || category
          ? "No items match this search or category."
          : "No menu items are available right now."
    );
    return;
  }
  setMenuEmpty(false);

  for (const cat of MENU_CATEGORY_ORDER) {
    if (category && cat !== category) continue;
    const items = list.filter((p) => (p.category || "other") === cat);
    if (!items.length) continue;

    const section = document.createElement("section");
    section.className = "menu-group";
    const head = document.createElement("div");
    head.className = "menu-group-head";
    const h = document.createElement("h3");
    h.textContent = MENU_CATEGORY_LABEL[cat];
    const count = document.createElement("span");
    count.className = "menu-count";
    count.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
    head.append(h, count);
    const grid = document.createElement("div");
    grid.className = "menu-grid";
    for (const p of items) grid.appendChild(menuCard(p));
    section.append(head, grid);
    groups.appendChild(section);
  }
}

async function loadMenu() {
  const retry = document.getElementById("retry");
  menuMsg("Loading menu…", "loading");
  setMenuEmpty(false);
  retry.hidden = true;
  document.getElementById("menuGroups").innerHTML = "";
  try {
    const { products } = await listMenuProducts();
    menuItems = Array.isArray(products) ? products : [];
    menuLoaded = true;
    menuMsg(
      menuItems.length === 0
        ? "The menu is empty."
        : `Showing ${menuItems.length} active item${menuItems.length === 1 ? "" : "s"}.`,
      "ok"
    );
    paintMenu();
    dashStamp(document.getElementById("stamp"));
  } catch (e) {
    menuItems = [];
    menuLoaded = false;
    document.getElementById("menuGroups").innerHTML = "";
    menuMsg(e.message, "err");
    setMenuEmpty(true, "Couldn't load the menu — check the connection and retry.");
    retry.hidden = false;
  }
}

document.getElementById("menuSearch").addEventListener("input", () => {
  if (!menuLoaded) return;
  paintMenu();
});

document.querySelectorAll(".menu-chips .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    menuCategory = chip.dataset.cat || "";
    document.querySelectorAll(".menu-chips .chip").forEach((c) => {
      const on = c === chip;
      c.classList.toggle("on", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (menuLoaded) paintMenu();
  });
});

document.getElementById("retry").addEventListener("click", () => loadMenu());

(async () => {
  try {
    await cashierGuard();
    bindCashierLogout();
    await loadMenu();
    // Background convergence while the tab is visible.
    setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (document.querySelector(".dash-modal.open")) return;
      loadMenu();
    }, 60000);
  } catch {
    location.href = "../auth/login.html";
  }
})();
