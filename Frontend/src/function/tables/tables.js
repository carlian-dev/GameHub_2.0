// src/function/tables/tables.js - tables page logic. Pair: tables.html <->
// Backend/src/function/tables/tables.php.
// Tabs filter by status (AD-013); rows: Rename (AD-010), Status (AD-012),
// Archive (AD-011) / Unarchive (AD-008); Add form (AD-009).
// Rates live on rates.html/rates.js now. Guard: admin-only. Search filters rows.
//
// Optimistic updates: mutations flip their row instantly from the lastRows
// cache (patchRow) and reconcile on response — success converges quietly,
// failure restores the snapshot + shows the error. In-flight rows dim.
let tab = "all";
let lastRows = [];
const pendingIds = new Set();

function setMsg(t) { document.getElementById("msg").textContent = t; }

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
  setMsg(`${paint(lastRows)} shown (${tab}).`);
}

function busy(id) { return pendingIds.has(id); }
function done(id) { pendingIds.delete(id); }

async function guard() {
  try {
    const me = await getMe();
    if (me.role !== "admin") { location.href = "../auth/login.html"; return null; }
    const name = me.email || "admin";
    document.getElementById("who").textContent = name;
    document.getElementById("avatar").textContent = name.charAt(0).toUpperCase();
    return me;
  } catch { location.href = "../auth/login.html"; return null; }
}

function row(t) {
  const tr = document.createElement("tr");
  if (t.archived || busy(t.id)) tr.classList.add("dim");
  const statusBadge = t.archived
    ? `<span class="badge archived">archived</span>`
    : `<span class="badge ${t.status}">${t.status}</span>`;
  tr.innerHTML = `<td>${t.name}</td><td>${statusBadge}</td><td></td>`;
  const act = tr.lastChild;

  const rn = document.createElement("button");
  rn.textContent = "Rename";
  rn.className = "rowbtn";
  rn.onclick = async () => {
    if (busy(t.id)) return;
    const n = await dashPrompt("Rename this billiard table.", "Table name", t.name, "Rename table");
    if (n === null || n.trim() === "") return;
    const undo = patchRow(t.id, { name: n.trim() });
    try { await renameTable(t.id, n.trim()); done(t.id); load(); }
    catch (e) { undo(); setMsg(e.message); }
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
        options: ["available", "occupied", "reserved"],
        value: t.status,
        title: "Table status",
      });
      if (s === null) return;
      const undo = patchRow(t.id, { status: s });
      try { await setTableStatus(t.id, s); done(t.id); load(); }
      catch (e) { undo(); setMsg(e.message); }
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
      try { await archiveTable(t.id); done(t.id); load(); }
      catch (e) { undo(); setMsg(e.message); }
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
      try { await unarchiveTable(t.id); done(t.id); load(); }
      catch (e) { undo(); setMsg(e.message); }
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
  msg.textContent = "Loading...";
  try {
    const { tables } = await listTables(tab);
    lastRows = tables;
    msg.textContent = `${paint(tables)} shown (${tab}).`;
  } catch (e) { msg.textContent = e.message; }
}

document.querySelectorAll("[data-t]").forEach((b) =>
  b.addEventListener("click", () => {
    tab = b.dataset.t;
    document.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x === b));
    load();
  }));
document.getElementById("q").addEventListener("input", () => {
  if (!lastRows.length) return;
  document.getElementById("msg").textContent = `${paint(lastRows)} shown (${tab}).`;
});
document.getElementById("add").addEventListener("click", async () => {
  const msg = document.getElementById("msg");
  const input = document.getElementById("newName");
  const name = input.value.trim();
  if (name === "") { msg.textContent = "Table name is required."; return; }
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
  } catch (e) {
    pendingIds.delete(tempId);
    const i = lastRows.findIndex((r) => r.id === tempId);
    if (i !== -1) lastRows.splice(i, 1);
    repaint();
    msg.textContent = e.message;
  }
});
document.getElementById("out").addEventListener("click", async () => {
  await logout(); location.href = "../auth/login.html";
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