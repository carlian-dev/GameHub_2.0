// js/reservations.js - CU-004..CU-014 guest reservation flow on the landing page.
// Removed: find/cancel reservation UI (per request). Only the new reservation form remains.
(function () {
  const form = document.getElementById("reserveForm");
  if (!form) return;

  const tableSel = document.getElementById("reserveTable");
  const dateIn = document.getElementById("reserveDate");
  const timeIn = document.getElementById("reserveTime");
  const durSel = document.getElementById("reserveDuration");
  const nameIn = document.getElementById("reserveName");
  const contactIn = document.getElementById("reserveContact");
  const reviewBtn = document.getElementById("reserveReviewBtn");
  const reviewEl = document.getElementById("reserveReview");
  const resultEl = document.getElementById("reserveResult");
  const errorEl = document.getElementById("reserveError");

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

  async function loadTables() {
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
      }
    } catch (e) {
      setError(e.message);
    }
  }

  function buildReview() {
    setError("");
    const tableText = tableSel.options[tableSel.selectedIndex]?.textContent || "";
    const date = dateIn.value;
    const time = timeIn.value;
    if (!tableSel.value || !date || !time || !nameIn.value.trim() || !contactIn.value.trim()) {
      setError("Please fill in all fields.");
      return null;
    }
    const payload = {
      tableId: tableSel.value,
      customerName: nameIn.value.trim(),
      contactNumber: contactIn.value.trim(),
      startTime: new Date(`${date}T${time}`).toISOString(),
      durationMinutes: Number(durSel.value || 60),
    };
    reviewEl.innerHTML = "";
    const rows = [
      ["Table", tableText],
      ["Date", date],
      ["Time", time],
      ["Duration", `${payload.durationMinutes / 60} hour(s)`],
      ["Name", payload.customerName],
      ["Contact", payload.contactNumber],
    ];
    rows.forEach(([k, v]) => {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = k + ": ";
      p.appendChild(strong);
      p.appendChild(document.createTextNode(v));
      reviewEl.appendChild(p);
    });
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn btn-solid";
    confirmBtn.textContent = "Confirm reservation";
    confirmBtn.addEventListener("click", () => submit(payload));
    reviewEl.appendChild(confirmBtn);
    reviewEl.hidden = false;
    resultEl.hidden = true;
    return payload;
  }

  async function submit(payload) {
    setError("");
    try {
      const res = await createReservation(payload);
      const r = res.reservation;
      resultEl.innerHTML = "";
      const h = document.createElement("h3");
      h.textContent = "Reservation confirmed";
      resultEl.appendChild(h);
      const details = [
        ["Reference", r.ref],
        ["Table", r.tableName],
        ["Start", new Date(r.startTime).toLocaleString()],
        ["End", new Date(r.endTime).toLocaleString()],
        ["Name", r.customerName],
        ["Contact", r.contactNumber],
      ];
      details.forEach(([k, v]) => {
        const p = document.createElement("p");
        const strong = document.createElement("strong");
        strong.textContent = k + ": ";
        p.appendChild(strong);
        p.appendChild(document.createTextNode(v));
        resultEl.appendChild(p);
      });
      resultEl.hidden = false;
      reviewEl.hidden = true;
      form.reset();
      dateIn.value = todayISO();
    } catch (e) {
      setError(e.message);
    }
  }

  if (dateIn) dateIn.value = todayISO();
  if (timeIn) timeIn.value = "18:00";

  loadTables();
  reviewBtn?.addEventListener("click", buildReview);
})();