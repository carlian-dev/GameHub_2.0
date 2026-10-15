// js/dash.js - shared dashboard shell behavior (all staff pages).
// Sidebar toggle (mobile), outside-click close, theme toggle persisted in
// localStorage (dark default, matching the landing), and [data-today] dates.
// Pure local UI: no API calls here; page scripts own guards + data.
(function () {
  const root = document.querySelector(".dash") || document.body;
  const side = document.querySelector(".dash-side");
  const menu = document.querySelector(".dash-menu");
  if (menu && side) {
    menu.addEventListener("click", () => side.classList.toggle("open"));
    document.addEventListener("click", (e) => {
      if (window.innerWidth <= 860 && side.classList.contains("open") &&
        !side.contains(e.target) && !menu.contains(e.target)) {
        side.classList.remove("open");
      }
    });
  }
  const themeBtn = document.querySelector(".dash-theme");
  const applyTheme = (t) => {
    root.setAttribute("data-theme", t);
    if (themeBtn && themeBtn.classList) themeBtn.classList.toggle("is-light", t === "light");
  };
  let theme = "dark";
  try { theme = localStorage.getItem("gh-theme") || "dark"; } catch { /* private mode */ }
  applyTheme(theme);
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      theme = (root.getAttribute("data-theme") === "dark") ? "light" : "dark";
      try { localStorage.setItem("gh-theme", theme); } catch { /* private mode */ }
      applyTheme(theme);
    });
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
    let pill = nav.querySelector(".dash-nav-pill");
    if (!pill) {
      pill = document.createElement("span");
      pill.className = "dash-nav-pill";
      pill.setAttribute("aria-hidden", "true");
      nav.prepend(pill);
    }
    nav.classList.add("has-pill");

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
          if (window.innerWidth <= 860 && side) side.classList.remove("open");
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
            if (window.innerWidth <= 860 && side) side.classList.remove("open");
          }
        } catch { /* external URL: let it navigate */ }
      });
    });

    // Back/forward + manual hash edits.
    window.addEventListener("hashchange", () => {
      const match = linkForHash(location.hash);
      if (match) setActive(match);
      else if (!location.hash && links.length) setActive(links[0]);
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
    const initial =
      (location.hash && linkForHash(location.hash)) ||
      nav.querySelector("a.active") ||
      links[0];
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

// ---- Shared Yes/No + input + select + schedule dialogs (all popups go through here) ----
// dashConfirm({message}) -> true on Yes, false on No.
// dashPrompt({message, label, value}) -> typed string on OK, null on Cancel.
// One generic gold-top modal, side-by-side buttons, injected once per page.
let dashModalEl = null;
function dashModal() {
  if (dashModalEl) return dashModalEl;
  dashModalEl = document.createElement("div");
  dashModalEl.className = "dash-modal";
  dashModalEl.setAttribute("role", "dialog");
  dashModalEl.setAttribute("aria-modal", "true");
  dashModalEl.innerHTML =
    `<div class="dash-modal-box">` +
    `<p class="dash-modal-title" style="font-family:Georgia,'Times New Roman',serif;font-size:20px;margin:0 0 8px"></p>` +
    `<p class="dash-modal-msg"></p>` +
    `<label class="modal-field" hidden><span></span><input /></label>` +
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

function dashAsk({ title = "", message = "", okLabel = "Yes", cancelLabel = "No", prompt = null }) {
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
    const ok = m.querySelector(".dash-ok");
    const cancel = m.querySelector(".dash-cancel");
    ok.textContent = okLabel;
    cancel.textContent = cancelLabel;
    if (prompt) {
      field.hidden = false;
      field.querySelector("span").textContent = prompt.label || "";
      input.value = prompt.value || "";
      input.setAttribute("inputmode", prompt.numeric ? "numeric" : "text");
    } else {
      field.hidden = true;
    }
    const done = (v) => {
      m.classList.remove("open");
      ok.onclick = cancel.onclick = null;
      resolve(v);
    };
    ok.onclick = () => done(prompt ? input.value : true);
    cancel.onclick = () => done(prompt ? null : false);
    m.classList.add("open");
    if (prompt) input.focus();
  });
}

function dashConfirm(message, title = "Please confirm") {
  return dashAsk({ title, message, okLabel: "Yes", cancelLabel: "No" });
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
    const done = (v) => {
      m.classList.remove("open");
      ok.onclick = cancel.onclick = null;
      wrap.hidden = true;
      ok.textContent = "Yes";
      cancel.textContent = "No";
      resolve(v);
    };
    ok.onclick = () => done(sel.value);
    cancel.onclick = () => done(null);
    m.classList.add("open");
    sel.focus();
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
    const done = (v) => {
      m.classList.remove("open");
      ok.onclick = cancel.onclick = null;
      sched.hidden = true;
      ok.textContent = "Yes";
      cancel.textContent = "No";
      resolve(v);
    };
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
    m.classList.add("open");
    nameInput.focus();
  });
}
