// src/function/tables/tables.js - tables page logic. Pair: tables.html <->
// server/src/routes/tables.routes.js (+ admin sessions list so each row
// shows its Current session and a live Time left countdown).
// Tabs filter by status (AD-013, incl. maintenance); rows: Rename (AD-010),
// Status (AD-012), Archive (AD-011) / Unarchive (AD-008); Add form (AD-009,
// Enter submits). Rates live on rates.html/rates.js. Guard: admin-only.
//
// Optimistic updates: mutations flip their row instantly from the lastRows
// cache (patchRow) and reconcile on response — success converges quietly +
// toast, failure restores the snapshot + error toast. In-flight rows dim.
// All strings are written with textContent (never interpolated into innerHTML).
let tab = "all";
let lastRows = [];
let lastSessions = [];
function createSessionBar(startTime, endTime, plannedMinutes = 60) {
  const track = document.createElement("div");
  track.className = "session-bar-track";
  track.setAttribute("aria-hidden", "true");

  const fill = document.createElement("div");
  fill.className = "session-bar-fill bar-green";
  if (startTime) fill.setAttribute("data-bar-start", startTime);
  if (endTime) fill.setAttribute("data-bar-end", endTime);
  if (plannedMinutes) fill.setAttribute("data-bar-planned", String(plannedMinutes));
  fill.style.width = "100%";

  track.appendChild(fill);
  return track;
}

const pendingIds = new Set();

function setMsg(t, kind = "") {
  const el = document.getElementById("msg");
  el.textContent = t;
  el.className = `dash-msg${kind ? " " + kind : ""}`;
}

function patchRow(id, fields, remove = false) {
  const i = lastRows.findIndex((r) => r.id === id);
  if (i === -1) return () => {};
  const snapshot = { ...lastRows[i] };
  if (remove) lastRows.splice(i, 1);
  else lastRows[i] = { ...lastRows[i], ...fields };
  pendingIds.add(id);
  repaint();
  return () => {
    pendingIds.delete(id);
    if (remove) {
      lastRows.splice(Math.min(i, lastRows.length), 0, snapshot);
    } else {
      const j = lastRows.findIndex((r) => r.id === id);
      if (j !== -1) lastRows[j] = snapshot;
    }
    repaint();
  };
}

function repaint() {
  const n = paint(lastRows);
  setMsg(`${n} shown (${tab}).`);
  const empty = document.getElementById("empty");
  empty.hidden = n > 0;
}

function busy(id) { return pendingIds.has(id); }
function done(id) { pendingIds.delete(id); }

async function guard() {
  try {
    const me = await getMe();
    if (me.role !== "admin") { location.href = staffHome(me.role); return null; }
    const name = me.email || "admin";
    document.getElementById("who").textContent = name;
    document.getElementById("avatar").textContent = name.charAt(0).toUpperCase();
    return me;
  } catch { location.href = "../auth/login.html"; return null; }
}

function row(t) {
  const tr = document.createElement("tr");
  if (t.archived || busy(t.id)) tr.classList.add("dim");
  tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td>";

  // Current session + live countdown (joined from active admin sessions).
  const session = t.archived ? null : lastSessions.find((s) => String(s.tableId) === String(t.id));

  const tblWrap = document.createElement("div");
  tblWrap.className = "session-table-cell";
  const nameEl = document.createElement("strong");
  nameEl.className = "session-table-name";
  nameEl.textContent = t.name;
  tblWrap.appendChild(nameEl);
  if (session && session.endTime) {
    tblWrap.appendChild(createSessionBar(session.startTime, session.endTime, session.plannedMinutes));
  }
  tr.children[0].appendChild(tblWrap);

  const statusTd = tr.children[1];
  const badge = document.createElement("span");
  badge.className = `badge ${t.archived ? "archived" : t.status}`;
  badge.textContent = t.archived ? "archived" : t.status;
  statusTd.appendChild(badge);

  tr.children[2].textContent = session
    ? `${session.customerName || "Customer"} · since ${session.startTime ? new Date(session.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}`
    : "—";

  if (session && session.endTime) {
    const timer = document.createElement("span");
    timer.className = "timer";
    timer.setAttribute("data-end", session.endTime);
    timer.textContent = "…";
    tr.children[3].appendChild(timer);
  } else {
    tr.children[3].textContent = "—";
  }

  const act = tr.children[4];

  const rn = document.createElement("button");
  rn.textContent = "Rename";
  rn.className = "rowbtn";
  rn.onclick = async () => {
    if (busy(t.id)) return;
    const n = await dashPrompt("Rename this billiard table.", "Table name", t.name, "Rename table");
    if (n === null || n.trim() === "") return;
    const undo = patchRow(t.id, { name: n.trim() });
    try {
      await renameTable(t.id, n.trim());
      done(t.id);
      load();
      dashToast(`Table renamed to “${n.trim()}”.`, "ok", { title: "Renamed" });
    } catch (e) { undo(); setMsg(e.message, "err"); dashToast(e.message, "err", { title: "Rename failed" }); }
  };
  act.appendChild(rn);

  if (!t.archived) {
    const st = document.createElement("button");
    st.textContent = "Status";
    st.className = "rowbtn";
    st.onclick = async () => {
      if (busy(t.id)) return;
      const s = await dashSelect({
        message: `Set status for ${t.name}.`,
        label: "Status",
        options: ["available", "occupied", "reserved", "maintenance"],
        value: t.status,
        title: "Table status",
      });
      if (s === null) return;
      const undo = patchRow(t.id, { status: s });
      try {
        await setTableStatus(t.id, s);
        done(t.id);
        load();
        dashToast(`${t.name} is now ${s}.`, "ok", { title: "Status updated" });
      } catch (e) { undo(); setMsg(e.message, "err"); dashToast(e.message, "err", { title: "Status update failed" }); }
    };
    act.appendChild(st);
    const a = document.createElement("button");
    a.textContent = "Archive";
    a.className = "rowbtn danger";
    a.onclick = async () => {
      if (busy(t.id)) return;
      const yes = await dashConfirm(
        `Archive ${t.name}? It will be hidden from play flows.`,
        "Archive table"
      );
      if (!yes) return;
      const undo = patchRow(t.id, { archived: true });
      try {
        await archiveTable(t.id);
        done(t.id);
        load();
        dashToast(`${t.name} archived.`, "ok", { title: "Archived" });
      } catch (e) { undo(); setMsg(e.message, "err"); dashToast(e.message, "err", { title: "Archive failed" }); }
    };
    act.appendChild(a);
  } else {
    const u = document.createElement("button");
    u.textContent = "Unarchive";
    u.className = "rowbtn go";
    u.onclick = async () => {
      if (busy(t.id)) return;
      const yes = await dashConfirm(
        `Unarchive ${t.name}? It will become available again.`,
        "Unarchive table"
      );
      if (!yes) return;
      const undo = patchRow(t.id, {}, true);
      try {
        await unarchiveTable(t.id);
        done(t.id);
        load();
        dashToast(`${t.name} is back in rotation.`, "ok", { title: "Unarchived" });
      } catch (e) { undo(); setMsg(e.message, "err"); dashToast(e.message, "err", { title: "Unarchive failed" }); }
    };
    act.appendChild(u);
  }
  return tr;
}

function paint(list) {
  const tb = document.querySelector("#tbl tbody");
  tb.innerHTML = "";
  const q = (document.getElementById("q").value || "").toLowerCase();
  const shown = list.filter((t) => !q || t.name.toLowerCase().includes(q));
  for (const t of shown) tb.appendChild(row(t));
  return shown.length;
}

async function load() {
  const msg = document.getElementById("msg");
  msg.textContent = "Loading…";
  msg.className = "dash-msg loading";
  dashSkeleton(document.querySelector("#tbl tbody"), 5, 4);
  dashStamp(document.getElementById("stamp"));
  try {
    const [{ tables }, active] = await Promise.all([
      listTables(tab),
      listSessions("active").catch(() => ({ sessions: [] })),
    ]);
    lastRows = tables;
    lastSessions = active.sessions || [];
    const n = paint(tables);
    msg.textContent = `${n} shown (${tab}) · ${lastSessions.length} session(s) running.`;
    msg.className = "dash-msg ok";
    document.getElementById("empty").hidden = n > 0;
    tickTimers();
  } catch (e) {
    setMsg(e.message, "err");
    document.getElementById("empty").hidden = false;
    document.getElementById("empty").textContent = "Couldn't load tables — refresh to retry.";
  }
}

// Per-second local countdowns for any [data-end] timer cells and session bars.
function tickTimers() {
  const now = Date.now();

  // 1. Text countdown timers
  document.querySelectorAll("[data-end]").forEach((el) => {
    const raw = el.getAttribute("data-end");
    if (!raw) return;
    const t = new Date(raw).getTime();
    if (isNaN(t)) return;
    const left = t - now;
    const a = Math.max(0, left);
    const h = Math.floor(a / 3600000);
    const m = Math.floor((a % 3600000) / 60000);
    const s = Math.floor((a % 60000) / 1000);
    el.textContent = h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
    el.classList.toggle("warn", left > 0 && left < 600000);
    el.classList.remove("over");
  });

  // 2. Standalone visual progress bars (green -> yellow -> red as time is almost done)
  document.querySelectorAll("[data-bar-end]").forEach((barFill) => {
    const endRaw = barFill.getAttribute("data-bar-end");
    if (!endRaw) return;
    const end = new Date(endRaw).getTime();
    if (isNaN(end)) return;

    const startRaw = barFill.getAttribute("data-bar-start");
    let totalMs = 0;
    if (startRaw) {
      const start = new Date(startRaw).getTime();
      if (!isNaN(start) && end > start) {
        totalMs = end - start;
      }
    }
    if (!totalMs) {
      const planned = Number(barFill.getAttribute("data-bar-planned"));
      totalMs = (Number.isFinite(planned) && planned > 0 ? planned : 60) * 60000;
    }

    const remainingMs = Math.max(0, end - now);
    const ratio = Math.max(0, Math.min(1, remainingMs / totalMs));
    const pct = Math.round(ratio * 100);

    let tone = "bar-green";
    let color = "#10B981";

    if (remainingMs <= 5 * 60000 || ratio <= 0.20) {
      tone = "bar-red";
      color = "#EF4444";
    } else if (remainingMs <= 15 * 60000 || ratio <= 0.50) {
      tone = "bar-yellow";
      color = "#F59E0B";
    }

    barFill.style.width = `${pct}%`;
    barFill.style.backgroundColor = color;
    barFill.className = `session-bar-fill ${tone}`;

    const track = barFill.parentElement;
    if (track) {
      track.title = `${remainingMs > 0 ? `${Math.ceil(remainingMs / 60000)}m remaining` : "0m remaining"} (${pct}%)`;
    }
  });
}
setInterval(() => {
  if (document.visibilityState === "visible") tickTimers();
}, 1000);

// Accessible tab strip: click + arrow keys, aria-selected, tabpanel labelledby.
dashTabsInit((t) => { tab = t; load(); });
document.getElementById("q").addEventListener("input", () => {
  if (!lastRows.length) return;
  const n = paint(lastRows);
  setMsg(`${n} shown (${tab}).`);
  document.getElementById("empty").hidden = n > 0;
});

document.getElementById("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("msg");
  const input = document.getElementById("newName");
  const name = input.value.trim();
  if (name === "") {
    dashFieldError(input, true);
    msg.textContent = "Table name is required.";
    msg.className = "dash-msg err";
    input.focus();
    return;
  }
  dashFieldError(input, false);
  const btn = document.getElementById("add");
  btn.disabled = true;
  // Optimistic insert with a temporary id; replaced by the quiet reload below.
  const tempId = "tmp-" + Date.now();
  lastRows.unshift({ id: tempId, name, status: "available", archived: false });
  pendingIds.add(tempId);
  repaint();
  try {
    await addTable(name);
    pendingIds.delete(tempId);
    input.value = "";
    load();
    dashToast(`“${name}” added as an available table.`, "ok", { title: "Table added" });
  } catch (err) {
    pendingIds.delete(tempId);
    const i = lastRows.findIndex((r) => r.id === tempId);
    if (i !== -1) lastRows.splice(i, 1);
    repaint();
    msg.textContent = err.message;
    msg.className = "dash-msg err";
    dashToast(err.message, "err", { title: "Add failed" });
  } finally {
    btn.disabled = false;
  }
});
guard().then((me) => { if (me) load(); });
// Quiet background refresh: converges with server truth every 60s while the
// page is visible and no dialog is open. Skips while a row is in flight.
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  if (document.querySelector(".dash-modal.open")) return;
  if (pendingIds.size > 0) return;
  load();
}, 60000);
