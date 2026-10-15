// src/function/shared/receipt.js - receipt PDF preview + download (Sprint 3, CA-025).
// Query ?ref=GH-... (+ &admin=1 for the admin twin endpoint). Guard: any
// logged-in staff stays; guests go to login. PDF = jsPDF (vendored UMD) ->
// in-page iframe preview + Download button. No window.print().
function peso(n) {
  return `₱${Number(n || 0).toFixed(2)}`;
}

// jsPDF built-in Helvetica has no peso glyph, so PDF uses PHP prefix.
function php(n) {
  return `PHP ${Number(n || 0).toFixed(2)}`;
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
  const rows = [
    ["Table", String(t.tableName || "-")],
    ["Customer", String(t.customerName || "-")],
    ["Cashier", String(t.cashierName || "-")],
    ["Paid at", paid],
    ["Time played", `${t.minutes || 0} min`],
    ["Rate", `${php(t.pricePerHour)}/hr`],
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

  y += 2;
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
    msg.textContent = "Loading...";
    const { transaction: t } = await getTransaction(ref, asAdmin);
    document.getElementById("rRef").textContent = t.ref || ref;
    document.getElementById("rTable").textContent = t.tableName || "—";
    document.getElementById("rCustomer").textContent = t.customerName || "—";
    document.getElementById("rCashier").textContent = t.cashierName || "—";
    const paid = t.paidAt ? new Date(t.paidAt).toLocaleString() : "—";
    document.getElementById("rPaid").textContent = paid;
    document.getElementById("rMinutes").textContent = `${t.minutes || 0} min`;
    document.getElementById("rRate").textContent = `${peso(t.pricePerHour)}/hr`;
    document.getElementById("rMethod").textContent = t.method || "—";
    document.getElementById("rReceived").textContent = peso(t.received);
    document.getElementById("rTotal").textContent = peso(t.total);
    document.getElementById("rChange").textContent = peso(t.change);
    document.getElementById("rTbl").hidden = false;
    document.title = `Receipt ${t.ref} — GameHub`;

    if (!window.jspdf || !window.jspdf.jsPDF) {
      msg.textContent = "PDF library failed to load (js/vendor/jspdf.umd.min.js). Details above still valid.";
      return;
    }
    lastDoc = buildPdf(t, ref);
    lastRef = safeRef(t.ref || ref);
    msg.textContent = "";
    showPreview();
  } catch (e) {
    msg.textContent = e.message;
  }
})();

document.getElementById("download").addEventListener("click", () => {
  if (!lastDoc) return;
  lastDoc.save(`Receipt-${lastRef || "receipt"}.pdf`);
});
document.getElementById("back").addEventListener("click", () => history.back());
