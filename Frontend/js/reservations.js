// js/reservations.js - CU-004..CU-014 guest reservation flow on the landing page.
// One screen: the booking summary fills in live while the guest types, and the
// confirm button enables once every field is filled. The cashier accepts from
// the reservation queue, which sends the ACCEPTED email.
(function () {
  const form = document.getElementById("reserveForm");
  if (!form) return;

  const tableSel = document.getElementById("reserveTable");
  const dateIn = document.getElementById("reserveDate");
  const timeIn = document.getElementById("reserveTime");
  const durSel = document.getElementById("reserveDuration");
  const nameIn = document.getElementById("reserveName");
  const contactIn = document.getElementById("reserveContact");
  const emailIn = document.getElementById("reserveEmail");
  const submitBtn = document.getElementById("reserveSubmitBtn");
  const errorEl = document.getElementById("reserveError");
  const summaryEl = document.getElementById("reserveSummary");
  const summaryTitle = document.getElementById("reserveSummaryTitle");
  const sumDate = document.getElementById("sumDate");
  const sumTime = document.getElementById("sumTime");
  const sumDuration = document.getElementById("sumDuration");
  const sumName = document.getElementById("sumName");
  const sumContact = document.getElementById("sumContact");
  const sumEmail = document.getElementById("sumEmail");
  const resultEl = document.getElementById("reserveResult");
  const cardEl = form.closest(".reserve-card");

  const CONTACT_RE = /^[0-9+\-\s()]{7,25}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const fields = [tableSel, dateIn, timeIn, nameIn, contactIn, emailIn];
  let submitting = false;
  let showErrors = false;

  function setError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg || "";
    errorEl.hidden = !msg;
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseStart() {
    if (!dateIn.value || !timeIn.value) return null;
    const d = new Date(`${dateIn.value}T${timeIn.value}`);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDay(d) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(d);
  }

  function fmtClock(d) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  }

  function durationLabel(minutes) {
    const n = Number(minutes || 0);
    if (!n) return "—";
    const hours = Math.floor(n / 60);
    const rest = n % 60;
    if (hours && rest) return `${hours} hr ${rest} min`;
    if (hours) return `${hours} hour${hours === 1 ? "" : "s"}`;
    return `${rest} min`;
  }

  function fieldProblems() {
    const problems = [];
    if (!tableSel.value) problems.push([tableSel, "Choose a table."]);

    const start = parseStart();
    if (!start) {
      problems.push([dateIn, "Choose a valid date and time."]);
    } else if (start.getTime() < Date.now() - 60 * 1000) {
      problems.push([dateIn, "Choose a time in the future."]);
    }

    if (nameIn.value.trim().length < 2) {
      problems.push([nameIn, "Enter your name (2–60 characters)."]);
    }
    if (!CONTACT_RE.test(contactIn.value.trim())) {
      problems.push([contactIn, "Enter a valid contact number."]);
    }
    if (!EMAIL_RE.test(emailIn.value.trim())) {
      problems.push([emailIn, "Enter a valid email address."]);
    }
    return { problems, start };
  }

  function markField(input, bad) {
    input.setAttribute("aria-invalid", bad ? "true" : "false");
    const wrap = input.closest(".reserve-field");
    if (wrap) wrap.classList.toggle("is-invalid", bad);
  }

  function markAll(problems) {
    const bad = new Set(problems.map(([input]) => input));
    fields.forEach((input) => markField(input, bad.has(input)));
  }

  function syncSummary() {
    const { start } = fieldProblems();
    const tableText = tableSel.options[tableSel.selectedIndex]?.textContent || "";
    const duration = Number(durSel.value || 60);

    summaryTitle.textContent = tableText && tableSel.value ? tableText : "Choose a table";
    sumDate.textContent = start ? fmtDay(start) : "—";
    sumTime.textContent = start
      ? `${fmtClock(start)} – ${fmtClock(new Date(start.getTime() + duration * 60000))}`
      : "—";
    sumDuration.textContent = durationLabel(duration);
    sumName.textContent = nameIn.value.trim() || "—";
    sumContact.textContent = contactIn.value.trim() || "—";
    sumEmail.textContent = emailIn.value.trim() || "—";

    // Keep the button tappable whenever the fields are filled so invalid
    // formats/past times can explain themselves on submit instead of leaving
    // the guest with a silent disabled button.
    const complete = Boolean(
      tableSel.value &&
        dateIn.value &&
        timeIn.value &&
        nameIn.value.trim() &&
        contactIn.value.trim() &&
        emailIn.value.trim()
    );
    submitBtn.disabled = submitting || !complete;
  }

  async function loadTables() {
    tableSel.disabled = true;
    tableSel.innerHTML = "";
    const loading = document.createElement("option");
    loading.value = "";
    loading.textContent = "Loading tables…";
    tableSel.appendChild(loading);

    try {
      const { tables } = await listPublicTables();
      tableSel.innerHTML = "";
      (tables || []).forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        tableSel.appendChild(opt);
      });
      if (!tableSel.options.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No tables available";
        tableSel.appendChild(opt);
        tableSel.disabled = true;
      } else {
        tableSel.disabled = false;
      }
    } catch (e) {
      tableSel.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Couldn't load tables";
      tableSel.appendChild(opt);
      tableSel.disabled = true;
      setError(e.message);
    }
    syncSummary();
  }

  function buildResult(reservation) {
    resultEl.innerHTML = "";

    const icon = document.createElement("span");
    icon.className = "reserve-success-icon";
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>';

    const kicker = document.createElement("p");
    kicker.className = "reserve-success-kicker";
    kicker.textContent = "Request received";

    const title = document.createElement("h3");
    title.textContent = "We’ve got your table request.";

    const ref = document.createElement("p");
    ref.className = "reserve-success-ref";
    ref.append(document.createTextNode("Reference "));
    const refCode = document.createElement("strong");
    refCode.textContent = reservation.ref || "—";
    ref.appendChild(refCode);

    const note = document.createElement("p");
    note.className = "reserve-success-note";
    const email = reservation.customerEmail || "your email";
    note.append(
      document.createTextNode("An email will be sent to "),
      Object.assign(document.createElement("strong"), { textContent: email }),
      document.createTextNode(" as soon as the team accepts. Keep your reference handy.")
    );

    const dl = document.createElement("dl");
    dl.className = "reserve-success-list";
    const start = reservation.startTime ? new Date(reservation.startTime) : null;
    const end = reservation.endTime ? new Date(reservation.endTime) : null;
    [
      ["Table", reservation.tableName || "—"],
      ["Date", start ? fmtDay(start) : "—"],
      ["Time", start && end ? `${fmtClock(start)} – ${fmtClock(end)}` : "—"],
      ["Status", "Waiting for approval"],
    ].forEach(([label, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      row.append(dt, dd);
      dl.appendChild(row);
    });

    const again = document.createElement("button");
    again.type = "button";
    again.className = "reserve-again";
    again.textContent = "Book another table";
    again.addEventListener("click", () => {
      if (cardEl) cardEl.classList.remove("is-complete");
      resultEl.hidden = true;
      summaryEl.hidden = false;
      setError("");
      showErrors = false;
      fields.forEach((input) => markField(input, false));
      syncSummary();
      tableSel.focus();
    });

    resultEl.append(icon, kicker, title, ref, dl, note, again);
    if (cardEl) cardEl.classList.add("is-complete");
    summaryEl.hidden = true;
    resultEl.hidden = false;
    resultEl.tabIndex = -1;
    resultEl.focus({ preventScroll: true });
  }

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;

    showErrors = true;
    const { problems, start } = fieldProblems();
    markAll(problems);
    if (problems.length) {
      setError(problems[0][1]);
      problems[0][0].focus();
      return;
    }

    setError("");
    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending request…";

    try {
      const { reservation } = await createReservation({
        tableId: tableSel.value,
        customerName: nameIn.value.trim(),
        customerEmail: emailIn.value.trim(),
        contactNumber: contactIn.value.trim(),
        startTime: start.toISOString(),
        durationMinutes: Number(durSel.value || 60),
      });
      buildResult(reservation);
      form.reset();
      dateIn.value = todayISO();
      timeIn.value = "18:00";
      await loadTables();
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      resultEl.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
    } catch (err) {
      setError(err.message);
    } finally {
      submitting = false;
      submitBtn.textContent = "Confirm reservation";
      syncSummary();
    }
  }

  fields.forEach((input) => {
    input.addEventListener("blur", () => {
      if (showErrors) {
        const { problems } = fieldProblems();
        markAll(problems);
      }
    });
    input.addEventListener("input", () => {
      if (showErrors) {
        const { problems } = fieldProblems();
        markAll(problems);
      }
      syncSummary();
    });
    input.addEventListener("change", () => {
      if (showErrors) {
        const { problems } = fieldProblems();
        markAll(problems);
      }
      syncSummary();
    });
  });

  form.addEventListener("submit", submit);

  if (dateIn) {
    dateIn.value = todayISO();
    dateIn.min = todayISO();
  }
  if (timeIn) timeIn.value = "18:00";

  syncSummary();
  loadTables();
})();
