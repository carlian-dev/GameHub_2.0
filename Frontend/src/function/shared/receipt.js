// src/function/shared/receipt.js - receipt PDF preview + download (Sprint 3,
// CA-025; itemized F&B lines in Sprint 5). Query ?ref=GH-... (+ &admin=1 for
// the admin twin endpoint). Guard: any logged-in staff stays; guests go to
// login. PDF = jsPDF (vendored UMD) -> in-page iframe preview + Download
// button. No window.print(). Item tables paginate onto a new page when needed;
// legacy transactions with no F&B data render exactly like Sprint 3.
function peso(n) {
  return `₱${Number(n || 0).toFixed(2)}`;
}

// jsPDF built-in Helvetica has no peso glyph, so PDF uses PHP prefix.
function php(n) {
  return `PHP ${Number(n || 0).toFixed(2)}`;
}

function clipText(value, max) {
  const text = String(value == null ? "" : value);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

let lastDoc = null;
let lastRef = "";
let lastUrl = "";

function safeRef(ref) {
  const s = String(ref || "receipt").replace(/[^A-Za-z0-9-_]/g, "");
  return s || "receipt";
}

function buildPdf(t, ref) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const LEFT = 15;
  const RIGHT = 195;
  const items = Array.isArray(t.items) ? t.items : [];
  const fnbTotal = Number(t.fnbTotal || 0);
  const hasFnb = items.length > 0 || fnbTotal > 0;
  const sessionTotal = t.sessionTotal != null ? t.sessionTotal : t.total;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(20, 20, 20);
  doc.text("GameHub", LEFT, 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text("Billiard hall receipt", LEFT, 27);
  doc.text(`Ref: ${t.ref || ref}`, LEFT, 32);

  doc.setDrawColor(180, 180, 180);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(LEFT, 36, RIGHT, 36);
  doc.setLineDashPattern([], 0);

  const paid = t.paidAt ? new Date(t.paidAt).toLocaleString() : "-";
  const billedHrs = Number(t.billedHours || 0) > 0
    ? Number(t.billedHours)
    : Math.max(1, Math.ceil(Number(t.minutes || 0) / 60));
  const rateLabel = t.rateType ? `${php(t.pricePerHour)}/hr (${t.rateType})` : `${php(t.pricePerHour)}/hr`;
  const rows = [
    ["Table", String(t.tableName || "-")],
    ["Customer", String(t.customerName || "-")],
    ["Cashier", String(t.cashierName || "-")],
    ["Paid at", paid],
    ["Time played", `${t.minutes || 0} min`],
    ["Billed", `${billedHrs} hr`],
    ["Rate", rateLabel],
    ["Method", String(t.method || "-")],
    ["Received", php(t.received)],
  ];

  let y = 44;
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "normal");
    doc.text(label, LEFT, y);
    doc.text(value, RIGHT, y, { align: "right" });
    doc.setDrawColor(210, 210, 210);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(LEFT, y + 2, RIGHT, y + 2);
    doc.setLineDashPattern([], 0);
    y += 8;
  }

  // Continue long receipts on a fresh page with a small running header.
  const newPage = (heading) => {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(70, 70, 70);
    doc.text(heading, LEFT, 16);
    doc.setDrawColor(190, 190, 190);
    doc.line(LEFT, 19, RIGHT, 19);
    return 28;
  };

  const itemHeader = (at) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text("ITEM", LEFT, at);
    doc.text("QTY", 125, at, { align: "right" });
    doc.text("UNIT", 165, at, { align: "right" });
    doc.text("LINE", RIGHT, at, { align: "right" });
    doc.setDrawColor(200, 200, 200);
    doc.line(LEFT, at + 2, RIGHT, at + 2);
    doc.setTextColor(30, 30, 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    return at + 8;
  };

  if (hasFnb) {
    y += 4;
    if (y > 240) y = newPage("GameHub - receipt (continued)");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.text("Food & beverage", LEFT, y);
    y += 7;
    y = itemHeader(y);

    for (const item of items) {
      if (y > 260) {
        y = newPage("GameHub - F&B items (continued)");
        y = itemHeader(y);
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.setTextColor(30, 30, 30);
      doc.text(clipText(item.name, 46), LEFT, y);
      doc.text(String(item.qty != null ? item.qty : 0), 125, y, { align: "right" });
      doc.text(php(item.unitPrice), 165, y, { align: "right" });
      doc.text(php(item.lineTotal), RIGHT, y, { align: "right" });
      y += 6.5;
    }

    if (y > 240) y = newPage("GameHub - receipt (continued)");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    doc.text("Session charge", LEFT, y);
    doc.text(php(sessionTotal), RIGHT, y, { align: "right" });
    y += 7.5;
    doc.text("F&B subtotal", LEFT, y);
    doc.text(php(fnbTotal), RIGHT, y, { align: "right" });
    y += 8;
  }

  y += 2;
  if (y > 258) y = newPage("GameHub - receipt (continued)");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(10, 10, 10);
  doc.text("Total", LEFT, y);
  doc.text(php(t.total), RIGHT, y, { align: "right" });
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Change", LEFT, y);
  doc.text(php(t.change), RIGHT, y, { align: "right" });
  y += 12;

  if (y > 270) y = newPage("GameHub - receipt (continued)");
  doc.setDrawColor(180, 180, 180);
  doc.line(LEFT, y, RIGHT, y);
  y += 8;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text("Thank you for playing at GameHub!", 105, y, { align: "center" });

  return doc;
}

function showPreview() {
  const frame = document.getElementById("pdfPreview");
  const btn = document.getElementById("download");
  if (!lastDoc) {
    btn.disabled = true;
    return;
  }
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = lastDoc.output("bloburl");
  // bloburl is a string in 2.5.1; guard for older object form.
  frame.src = typeof lastUrl === "string" ? lastUrl : String(lastUrl.url || lastUrl);
  btn.disabled = false;
}

(async () => {
  const msg = document.getElementById("msg");
  const q = new URLSearchParams(location.search);
  const ref = (q.get("ref") || "").trim();
  const asAdmin = q.get("admin") === "1";
  if (!ref) {
    msg.textContent = "Missing ?ref=GH-... in the URL.";
    return;
  }
  try {
    await getMe();
  } catch {
    location.href = "../auth/login.html";
    return;
  }
  try {
    msg.textContent = "Loading…";
    msg.className = "dash-msg loading";
    const { transaction: t } = await getTransaction(ref, asAdmin);
    document.getElementById("rRef").textContent = t.ref || ref;
    document.getElementById("rTable").textContent = t.tableName || "—";
    document.getElementById("rCustomer").textContent = t.customerName || "—";
    document.getElementById("rCashier").textContent = t.cashierName || "—";
    const paid = t.paidAt ? new Date(t.paidAt).toLocaleString() : "—";
    document.getElementById("rPaid").textContent = paid;
    document.getElementById("rMinutes").textContent = `${t.minutes || 0} min`;
    const billedElm = Number(t.billedHours || 0) > 0
      ? Number(t.billedHours)
      : Math.max(1, Math.ceil(Number(t.minutes || 0) / 60));
    document.getElementById("rBilled").textContent = `${billedElm} hr`;
    document.getElementById("rRate").textContent = t.rateType
      ? `${peso(t.pricePerHour)}/hr (${t.rateType})`
      : `${peso(t.pricePerHour)}/hr`;
    document.getElementById("rMethod").textContent = t.method || "—";
    document.getElementById("rReceived").textContent = peso(t.received);

    const items = Array.isArray(t.items) ? t.items : [];
    const fnbTotal = Number(t.fnbTotal || 0);
    const hasFnb = items.length > 0 || fnbTotal > 0;
    const itemBody = document.querySelector("#rItems tbody");
    itemBody.innerHTML = "";
    for (const item of items) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td></td><td></td><td></td><td></td>";
      tr.children[0].textContent = item.name || "Item";
      tr.children[1].textContent = String(item.qty != null ? item.qty : 0);
      tr.children[2].textContent = peso(item.unitPrice);
      tr.children[3].textContent = peso(item.lineTotal);
      itemBody.appendChild(tr);
    }
    document.getElementById("rItemsWrap").hidden = items.length === 0;
    document.getElementById("rSessionRow").hidden = !hasFnb;
    document.getElementById("rFnbRow").hidden = !(fnbTotal > 0);
    document.getElementById("rSession").textContent = peso(
      t.sessionTotal != null ? t.sessionTotal : t.total
    );
    document.getElementById("rFnb").textContent = peso(fnbTotal);
    document.getElementById("rTotal").textContent = peso(t.total);
    document.getElementById("rChange").textContent = peso(t.change);
    document.getElementById("rTotals").hidden = false;
    document.getElementById("rTbl").hidden = false;
    document.title = `Receipt ${t.ref} — GameHub`;

    if (!window.jspdf || !window.jspdf.jsPDF) {
      msg.textContent = "PDF library failed to load (js/vendor/jspdf.umd.min.js). Details above still valid.";
      msg.className = "dash-msg err";
      return;
    }
    lastDoc = buildPdf(t, ref);
    lastRef = safeRef(t.ref || ref);
    msg.textContent = "";
    msg.className = "dash-msg";
    showPreview();
  } catch (e) {
    msg.textContent = e.message;
    msg.className = "dash-msg err";
  }
})();

document.getElementById("download").addEventListener("click", () => {
  if (!lastDoc) return;
  const file = `Receipt-${lastRef || "receipt"}.pdf`;
  lastDoc.save(file);
  dashToast(`${file} saved to your downloads.`, "ok", { title: "Receipt downloaded" });
});
document.getElementById("back").addEventListener("click", () => history.back());
