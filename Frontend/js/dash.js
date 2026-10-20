// js/dash.js - shared dashboard shell behavior (all staff pages).
// Sidebar toggle (mobile) + scrim, theme toggle persisted in localStorage,
// [data-today] dates, sliding nav pill, and the shared dialog system
// (confirm / prompt / select / edit / alert) with toasts and a11y helpers.
// Pure local UI: no API calls here; page scripts own guards + data.
(function () {
  const root = document.querySelector(".dash") || document.body;
  const side = document.querySelector(".dash-side");
  const menu = document.querySelector(".dash-menu");
  if (menu && side) {
    // Mobile drawer: hamburger + real backdrop scrim + aria-expanded.
    const scrim = document.createElement("div");
    scrim.className = "dash-scrim";
    scrim.setAttribute("aria-hidden", "true");
    document.body.appendChild(scrim);
    const setOpen = (open) => {
      side.classList.toggle("open", open);
      scrim.classList.toggle("show", open);
      menu.setAttribute("aria-expanded", open ? "true" : "false");
    };
    menu.setAttribute("aria-expanded", "false");
    menu.addEventListener("click", () => setOpen(!side.classList.contains("open")));
    scrim.addEventListener("click", () => setOpen(false));
    document.addEventListener("click", (e) => {
      if (window.innerWidth <= 860 && side.classList.contains("open") &&
        !side.contains(e.target) && !menu.contains(e.target) && !scrim.contains(e.target)) {
        setOpen(false);
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && side.classList.contains("open")) setOpen(false);
    });
  }
  const themeBtn = document.querySelector(".dash-theme");
  const applyTheme = (t) => {
    root.setAttribute("data-theme", t);
    const dark = t === "dark";
    if (themeBtn && themeBtn.classList) themeBtn.classList.toggle("is-light", !dark);
    document.querySelectorAll("[data-theme-switch]").forEach((el) => {
      el.setAttribute("aria-checked", dark ? "true" : "false");
      const sw = el.querySelector(".dash-switch");
      if (sw) sw.setAttribute("aria-checked", dark ? "true" : "false");
    });
  };
  let theme = "light";
  try { theme = localStorage.getItem("gh-theme") || "light"; } catch { /* private mode */ }
  applyTheme(theme);
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      theme = (root.getAttribute("data-theme") === "dark") ? "light" : "dark";
      try { localStorage.setItem("gh-theme", theme); } catch { /* private mode */ }
      applyTheme(theme);
    });
  }

  // ---- Admin settings gear menu (admin pages only) ----
  // The panel is appended to body (fixed positioning) so the sticky header's
  // overflow/backdrop-filter cannot clip it. Cashier pages have no
  // [data-admin-settings] host and keep the inline theme/logout buttons.
  const settingsHost = document.querySelector("[data-admin-settings]");
  if (settingsHost) {
    const gear = document.createElement("button");
    gear.type = "button";
    gear.className = "dash-settings-btn";
    gear.setAttribute("aria-haspopup", "menu");
    gear.setAttribute("aria-expanded", "false");
    gear.setAttribute("aria-label", "Open settings");
    gear.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="3" />' +
      '<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />' +
      "</svg>";
    settingsHost.appendChild(gear);

    const panel = document.createElement("div");
    panel.className = "dash-settings-panel";
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", "Settings menu");
    panel.hidden = true;

    const settingsUrl = settingsHost.getAttribute("data-settings-url") || "./settings.html";
    const menuLink = (label, hash) => {
      const a = document.createElement("a");
      a.className = "dash-settings-item";
      a.setAttribute("role", "menuitem");
      a.tabIndex = -1;
      a.href = `${settingsUrl}#${hash}`;
      a.textContent = label;
      return a;
    };
    const profileItem = menuLink("Profile", "profile");
    const apiItem = menuLink("API Integrations", "api");

    const sep = () => {
      const el = document.createElement("div");
      el.className = "dash-settings-sep";
      el.setAttribute("role", "separator");
      return el;
    };

    const themeItem = document.createElement("button");
    themeItem.type = "button";
    themeItem.className = "dash-settings-item dash-settings-theme";
    themeItem.setAttribute("role", "menuitemcheckbox");
    themeItem.setAttribute("data-theme-switch", "");
    themeItem.setAttribute("aria-checked", "false");
    themeItem.tabIndex = -1;
    const themeLabel = document.createElement("span");
    themeLabel.textContent = "Dark mode";
    const themeKnob = document.createElement("span");
    themeKnob.className = "dash-switch";
    themeKnob.setAttribute("aria-hidden", "true");
    themeItem.append(themeLabel, themeKnob);

    const logoutItem = document.createElement("button");
    logoutItem.type = "button";
    logoutItem.className = "dash-settings-item danger";
    logoutItem.setAttribute("role", "menuitem");
    logoutItem.setAttribute("data-logout", "");
    logoutItem.tabIndex = -1;
    logoutItem.textContent = "Log out";

    panel.append(profileItem, apiItem, sep(), themeItem, sep(), logoutItem);
    document.body.appendChild(panel);

    const menuItems = () => Array.from(panel.querySelectorAll(".dash-settings-item"));
    const placePanel = () => {
      const r = gear.getBoundingClientRect();
      panel.style.top = `${Math.round(r.bottom + 8)}px`;
      panel.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
      panel.style.left = "auto";
    };
    const closeMenu = (restoreFocus = panel.contains(document.activeElement)) => {
      if (panel.hidden) return;
      panel.hidden = true;
      gear.setAttribute("aria-expanded", "false");
      if (restoreFocus) gear.focus();
    };
    const openMenu = (focusFirst = false) => {
      if (!panel.hidden) return;
      placePanel();
      panel.hidden = false;
      gear.setAttribute("aria-expanded", "true");
      if (focusFirst) {
        const first = menuItems()[0];
        if (first) first.focus();
      }
    };

    gear.addEventListener("click", () => {
      if (panel.hidden) openMenu(true);
      else closeMenu();
    });

    themeItem.addEventListener("click", () => {
      theme = (root.getAttribute("data-theme") === "dark") ? "light" : "dark";
      try { localStorage.setItem("gh-theme", theme); } catch { /* private mode */ }
      applyTheme(theme);
    });

    logoutItem.addEventListener("click", async () => {
      closeMenu(false);
      try { await logout(); } catch { /* redirect anyway */ }
      location.href = "../auth/login.html";
    });

    document.addEventListener("click", (e) => {
      if (!panel.hidden && !settingsHost.contains(e.target) && !panel.contains(e.target)) {
        closeMenu(false);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (panel.hidden) {
        if (document.activeElement === gear && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          openMenu();
          const list = menuItems();
          const target = e.key === "ArrowDown" ? list[0] : list[list.length - 1];
          if (target) target.focus();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        return;
      }
      const list = menuItems();
      if (!list.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const idx = list.indexOf(document.activeElement);
        let next = 0;
        if (e.key === "ArrowDown") next = idx < 0 ? 0 : (idx + 1) % list.length;
        else if (e.key === "ArrowUp") next = idx < 0 ? list.length - 1 : (idx - 1 + list.length) % list.length;
        else if (e.key === "End") next = list.length - 1;
        list[next].focus();
      } else if (e.key === " " && document.activeElement && document.activeElement.tagName === "A" && panel.contains(document.activeElement)) {
        e.preventDefault();
        document.activeElement.click();
      }
    });

    window.addEventListener("scroll", () => { if (!panel.hidden) closeMenu(); }, { passive: true, capture: true });
    window.addEventListener("resize", () => { if (!panel.hidden) closeMenu(); });
    applyTheme(theme);
  }
  document.querySelectorAll("[data-today]").forEach((el) => {
    el.textContent = new Date().toLocaleDateString("en-US", {
      weekday: "long", month: "short", day: "numeric",
    });
  });

  // ---- Sidebar active indicator (slides the green highlight) ----
  // Cashier sidebar mixes a page link (Dashboard) with in-page anchors
  // (#sessions-panel, #tables-panel). Without this, .active stays stuck on
  // Dashboard. This moves .active + a sliding pill on click, hash change,
  // and scroll (IntersectionObserver scrollspy), and repositions on resize.
  const nav = document.querySelector(".dash-nav");
  if (nav) {
    const links = Array.from(nav.querySelectorAll("a[href]"));
    const noActive = nav.hasAttribute("data-no-active");
    let pill = nav.querySelector(".dash-nav-pill");
    if (!pill) {
      pill = document.createElement("span");
      pill.className = "dash-nav-pill";
      pill.setAttribute("aria-hidden", "true");
      nav.prepend(pill);
    }

    const movePill = (link) => {
      if (!link) { pill.style.opacity = "0"; return; }
      pill.style.opacity = "1";
      pill.style.height = `${link.offsetHeight}px`;
      pill.style.transform = `translateY(${link.offsetTop}px)`;
    };

    const setActive = (link, { hash = null } = {}) => {
      if (!link) return;
      links.forEach((a) => {
        const on = a === link;
        a.classList.toggle("active", on);
        if (on) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      });
      movePill(link);
      // Keep the URL hash in sync for deep-linking without jumping twice.
      if (hash !== null) {
        const target = link.getAttribute("href") || "";
        if (target.startsWith("#") && location.hash !== target) {
          history.replaceState(null, "", target);
        } else if (!target.startsWith("#") && location.hash) {
          const url = location.pathname + location.search;
          history.replaceState(null, "", url);
        }
      }
    };

    const linkForHash = (h) =>
      links.find((a) => (a.getAttribute("href") || "") === h) || null;

    // Click: activate immediately so the pill slides even before scroll ends.
    links.forEach((a) => {
      a.addEventListener("click", (e) => {
        const href = a.getAttribute("href") || "";
        if (href.startsWith("#")) {
          setActive(a, { hash: true });
          if (window.innerWidth <= 860 && side) {
            side.classList.remove("open");
            const sc = document.querySelector(".dash-scrim");
            if (sc) sc.classList.remove("show");
            const mm = document.querySelector(".dash-menu");
            if (mm) mm.setAttribute("aria-expanded", "false");
          }
          return;
        }
        // Same-page Dashboard link (./cashier-dashboard.html with no hash):
        // scroll to top instead of reloading so the pill visibly slides back.
        try {
          const url = new URL(a.href, location.href);
          const samePage =
            url.pathname.replace(/\/$/, "") ===
              location.pathname.replace(/\/$/, "") && !url.hash;
          if (samePage) {
            e.preventDefault();
            setActive(a, { hash: true });
            window.scrollTo({ top: 0, behavior: "smooth" });
            if (window.innerWidth <= 860 && side) {
              side.classList.remove("open");
              const sc = document.querySelector(".dash-scrim");
              if (sc) sc.classList.remove("show");
            }
          }
        } catch { /* external URL: let it navigate */ }
      });
    });

    // Back/forward + manual hash edits.
    window.addEventListener("hashchange", () => {
      const match = linkForHash(location.hash);
      if (match) setActive(match);
      else if (!location.hash && links.length && !noActive) setActive(links[0]);
      else if (noActive) {
        links.forEach((a) => {
          a.classList.remove("active");
          a.removeAttribute("aria-current");
        });
        movePill(null);
      }
    });

    // Scrollspy: while scrolling, the section in view owns the highlight.
    const hashLinks = links.filter((a) =>
      (a.getAttribute("href") || "").startsWith("#"));
    const sections = hashLinks
      .map((a) => document.querySelector(a.getAttribute("href")))
      .filter(Boolean);
    if (sections.length && "IntersectionObserver" in window) {
      let current = null;
      const spy = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const link = linkForHash(`#${e.target.id}`);
          if (link && link !== current) {
            current = link;
            setActive(link, { hash: true });
          }
        }
      }, { rootMargin: "-30% 0px -55% 0px", threshold: 0 });
      sections.forEach((s) => spy.observe(s));
      // Near the very top, Dashboard owns the highlight again.
      window.addEventListener("scroll", () => {
        if (window.scrollY < 120 && links.length && current !== links[0]) {
          current = links[0];
          setActive(links[0], { hash: true });
        }
      }, { passive: true });
    }

    // Initial state: honor a deep link (#sessions-panel), else current .active.
    // A nav marked data-no-active (settings) stays inactive instead of
    // falling back to its first link.
    const initial = nav.querySelector("a.active") ||
      (noActive ? null : (location.hash && linkForHash(location.hash)) || links[0]);
    // Apply the class too (deep link may differ from the hardcoded .active).
    links.forEach((a) => {
      const on = a === initial;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    // Layout must settle (fonts/sidebar width) before measuring offsets.
    requestAnimationFrame(() => movePill(initial));
    // Fonts shift link heights after load; re-pin the pill once settled.
    window.addEventListener("load", () => {
      const cur = nav.querySelector("a.active") || initial;
      movePill(cur);
    });
    window.addEventListener("resize", () => {
      const cur = nav.querySelector("a.active") || initial;
      movePill(cur);
    });
  }
})();

// ---- Toasts (success / error / info, corner stack, auto-dismiss) ----
// dashToast("Saved.", "ok") — max 3 stacked; errors use role="alert".
function dashToast(message, kind = "info", { title = "", timeout = 4200 } = {}) {
  let wrap = document.querySelector(".dash-toasts");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "dash-toasts";
    document.body.appendChild(wrap);
  }
  while (wrap.children.length >= 3) wrap.firstElementChild.remove();
  const t = document.createElement("div");
  t.className = `dash-toast ${kind}`;
  t.setAttribute("role", kind === "err" ? "alert" : "status");
  const body = document.createElement("div");
  if (title) {
    const strong = document.createElement("strong");
    strong.textContent = title;
    body.appendChild(strong);
  }
  body.appendChild(document.createTextNode(message));
  const x = document.createElement("button");
  x.type = "button";
  x.className = "toast-x";
  x.setAttribute("aria-label", "Dismiss notification");
  x.textContent = "\u00d7";
  t.append(body, x);
  wrap.appendChild(t);
  const kill = () => {
    t.classList.add("leaving");
    window.setTimeout(() => t.remove(), 260);
  };
  x.addEventListener("click", kill);
  window.setTimeout(kill, timeout);
  return t;
}

// ---- Skeleton rows for tables (visual loading state) ----
// dashSkeleton(document.querySelector("#tbl tbody"), 5) -> shimmer placeholders.
function dashSkeleton(tbody, cols, rows = 5) {
  if (!tbody) return;
  tbody.innerHTML = "";
  for (let i = 0; i < rows; i++) {
    const tr = document.createElement("tr");
    tr.className = "sk-row";
    tr.setAttribute("aria-hidden", "true");
    for (let c = 0; c < cols; c++) {
      const td = document.createElement("td");
      const bar = document.createElement("span");
      bar.className = "sk-bar";
      td.appendChild(bar);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

// ---- "Updated h:mm:ss" stamp (set on every successful paint) ----
function dashStamp(el) {
  const text = `Updated ${new Date().toLocaleTimeString()}`;
  if (el) el.textContent = text;
  return text;
}

// ---- Per-field validation helper (red border + aria-invalid) ----
function dashFieldError(input, hasError) {
  if (!input) return;
  input.setAttribute("aria-invalid", hasError ? "true" : "false");
  const field = input.closest(".field") || input.closest(".modal-field");
  if (field) field.classList.toggle("invalid", hasError);
}

// ---- Accessible tabs: .dash-tabs [data-t] -> role=tab + arrow keys ----
// dashTabsInit((tabValue, btn) => load(tabValue)). The panel that follows
// the strip should carry role="tabpanel".
function dashTabsInit(onChange) {
  const strip = document.querySelector(".dash-tabs");
  if (!strip) return null;
  const tabs = Array.from(strip.querySelectorAll("[data-t]"));
  tabs.forEach((b, i) => {
    b.setAttribute("role", "tab");
    b.id = b.id || `dashtab-${i}`;
    const sync = (on) => {
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    };
    sync(b.classList.contains("on"));
    b.addEventListener("click", () => {
      tabs.forEach((x) => {
        const on = x === b;
        x.classList.toggle("on", on);
        x.setAttribute("aria-selected", on ? "true" : "false");
        x.tabIndex = on ? 0 : -1;
      });
      const panel = strip.nextElementSibling;
      if (panel && panel.getAttribute("role") === "tabpanel") {
        panel.setAttribute("aria-labelledby", b.id);
      }
      if (onChange) onChange(b.dataset.t, b);
    });
    b.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = tabs[(i + d + tabs.length) % tabs.length];
      next.focus();
      next.click();
    });
  });
  const on = tabs.find((b) => b.classList.contains("on")) || tabs[0];
  const panel0 = strip.nextElementSibling;
  if (on && panel0 && panel0.getAttribute("role") === "tabpanel") {
    panel0.setAttribute("aria-labelledby", on.id);
  }
  return tabs;
}

// ---- Shared dialogs (all popups go through here) ----
// dashConfirm({message}) -> true on Yes, false on No.
// dashAlert(message, title) -> resolves on OK (informational, one button).
// dashPrompt({message, label, value}) -> typed string on OK, null on Cancel.
// dashSelect({message, label, options, value, title}) -> chosen value / null.
// One generic gold-top modal, a11y: aria-modal + labelledby/describedby,
// focus trap, initial focus, focus restored to the trigger on close.
let dashModalEl = null;
function dashModal() {
  if (dashModalEl) return dashModalEl;
  dashModalEl = document.createElement("div");
  dashModalEl.className = "dash-modal";
  dashModalEl.setAttribute("role", "dialog");
  dashModalEl.setAttribute("aria-modal", "true");
  dashModalEl.setAttribute("aria-labelledby", "dashModalTitle");
  dashModalEl.setAttribute("aria-describedby", "dashModalMsg");
  dashModalEl.innerHTML =
    `<div class="dash-modal-box" tabindex="-1">` +
    `<p class="dash-modal-title" id="dashModalTitle"></p>` +
    `<p class="dash-modal-msg" id="dashModalMsg"></p>` +
    `<label class="modal-field" hidden><span></span><input /><span class="modal-err"></span></label>` +
    `<label class="modal-select" hidden><span></span><select></select></label>` +
    `<div class="modal-schedule" hidden>` +
    `<label class="modal-field"><span>Display name</span><input class="modal-schedule-name" type="text" autocomplete="off" /></label>` +
    `<div class="modal-times">` +
    `<label><span>Start</span><input class="modal-schedule-start" type="time" /></label>` +
    `<label><span>End</span><input class="modal-schedule-end" type="time" /></label>` +
    `</div><p class="modal-hint" hidden></p></div>` +
    `<div class="modal-actions"><button class="btn btn-solid dash-ok">Yes</button>` +
    `<button class="btn btn-ghost dash-cancel">No</button></div>` +
    `</div>`;
  document.body.appendChild(dashModalEl);
  return dashModalEl;
}

let dashLastFocus = null;
function dashTrapTab(e) {
  if (e.key !== "Tab" || !dashModalEl || !dashModalEl.classList.contains("open")) return;
  const focusables = dashModalEl.querySelectorAll(
    'button:not([hidden]):not(:disabled), input:not([hidden]), select:not([hidden]), [tabindex]:not([tabindex="-1"])'
  );
  const list = Array.from(focusables).filter((el) => el.offsetParent !== null);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!dashModalEl.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
}

function dashModalOpen(m, initialEl) {
  dashLastFocus = document.activeElement;
  document.addEventListener("keydown", dashTrapTab, true);
  document.body.style.overflow = "hidden";
  m.classList.add("open");
  (initialEl || m.querySelector(".dash-modal-box")).focus();
}

function dashModalClose(m) {
  m.classList.remove("open");
  document.removeEventListener("keydown", dashTrapTab, true);
  document.body.style.overflow = "";
  if (dashLastFocus && dashLastFocus.focus) {
    try { dashLastFocus.focus(); } catch { /* trigger removed */ }
  }
  dashLastFocus = null;
}

function dashAsk({ title = "", message = "", okLabel = "Yes", cancelLabel = "No", prompt = null, hideCancel = false } = {}) {
  return new Promise((resolve) => {
    const m = dashModal();
    m.querySelector(".dash-modal-title").textContent = title;
    m.querySelector(".dash-modal-title").style.display = title ? "" : "none";
    m.querySelector(".dash-modal-msg").textContent = message;
    m.querySelector(".modal-select").hidden = true;
    const sched = m.querySelector(".modal-schedule");
    if (sched) sched.hidden = true;
    const field = m.querySelector(".modal-field");
    const input = m.querySelector(".modal-field input");
    const err = m.querySelector(".modal-field .modal-err");
    const ok = m.querySelector(".dash-ok");
    const cancel = m.querySelector(".dash-cancel");
    ok.textContent = okLabel;
    cancel.textContent = cancelLabel;
    cancel.hidden = hideCancel;
    field.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
    if (err) err.textContent = "";
    if (prompt) {
      field.hidden = false;
      field.querySelector("span").textContent = prompt.label || "";
      input.value = prompt.value || "";
      input.setAttribute("inputmode", prompt.numeric ? "numeric" : "text");
    } else {
      field.hidden = true;
    }
    const done = (v) => {
      ok.onclick = cancel.onclick = null;
      document.removeEventListener("keydown", onKey);
      m.removeEventListener("click", onBackdrop);
      dashModalClose(m);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === "Escape") done(prompt ? null : hideCancel ? true : false); };
    const onBackdrop = (e) => { if (e.target === m) done(prompt ? null : hideCancel ? true : false); };
    ok.onclick = () => done(prompt ? input.value : true);
    cancel.onclick = () => done(prompt ? null : false);
    m.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
    dashModalOpen(m, prompt ? input : null);
  });
}

function dashConfirm(message, title = "Please confirm") {
  return dashAsk({ title, message, okLabel: "Yes", cancelLabel: "No" });
}

// dashAlert(message, title) - OK-only dialog for informational states
// (replaces using dashConfirm to "inform", which forced a Yes click).
function dashAlert(message, title = "Notice") {
  return dashAsk({ title, message, okLabel: "OK", hideCancel: true });
}

function dashPrompt(message, label, value = "", title = "Enter a value") {
  return dashAsk({ title, message, okLabel: "Save", cancelLabel: "Cancel", prompt: { label, value } });
}

// dashSelect({message, label, options, value, title}) -> chosen option value
// on Save, null on Cancel. Renders a dropdown instead of a text field, so
// only valid choices (e.g. table statuses) can be submitted.
function dashSelect({ message = "", label = "", options = [], value = "", title = "Choose" } = {}) {
  return new Promise((resolve) => {
    const m = dashModal();
    m.querySelector(".dash-modal-title").textContent = title;
    m.querySelector(".dash-modal-title").style.display = title ? "" : "none";
    m.querySelector(".dash-modal-msg").textContent = message;
    m.querySelector(".modal-field").hidden = true;
    const schedHide = m.querySelector(".modal-schedule");
    if (schedHide) schedHide.hidden = true;
    const wrap = m.querySelector(".modal-select");
    const sel = m.querySelector(".modal-select select");
    wrap.hidden = false;
    wrap.querySelector("span").textContent = label;
    sel.innerHTML = "";
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value !== undefined ? o.value : o;
      opt.textContent = o.label !== undefined ? o.label : o;
      if (String(opt.value) === String(value)) opt.selected = true;
      sel.appendChild(opt);
    }
    const ok = m.querySelector(".dash-ok");
    const cancel = m.querySelector(".dash-cancel");
    ok.textContent = "Save";
    cancel.textContent = "Cancel";
    cancel.hidden = false;
    const done = (v) => {
      ok.onclick = cancel.onclick = null;
      wrap.hidden = true;
      document.removeEventListener("keydown", onKey);
      m.removeEventListener("click", onBackdrop);
      dashModalClose(m);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    const onBackdrop = (e) => { if (e.target === m) done(null); };
    ok.onclick = () => done(sel.value);
    cancel.onclick = () => done(null);
    m.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
    dashModalOpen(m, sel);
  });
}

// dashEditCashier({message, displayName, schedule, title}) -> {displayName, schedule}
// on Save, null on Cancel. Schedule uses native time pickers (Start + End) so
// admins can't type free text; stored as "HH:MM - HH:MM". Overnight allowed
// (end may be earlier than start). Both times empty clears the schedule.
// Legacy free-text schedules won't parse: pickers start empty and the old
// value is shown as a hint until overwritten.
function dashParseSchedule(raw) {
  const mt = /^\s*([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)\s*$/.exec(String(raw || ""));
  if (!mt) return { start: "", end: "" };
  return { start: `${mt[1]}:${mt[2]}`, end: `${mt[3]}:${mt[4]}` };
}

function dashEditCashier({ message = "", displayName = "", schedule = "", title = "Edit cashier" } = {}) {
  return new Promise((resolve) => {
    const m = dashModal();
    m.querySelector(".dash-modal-title").textContent = title;
    m.querySelector(".dash-modal-title").style.display = title ? "" : "none";
    m.querySelector(".dash-modal-msg").textContent = message;
    m.querySelector(".modal-field").hidden = true;
    m.querySelector(".modal-select").hidden = true;
    const sched = m.querySelector(".modal-schedule");
    const nameInput = m.querySelector(".modal-schedule-name");
    const startInput = m.querySelector(".modal-schedule-start");
    const endInput = m.querySelector(".modal-schedule-end");
    const hint = m.querySelector(".modal-hint");
    const parsed = dashParseSchedule(schedule);
    nameInput.value = displayName || "";
    startInput.value = parsed.start;
    endInput.value = parsed.end;
    if (schedule && !parsed.start) {
      hint.hidden = false;
      hint.textContent = `Current schedule "${schedule}" isn't a time range — pick Start and End to replace it, or leave both empty to clear.`;
    } else {
      hint.hidden = true;
      hint.textContent = "";
    }
    sched.hidden = false;
    const ok = m.querySelector(".dash-ok");
    const cancel = m.querySelector(".dash-cancel");
    ok.textContent = "Save";
    cancel.textContent = "Cancel";
    cancel.hidden = false;
    const done = (v) => {
      ok.onclick = cancel.onclick = null;
      sched.hidden = true;
      document.removeEventListener("keydown", onKey);
      m.removeEventListener("click", onBackdrop);
      dashModalClose(m);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    const onBackdrop = (e) => { if (e.target === m) done(null); };
    ok.onclick = () => {
      const s = startInput.value;
      const e = endInput.value;
      if ((s && !e) || (!s && e)) {
        hint.hidden = false;
        hint.textContent = "Pick both Start and End times, or leave both empty to clear the schedule.";
        (s ? endInput : startInput).focus();
        return;
      }
      done({ displayName: nameInput.value, schedule: s && e ? `${s} - ${e}` : "" });
    };
    cancel.onclick = () => done(null);
    m.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
    dashModalOpen(m, nameInput);
  });
}
