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
