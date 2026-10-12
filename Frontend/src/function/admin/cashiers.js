// src/function/admin/cashiers.js - Staff table logic in the dashboard shell.
// Pair: cashiers.html <-> Backend/src/function/admin/cashiers.php.
// Tabs: active / archived (cashiers via listCashiers) + invites.
// Invite IS the approval — new accounts arrive active, no Applicants tab.
// Search box filters loaded rows locally.
// Archive is one step (confirm dialog only). Unarchive restores login.
// Admin rows are protected (never archived).
// Search box filters loaded rows locally.
// Guard + identity first.
//
// Optimistic updates: every mutation below flips its row instantly from the
// lastRows cache (patchRow) and reconciles when the server answers — success
// converges with a quiet reload, failure restores the snapshot + shows the
// error. Rows with in-flight requests render dimmed and ignore clicks.
let tab = "active";
let lastRows = [];
const pendingIds = new Set();

function setMsg(t) { document.getElementById("msg").textContent = t; }

// Optimistically apply fields to one cached row (or drop it when it leaves
// the current filter with remove=true). Returns undo() restoring the snapshot.
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

function row(c) {
  const tr = document.createElement("tr");
  if (c.status === "archived" || busy(c.id)) tr.classList.add("dim");
  const badge = c.role === "admin" ? " (protected)" : "";
  const id = `${c.email || c.username || "—"}`;
  tr.innerHTML =
    `<td>${id}</td><td><span class="badge ${c.status}">${c.status}</span></td>` +
    `<td>${c.displayName || ""}${badge}</td><td>${c.schedule || ""}</td><td></td>`;
  const act = tr.lastChild;

  const e = document.createElement("button");
  e.textContent = "Edit";
  e.className = "rowbtn";
  e.onclick = async () => {
    if (busy(c.id)) return;
    const r = await dashEditCashier({
      message: "Update this cashier account. Pick shift times below.",
      displayName: c.displayName || "",
      schedule: c.schedule || "",
      title: "Edit cashier",
    });
    if (r === null) return;
    const undo = patchRow(c.id, { displayName: r.displayName, schedule: r.schedule });
    try { await updateCashier(c.id, { displayName: r.displayName, schedule: r.schedule }); done(c.id); load(); }
    catch (err) { undo(); setMsg(err.message); }
  };
  act.appendChild(e);
  // AD-006.1: Archive hidden on admin rows — admins can never be archived.
  // Archive is one step: confirm dialog -> archive endpoint directly.
  if (c.role !== "admin" && c.status !== "archived") {
    const a = document.createElement("button");
    a.textContent = "Archive";
    a.className = "rowbtn danger";
    a.onclick = async () => {
      if (busy(c.id)) return;
      const yes = await dashConfirm(
        `Archive ${id}? They will no longer be able to log in.`,
        "Archive cashier"
      );
      if (!yes) return;
      const undo = patchRow(c.id, {}, true);
      try { await archiveCashier(c.id); done(c.id); load(); }
      catch (err) { undo(); setMsg(err.message); }
    };
    act.appendChild(a);
  }
  if (c.role !== "admin" && c.status === "archived") {
    const u = document.createElement("button");
    u.textContent = "Unarchive";
    u.className = "rowbtn go";
    u.onclick = async () => {
      if (busy(c.id)) return;
      const yes = await dashConfirm(
        `Unarchive ${id}? They will be able to log in again.`,
        "Unarchive cashier"
      );
      if (!yes) return;
      const undo = patchRow(c.id, {}, true);
      try { await unarchiveCashier(c.id); done(c.id); load(); }
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
  const shown = list.filter((c) =>
    !q || `${c.email || ""} ${c.username || ""} ${c.displayName || ""}`.toLowerCase().includes(q));
  for (const c of shown) tb.appendChild(row(c));
  return shown.length;
}

async function load() {
  const msg = document.getElementById("msg");
  msg.textContent = "Loading...";
  document.getElementById("tblHead").innerHTML = tab === "invites"
    ? `<tr><th>Email</th><th>Status</th><th>Invited</th><th>Actions</th></tr>`
    : `<tr><th>Email / Username</th><th>Status</th><th>Name</th><th>Schedule</th><th>Actions</th></tr>`;
  try {
    if (tab === "invites") { await loadInvites(); return; }
    const list = (await listCashiers(tab === "archived" ? "archived" : "active", "cashier")).cashiers;
    lastRows = list;
    const n = paint(list);
    msg.textContent = `${n} shown (${tab}).`;
  } catch (e) { msg.textContent = e.message; }
}

// --- Cashier invitations (admin invites by email; holder registers) ---
function invRow(v) {
  const tr = document.createElement("tr");
  const when = v.createdAt ? new Date(v.createdAt).toLocaleString() : "";
  tr.innerHTML =
    `<td>${v.email}</td><td><span class="badge ${v.status}">${v.status}</span></td>` +
    `<td>${when}</td><td></td>`;
  const act = tr.lastChild;
  if (v.status === "pending") {
    const r = document.createElement("button");
    r.textContent = "Resend";
    r.className = "rowbtn";
    r.onclick = async () => {
      try {
        const data = await createInvite(v.email);
        try { await navigator.clipboard.writeText(data.link); } catch { /* clipboard unavailable */ }
        setMsg(`New link mailed to ${v.email} (old one dead) — also copied to clipboard.`);
        load();
      } catch (e) { setMsg(e.message); }
    };
    act.appendChild(r);
    const x = document.createElement("button");
    x.textContent = "Revoke";
    x.className = "rowbtn danger";
    x.onclick = async () => {
      const yes = await dashConfirm(`Revoke the invitation for ${v.email}?`, "Revoke invitation");
      if (!yes) return;
      try { await revokeInvite(v.id); load(); }
      catch (e) { setMsg(e.message); }
    };
    act.appendChild(x);
  }
  return tr;
}

async function loadInvites() {
  const { invitations } = await listInvites();
  const tb = document.querySelector("#tbl tbody");
  tb.innerHTML = "";
  const q = (document.getElementById("q").value || "").toLowerCase();
  let n = 0;
  for (const v of invitations) {
    if (q && !v.email.toLowerCase().includes(q)) continue;
    tb.appendChild(invRow(v));
    n++;
  }
  setMsg(`${n} shown (invites).`);
}

document.getElementById("invite").addEventListener("click", async () => {
  const email = await dashPrompt(
    "Type the applicant's email. They receive a single-use link, valid 24 hours.",
    "Cashier email", "", "Invite Cashier"
  );
  if (email === null || email.trim() === "") return;
  try {
    const data = await createInvite(email.trim());
    try { await navigator.clipboard.writeText(data.link); } catch { /* clipboard unavailable */ }
    setMsg(`Invitation mailed to ${data.email} — link also copied to clipboard.`);
    if (tab === "invites") load();
  } catch (e) { setMsg(e.message); }
});

document.querySelectorAll("[data-t]").forEach((b) =>
  b.addEventListener("click", () => {
    tab = b.dataset.t;
    document.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x === b));
    load();
  }));
document.getElementById("q").addEventListener("input", () => {
  if (!lastRows.length) return;
  const n = paint(lastRows);
  document.getElementById("msg").textContent = `${n} shown (${tab}).`;
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
