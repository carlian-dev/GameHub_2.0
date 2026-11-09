// src/function/admin/menu.js - F&B product catalogue (Sprint 5).
// Pair: menu.html <-> products.routes.js + product.service.js.
// Admin-only. Status/category/search filters hit GET /api/admin/products
// (server caps the list at 500). Add/Edit share one in-page dialog; archive
// and unarchive confirm through dashConfirm. Product data is written with
// textContent only, never interpolated into innerHTML.
const PRODUCT_CATEGORIES = ["food", "beverage", "other"];
const CATEGORY_LABEL = { food: "Food", beverage: "Beverage", other: "Other" };
const MAX_PRICE = 100000;

let products = [];
let loading = false;
let searchTimer = null;

function setMsg(text, kind = "") {
  const el = document.getElementById("msg");
  if (!el) return;
  el.textContent = text;
  el.className = `dash-msg${kind ? " " + kind : ""}`;
}

function setEmpty(show, text) {
  const el = document.getElementById("empty");
  if (!el) return;
  if (text) el.textContent = text;
  el.hidden = !show;
}

function money(n) {
  return `₱${Number(n || 0).toFixed(2)}`;
}

function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(active) {
  return active ? "Active" : "Archived";
}

function emptyText() {
  const status = document.getElementById("fStatus").value;
  const q = document.getElementById("q").value.trim();
  const category = document.getElementById("fCategory").value;
  if (q || category) return "No products match these filters.";
  if (status === "archived") return "No archived products.";
  if (status === "all") return "No products yet — add the first one.";
  return "No active products yet — add one to build the cashier menu.";
}

async function guard() {
  try {
    const me = await getMe();
    if (me.role !== "admin") {
      location.href = me.role === "cashier"
        ? "../cashiers/cashier-dashboard.html"
        : "../auth/login.html";
      return null;
    }
    const name = me.email || "admin";
    document.getElementById("who").textContent = name;
    document.getElementById("avatar").textContent = name.charAt(0).toUpperCase();
    return me;
  } catch {
    location.href = "../auth/login.html";
    return null;
  }
}

function categoryBadge(category) {
  const badge = document.createElement("span");
  badge.className = `badge cat-${PRODUCT_CATEGORIES.includes(category) ? category : "other"}`;
  badge.textContent = CATEGORY_LABEL[category] || "Other";
  return badge;
}

function actionButton(label, className, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `rowbtn${className ? " " + className : ""}`;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function productRow(p) {
  const tr = document.createElement("tr");
  if (p.archived) tr.classList.add("dim");
  tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td><td></td>";
  tr.children[0].textContent = p.name || "—";
  tr.children[1].appendChild(categoryBadge(p.category));
  tr.children[2].textContent = money(p.price);
  tr.children[2].classList.add("num");

  const status = document.createElement("span");
  status.className = `badge ${p.archived ? "archived" : "available"}`;
  status.textContent = statusLabel(!p.archived);
  tr.children[3].appendChild(status);
  tr.children[4].textContent = when(p.updatedAt || p.createdAt);

  const act = tr.children[5];
  act.classList.add("actions-cell");
  const edit = actionButton("Edit", "", async () => {
    if (edit.disabled) return;
    edit.disabled = true;
    const saved = await productDialog(p);
    edit.disabled = false;
    if (!saved) return;
    await load();
    dashToast(`${saved.name} saved.`, "ok", { title: "Product saved" });
  });
  act.appendChild(edit);

  if (!p.archived) {
    const archive = actionButton("Archive", "danger", async () => {
      if (archive.disabled) return;
      const ok = await dashConfirm(
        `Archive “${p.name}”? It leaves the cashier menu and cannot be added to new bills. Existing order lines and receipts keep their snapshot.`,
        "Archive product"
      );
      if (!ok) return;
      archive.disabled = true;
      try {
        await archiveProduct(p.id);
        dashToast(`${p.name} archived.`, "ok", { title: "Archived" });
        await load();
      } catch (e) {
        archive.disabled = false;
        setMsg(e.message, "err");
        dashToast(e.message, "err", { title: "Archive failed" });
      }
    });
    act.appendChild(archive);
  } else {
    const restore = actionButton("Unarchive", "go", async () => {
      if (restore.disabled) return;
      const ok = await dashConfirm(
        `Unarchive “${p.name}”? It returns to the cashier menu at ${money(p.price)}.`,
        "Unarchive product"
      );
      if (!ok) return;
      restore.disabled = true;
      try {
        await unarchiveProduct(p.id);
        dashToast(`${p.name} is active again.`, "ok", { title: "Unarchived" });
        await load();
      } catch (e) {
        restore.disabled = false;
        setMsg(e.message, "err");
        dashToast(e.message, "err", { title: "Unarchive failed" });
      }
    });
    act.appendChild(restore);
  }
  return tr;
}

function paint(list) {
  const tb = document.querySelector("#tbl tbody");
  tb.innerHTML = "";
  for (const p of list) tb.appendChild(productRow(p));
  return list.length;
}

function countMessage(n) {
  const status = document.getElementById("fStatus").value;
  const label = status === "archived"
    ? "archived product"
    : status === "all" ? "product" : "active product";
  return `Showing ${n} ${label}${n === 1 ? "" : "s"}.`;
}

async function load(quiet = false) {
  if (loading) return;
  loading = true;
  const tbody = document.querySelector("#tbl tbody");
  if (!quiet) {
    setMsg("Loading…", "loading");
    setEmpty(false);
    dashSkeleton(tbody, 6, 5);
  }
  try {
    const status = document.getElementById("fStatus").value;
    const category = document.getElementById("fCategory").value;
    const q = document.getElementById("q").value.trim();
    const data = await listProducts({ status, category, q });
    products = Array.isArray(data.products) ? data.products : [];
    const n = paint(products);
    setMsg(countMessage(n), "ok");
    setEmpty(n === 0, emptyText());
    dashStamp(document.getElementById("stamp"));
  } catch (e) {
    products = [];
    tbody.innerHTML = "";
    setMsg(e.message, "err");
    setEmpty(true, "Couldn't load the catalogue — refresh or change the filters to retry.");
  } finally {
    loading = false;
  }
}

// ---------------------------------------------------------------------------
// Add/Edit product dialog. Resolves with the saved product object on success
// (or the existing product when nothing changed) and null on cancel.
// ---------------------------------------------------------------------------
function productDialog(product = null) {
  return new Promise((resolve) => {
    const editing = !!product;
    const overlay = document.createElement("div");
    overlay.className = "dash-modal open";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "productTitle");
    overlay.innerHTML =
      '<div class="dash-modal-box sheet product-box" tabindex="-1">' +
      '<form class="product-form" novalidate>' +
      '<p class="dash-modal-title" id="productTitle">Add product</p>' +
      '<p class="bill-sub product-sub"></p>' +
      '<p class="dash-msg err" id="productErr" role="alert" hidden></p>' +
      '<label class="field" for="productName"><span class="field-label">Name</span>' +
      '<input id="productName" name="name" type="text" maxlength="80" autocomplete="off" /></label>' +
      '<div class="product-grid">' +
      '<label class="field" for="productCategory"><span class="field-label">Category</span>' +
      '<span class="select-wrap"><select id="productCategory" name="category">' +
      '<option value="food">Food</option><option value="beverage">Beverage</option><option value="other">Other</option>' +
      "</select></span></label>" +
      '<label class="field" for="productPrice"><span class="field-label">Price (₱)</span>' +
      '<input id="productPrice" name="price" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" /></label>' +
      "</div>" +
      '<p class="field-hint">Name is unique (case-insensitive). Price must be greater than 0 and at most ₱100,000.00 with two decimals. Existing bills keep their snapshot price.</p>' +
      '<div class="modal-actions">' +
      '<button type="submit" class="btn btn-solid" id="productSave">Save product</button>' +
      '<button type="button" class="btn btn-ghost" id="productCancel">Cancel</button>' +
      "</div></form></div>";
    document.body.appendChild(overlay);

    const box = overlay.querySelector(".dash-modal-box");
    const form = overlay.querySelector(".product-form");
    const title = overlay.querySelector("#productTitle");
    const sub = overlay.querySelector(".product-sub");
    const nameInput = overlay.querySelector("#productName");
    const categoryInput = overlay.querySelector("#productCategory");
    const priceInput = overlay.querySelector("#productPrice");
    const err = overlay.querySelector("#productErr");
    const save = overlay.querySelector("#productSave");
    const cancel = overlay.querySelector("#productCancel");

    title.textContent = editing ? "Edit product" : "Add product";
    sub.textContent = editing
      ? `${product.name} · ${CATEGORY_LABEL[product.category] || "Other"} · ${money(product.price)}`
      : "Create a menu item for cashiers to add to a customer's bill.";
    nameInput.value = editing ? product.name || "" : "";
    categoryInput.value = editing && PRODUCT_CATEGORIES.includes(product.category)
      ? product.category
      : "food";
    priceInput.value = editing ? Number(product.price || 0).toFixed(2) : "";

    const lastFocus = document.activeElement;
    const close = (value) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) {
        try { lastFocus.focus(); } catch { /* trigger removed */ }
      }
      resolve(value);
    };

    function showError(text, field) {
      err.textContent = text;
      err.hidden = false;
      if (field) {
        dashFieldError(field, true);
        field.focus();
      }
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(null);
        return;
      }
      if (e.key !== "Tab") return;
      const list = Array.from(
        box.querySelectorAll("button:not(:disabled), input, select")
      ).filter((el) => el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!box.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }

    [nameInput, categoryInput, priceInput].forEach((input) =>
      input.addEventListener("input", () => {
        dashFieldError(input, false);
        err.hidden = true;
      })
    );
    cancel.addEventListener("click", () => close(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.hidden = true;
      const name = nameInput.value.trim();
      const category = categoryInput.value;
      const priceText = priceInput.value.trim();
      const price = Number(priceText);

      if (!name || name.length > 80) {
        showError("Enter a product name (1–80 characters).", nameInput);
        return;
      }
      if (!PRODUCT_CATEGORIES.includes(category)) {
        showError("Choose Food, Beverage, or Other.", categoryInput);
        return;
      }
      if (!/^\d+(\.\d{1,2})?$/.test(priceText) || !(price > 0) || price > MAX_PRICE) {
        showError("Enter a price greater than 0 and at most ₱100,000.00, with at most two decimals.", priceInput);
        return;
      }

      const fields = {};
      if (!editing) {
        fields.name = name;
        fields.category = category;
        fields.price = price;
      } else {
        if (name !== product.name) fields.name = name;
        if (category !== product.category) fields.category = category;
        if (price !== Number(product.price)) fields.price = price;
        if (Object.keys(fields).length === 0) {
          close(product);
          return;
        }
      }

      save.disabled = true;
      cancel.disabled = true;
      save.classList.add("busy");
      try {
        const data = editing
          ? await updateProduct(product.id, fields)
          : await createProduct(fields);
        close(data.product || product);
      } catch (e2) {
        save.disabled = false;
        cancel.disabled = false;
        save.classList.remove("busy");
        showError(e2.message, e2.message.toLowerCase().includes("name") ? nameInput : null);
      }
    });

    document.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    nameInput.focus();
    nameInput.select();
  });
}

document.getElementById("addProduct").addEventListener("click", async () => {
  const saved = await productDialog(null);
  if (!saved) return;
  await load();
  dashToast(`${saved.name} is on the menu at ${money(saved.price)}.`, "ok", { title: "Product added" });
});

document.getElementById("filterForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (searchTimer) clearTimeout(searchTimer);
  load();
});
document.getElementById("fStatus").addEventListener("change", () => load());
document.getElementById("fCategory").addEventListener("change", () => load());
document.getElementById("q").addEventListener("input", () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => load(), 250);
});

guard().then((me) => { if (me) load(); });

// Quiet convergence: refresh when the tab is visible and no dialog is open.
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  if (document.querySelector(".dash-modal.open")) return;
  load(true);
}, 60000);
