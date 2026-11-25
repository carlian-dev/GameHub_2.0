// src/function/admin/cashiers.js - Staff table logic in the dashboard shell.
// Pair: cashiers.html <-> server/src/routes/admin.routes.js.
// Tabs: active / archived (cashiers via listCashiers) + invites (ARIA tabs via
// dashTabsInit). Invite IS the approval — new accounts arrive active.
// Search box filters loaded rows locally. Archive is one step (confirm only).
// Admin rows are protected (never archived).
//
// Optimistic updates: mutations flip their row instantly from the lastRows
// cache (patchRow) and reconcile when the server answers — success converges
// with a quiet reload + toast, failure restores the snapshot + error toast.
// Rows with in-flight requests render dimmed and ignore clicks.
// All user/server strings are written with textContent (never interpolated
// into innerHTML).
let tab = "cashiers";
let lastRows = [];
const pendingIds = new Set();

function setMsg(t, kind = "") {
  const el = document.getElementById("msg");
  el.textContent = t;
  el.className = `dash-msg${kind ? " " + kind : ""}`;
}
function setStamp() { dashStamp(document.getElementById("stamp")); }
function setEmpty(show, text) {
  const el = document.getElementById("empty");
  if (text) el.textContent = text;
  el.hidden = !show;
}
function countMsg(n) {
  if (tab === "invites") {
    return `Showing ${n} invitation${n === 1 ? "" : "s"}.`;
  }
  if (tab === "admins") {
    return `Showing ${n} administrator${n === 1 ? "" : "s"}.`;
  }
  if (tab === "archived") {
    return `Showing ${n} archived account${n === 1 ? "" : "s"}.`;
  }
  return `Showing ${n} cashier${n === 1 ? "" : "s"}.`;
}

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
  const n = paint(lastRows);
  setMsg(countMsg(n));
  setEmpty(n === 0, "No staff match your search.");
}

function busy(id) { return pendingIds.has(id); }
function done(id) { pendingIds.delete(id); }

async function guard() {
  try {
    const me = await getMe();
    if (me.role !== "admin") { location.href = staffHome(me.role); return null; }
    const name = me.displayName || me.email || me.username || "admin";
    document.getElementById("who").textContent = name;
    dashRenderAvatar("avatar", { name, avatarUrl: me.avatarUrl, fallbackLetter: "A" });
    return me;
  } catch { location.href = "../auth/login.html"; return null; }
}

function cell(tr, i, text) {
  tr.children[i].textContent = text == null ? "" : String(text);
}

function row(c) {
  const tr = document.createElement("tr");
  if (c.status === "archived" || busy(c.id)) tr.classList.add("dim");
  const isAdm = c.role === "admin";
  const badge = isAdm ? " (admin)" : "";

  if (tab === "admins") {
    tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td>";
    cell(tr, 0, c.email || c.username || "—");

    const roleTd = tr.children[1];
    const rb = document.createElement("span");
    rb.className = "badge admin";
    rb.textContent = "Administrator";
    roleTd.appendChild(rb);

    const statusTd = tr.children[2];
    const b = document.createElement("span");
    b.className = `badge ${c.status}`;
    b.textContent = c.status;
    statusTd.appendChild(b);

    cell(tr, 3, `${c.displayName || ""}${badge}`);
    const act = tr.children[4];

    const e = document.createElement("button");
    e.textContent = "Edit";
    e.className = "rowbtn";
    e.onclick = async () => {
      if (busy(c.id)) return;
      const r = await dashEditCashier({
        message: "Update administrator display name.",
        displayName: c.displayName || "",
        schedule: "",
        title: "Edit administrator",
      });
      if (r === null) return;
      const undo = patchRow(c.id, { displayName: r.displayName });
      try {
        await updateCashier(c.id, { displayName: r.displayName, version: c.version });
        done(c.id);
        load();
        dashToast(`${c.username || c.email} updated.`, "ok", { title: "Saved" });
      } catch (err) {
        undo();
        if (err.status === 409) load();
        setMsg(err.message, "err");
        dashToast(err.message, "err", { title: "Update failed" });
      }
    };
    act.appendChild(e);
    return tr;
  }

  tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td><td></td>";
  cell(tr, 0, c.email || c.username || "—");

  const roleTd = tr.children[1];
  const rb = document.createElement("span");
  rb.className = `badge ${isAdm ? "admin" : "cashier"}`;
  rb.textContent = isAdm ? "Administrator" : "Cashier";
  roleTd.appendChild(rb);

  const statusTd = tr.children[2];
  const b = document.createElement("span");
  b.className = `badge ${c.status}`;
  b.textContent = c.status;
  statusTd.appendChild(b);

  cell(tr, 3, `${c.displayName || ""}${badge}`);
  cell(tr, 4, c.schedule || (isAdm ? "—" : ""));
  const act = tr.children[5];

  const e = document.createElement("button");
  e.textContent = "Edit";
  e.className = "rowbtn";
  e.onclick = async () => {
    if (busy(c.id)) return;
    const r = await dashEditCashier({
      message: isAdm ? "Update administrator display name." : "Update this cashier account. Pick shift times below.",
      displayName: c.displayName || "",
      schedule: isAdm ? "" : (c.schedule || ""),
      title: isAdm ? "Edit administrator" : "Edit cashier",
    });
    if (r === null) return;
    const undo = patchRow(c.id, { displayName: r.displayName, schedule: isAdm ? "" : r.schedule });
    try {
      await updateCashier(c.id, { displayName: r.displayName, schedule: isAdm ? "" : r.schedule, version: c.version });
      done(c.id);
      load();
      dashToast(`${c.username || c.email} updated.`, "ok", { title: "Saved" });
    } catch (err) {
      undo();
      if (err.status === 409) load();
      setMsg(err.message, "err");
      dashToast(err.message, "err", { title: "Update failed" });
    }
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
        `Archive ${c.email || c.username}? They will no longer be able to log in.`,
        "Archive cashier"
      );
      if (!yes) return;
      const undo = patchRow(c.id, {}, true);
      try {
        await archiveCashier(c.id);
        done(c.id);
        load();
        dashToast(`${c.username || c.email} can no longer log in.`, "ok", { title: "Archived" });
      } catch (err) { undo(); setMsg(err.message, "err"); dashToast(err.message, "err", { title: "Archive failed" }); }
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
        `Unarchive ${c.email || c.username}? They will be able to log in again.`,
        "Unarchive cashier"
      );
      if (!yes) return;
      const undo = patchRow(c.id, {}, true);
      try {
        await unarchiveCashier(c.id);
        done(c.id);
        load();
        dashToast(`${c.username || c.email} can log in again.`, "ok", { title: "Unarchived" });
      } catch (err) { undo(); setMsg(err.message, "err"); dashToast(err.message, "err", { title: "Unarchive failed" }); }
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
  msg.textContent = "Loading…";
  msg.className = "dash-msg loading";
  setStamp();
  if (tab === "invites") {
    document.getElementById("tblHead").innerHTML = "<tr><th>Email</th><th>Role</th><th>Status</th><th>Invited</th><th>Actions</th></tr>";
  } else if (tab === "admins") {
    document.getElementById("tblHead").innerHTML = "<tr><th>Email / Username</th><th>Role</th><th>Status</th><th>Name</th><th>Actions</th></tr>";
  } else {
    document.getElementById("tblHead").innerHTML = "<tr><th>Email / Username</th><th>Role</th><th>Status</th><th>Name</th><th>Schedule</th><th>Actions</th></tr>";
  }
  if (tab !== "invites") dashSkeleton(document.querySelector("#tbl tbody"), 5, 4);
  try {
    if (tab === "invites") { await loadInvites(); return; }
    let roleFilter = "all";
    let statusFilter = "active";
    if (tab === "admins") {
      roleFilter = "admin";
      statusFilter = "active";
    } else if (tab === "cashiers") {
      roleFilter = "cashier";
      statusFilter = "active";
    } else if (tab === "archived") {
      roleFilter = "all";
      statusFilter = "archived";
    }
    const list = (await listCashiers(statusFilter, roleFilter)).cashiers;
    lastRows = list;
    const n = paint(list);
    setMsg(countMsg(n));
    setEmpty(n === 0, tab === "admins" ? "No administrators found. Use “Invite co-admin” to invite one." : tab === "cashiers" ? "No cashiers found. Use “Invite cashier” to invite one." : "No accounts in this view yet.");
  } catch (e) {
    setMsg(e.message, "err");
    setEmpty(true, "Couldn't load staff — refresh to retry.");
  }
}

// --- Staff invitations (admin invites by email; holder registers) ---
function invRow(v) {
  const tr = document.createElement("tr");
  const when = v.createdAt ? new Date(v.createdAt).toLocaleString() : "";
  const roleName = v.role === "admin" ? "Co-Admin" : "Cashier";
  tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td>";
  cell(tr, 0, v.email);

  const roleTd = tr.children[1];
  const rb = document.createElement("span");
  rb.className = `badge ${v.role === "admin" ? "admin" : "cashier"}`;
  rb.textContent = roleName;
  roleTd.appendChild(rb);

  const statusTd = tr.children[2];
  const b = document.createElement("span");
  b.className = `badge ${v.status}`;
  b.textContent = v.status;
  statusTd.appendChild(b);

  cell(tr, 3, when);
  const act = tr.children[4];
  if (v.status === "pending") {
    const r = document.createElement("button");
    r.textContent = "Resend";
    r.className = "rowbtn";
    r.onclick = async () => {
      r.disabled = true;
      try {
        const data = await createInvite(v.email, v.role || "cashier");
        try { await navigator.clipboard.writeText(data.link); } catch { /* clipboard unavailable */ }
        setMsg(`New link mailed to ${v.email} (old one dead) — also copied to clipboard.`);
        dashToast(`New invitation link copied for ${data.email}.`, "ok", { title: "Invitation resent" });
        load();
      } catch (e) { setMsg(e.message, "err"); dashToast(e.message, "err", { title: "Resend failed" }); }
      finally { r.disabled = false; }
    };
    act.appendChild(r);
    const x = document.createElement("button");
    x.textContent = "Revoke";
    x.className = "rowbtn danger";
    x.onclick = async () => {
      const yes = await dashConfirm(`Revoke the invitation for ${v.email}?`, "Revoke invitation");
      if (!yes) return;
      try {
        await revokeInvite(v.id);
        load();
        dashToast(`Invitation for ${v.email} revoked.`, "ok", { title: "Revoked" });
      } catch (e) { setMsg(e.message, "err"); dashToast(e.message, "err", { title: "Revoke failed" }); }
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
  setMsg(countMsg(n));
  setEmpty(n === 0, "No invitations match. Use “Invite cashier” or “Invite co-admin” to send one.");
}

document.getElementById("invite").addEventListener("click", async () => {
  const email = await dashPrompt(
    "Type the cashier applicant's email. They receive a single-use link, valid 24 hours.",
    "Cashier email", "", "Invite Cashier"
  );
  if (email === null || email.trim() === "") return;
  const value = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    dashToast(`“${value}” doesn't look like an email address.`, "err", { title: "Invalid email" });
    return;
  }
  try {
    const data = await createInvite(value, "cashier");
    try { await navigator.clipboard.writeText(data.link); } catch { /* clipboard unavailable */ }
    setMsg(`Invitation mailed to ${data.email} — link also copied to clipboard.`);
    dashToast(`Single-use link copied for ${data.email} (valid 24h).`, "ok", { title: "Invitation sent" });
    if (tab === "invites") load();
  } catch (e) { setMsg(e.message, "err"); dashToast(e.message, "err", { title: "Invite failed" }); }
});

const inviteAdminBtn = document.getElementById("inviteAdmin");
if (inviteAdminBtn) {
  inviteAdminBtn.addEventListener("click", async () => {
    const email = await dashPrompt(
      "Type the co-admin's email. They receive a single-use link to set up their admin account, valid 24 hours.",
      "Co-admin email", "", "Invite Co-Admin"
    );
    if (email === null || email.trim() === "") return;
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      dashToast(`“${value}” doesn't look like an email address.`, "err", { title: "Invalid email" });
      return;
    }
    try {
      const data = await createInvite(value, "admin");
      try { await navigator.clipboard.writeText(data.link); } catch { /* clipboard unavailable */ }
      setMsg(`Co-admin invitation mailed to ${data.email} — link also copied to clipboard.`);
      dashToast(`Single-use link copied for ${data.email} (valid 24h).`, "ok", { title: "Co-admin invited" });
      if (tab === "invites") load();
    } catch (e) { setMsg(e.message, "err"); dashToast(e.message, "err", { title: "Invite failed" }); }
  });
}

// Accessible tab strip: click + arrow keys, aria-selected, tabpanel labelledby.
dashTabsInit((t) => { tab = t; load(); });
document.getElementById("q").addEventListener("input", () => {
  if (!lastRows.length) return;
  const n = paint(lastRows);
  setMsg(`${n} shown (${tab}).`);
  setEmpty(n === 0, "No staff match your search.");
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
