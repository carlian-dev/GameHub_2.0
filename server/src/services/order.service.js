// Order service — F&B lines attached to an open session bill (Sprint 5).
// CA-020/026/027/028: one line per product per session, price snapshot at
// first add, merge repeated adds, quantity 1-99, edits only while the bill is
// unfinalized (no transaction and no payment lock).
import { ObjectId } from "mongodb";
import { round2 } from "../utils/numbers.js";
import {
  fnbItems,
  fnbTotalOf,
  sessionCharge,
} from "../utils/billing.js";

const MAX_QTY = 99;
const MAX_FNB_TOTAL = 1000000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isHexId(value) {
  return /^[0-9a-fA-F]{24}$/.test(String(value ?? ""));
}

function actorIdOf(actor) {
  return actor && actor.id ? String(actor.id) : "system";
}

function parseQty(raw) {
  if (typeof raw === "boolean" || raw == null || raw === "") {
    throw httpError(422, "quantity must be a whole number from 1 to 99");
  }
  const qty = Number(raw);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    throw httpError(422, "quantity must be a whole number from 1 to 99");
  }
  return qty;
}

/** Bill lines for the UI: shared snapshot shape plus the embedded line id. */
function billItems(doc) {
  const items = fnbItems(doc);
  const lines = Array.isArray(doc && doc.fnbOrders) ? doc.fnbOrders : [];
  return items.map((item, i) => ({
    id: lines[i] && lines[i]._id != null ? String(lines[i]._id) : null,
    ...item,
  }));
}

function sessionShape(doc, { finalized = false, paidRef = null } = {}) {
  return {
    id: doc._id != null ? String(doc._id) : null,
    tableId: doc.tableId != null ? String(doc.tableId) : null,
    tableName: doc.tableName ?? "",
    customerName: doc.customerName ?? "",
    cashierId: doc.cashierId != null ? String(doc.cashierId) : null,
    cashierName: doc.cashierName ?? "",
    startTime: doc.startTime instanceof Date ? doc.startTime.toISOString() : null,
    endTime: doc.endTime instanceof Date ? doc.endTime.toISOString() : null,
    closedAt: doc.closedAt instanceof Date ? doc.closedAt.toISOString() : null,
    plannedMinutes: doc.plannedMinutes ?? 0,
    status: doc.status ?? "",
    pricePerHour: doc.pricePerHour != null ? doc.pricePerHour : null,
    rateType: doc.rateType ?? null,
    fnbLineCount: Array.isArray(doc.fnbOrders) ? doc.fnbOrders.length : 0,
    fnbTotal: fnbTotalOf(doc),
    finalized: !!finalized,
    paidRef: paidRef ?? null,
  };
}

export function orderService({
  sessionModel,
  productModel,
  transactionModel,
  sessionService,
  db,
}) {
  const sessionsColl = db.collection("sessions");
  const transactionsColl = db.collection("transactions");
  const activityLogs = db.collection("activityLogs");

  async function sweepExpired() {
    try {
      if (sessionService && typeof sessionService.autoEndExpired === "function") {
        await sessionService.autoEndExpired();
      }
    } catch {
      // The order read/write below will surface a real DB failure.
    }
  }

  async function loadSession(sessionId) {
    if (!isHexId(sessionId)) {
      throw httpError(422, "invalid session id");
    }
    await sweepExpired();
    const doc = await sessionModel.findById(sessionId);
    if (!doc) throw httpError(404, "session not found");
    return doc;
  }

  async function paidTransaction(sessionOid) {
    return await transactionsColl.findOne(
      { sessionId: sessionOid },
      { projection: { ref: 1 } }
    );
  }

  /**
   * Reject edits on finalized/cancelled sessions and on a bill whose payment
   * has already acquired the lock. Order matters: paid wins over cancelled.
   */
  async function assertEditable(doc) {
    const paid = await paidTransaction(doc._id);
    if (paid) throw httpError(409, "bill already paid");
    if (doc.status === "cancelled") {
      throw httpError(422, "session is cancelled");
    }
    if (doc.status !== "active" && doc.status !== "closed") {
      throw httpError(422, `session is ${doc.status || "not billable"}`);
    }
    if (doc.billingLocked) {
      throw httpError(409, "payment is in progress, try again");
    }
  }

  async function log(action, target, context) {
    await activityLogs.insertOne({
      actorId: context.actorId,
      action,
      target: String(target),
      ...context.fields,
      at: new Date(),
    });
  }

  async function billFor(sessionId) {
    const doc = await loadSession(sessionId);
    const paid = await paidTransaction(doc._id);
    const finalized = !!paid;
    const items = billItems(doc);
    const fnbTotal = fnbTotalOf(doc);
    const closed = doc.status === "closed";
    const sessionTotal = closed ? sessionCharge(doc) : null;
    const total = closed ? round2(sessionTotal + fnbTotal) : null;
    return {
      ok: true,
      bill: {
        session: sessionShape(doc, {
          finalized,
          paidRef: paid ? paid.ref ?? null : null,
        }),
        items,
        fnbTotal,
        sessionTotal,
        total,
      },
    };
  }

  return {
    /** GET /api/cashier/sessions/{id}/bill — read-only summary. */
    async bill(sessionId) {
      return await billFor(sessionId);
    },

    /** POST /api/cashier/sessions/{id}/orders — add/merge a product line. */
    async add(sessionId, { productId, qty } = {}, actor) {
      if (!isHexId(productId)) {
        throw httpError(422, "productId is required");
      }
      const amount = parseQty(qty);
      let doc = await loadSession(sessionId);
      await assertEditable(doc);

      const product = await productModel.findById(productId);
      if (!product) throw httpError(404, "product not found");
      if (product.archived) {
        throw httpError(409, "product is not available");
      }

      const sessionOid = doc._id;
      const productOid = new ObjectId(productId);

      for (let attempt = 0; attempt < 4; attempt++) {
        const line = (Array.isArray(doc.fnbOrders) ? doc.fnbOrders : []).find(
          (l) => String(l.productId) === String(productOid)
        );
        const now = new Date();
        const currentFnb = fnbTotalOf(doc);

        if (line) {
          const oldQty = Number(line.qty ?? 0);
          const newQty = oldQty + amount;
          if (newQty > MAX_QTY) {
            throw httpError(
              422,
              `quantity cannot exceed ${MAX_QTY} for one line`
            );
          }
          const newLineTotal = round2(Number(line.unitPrice ?? 0) * newQty);
          const projected = round2(
            currentFnb - Number(line.lineTotal ?? 0) + newLineTotal
          );
          if (projected > MAX_FNB_TOTAL) {
            throw httpError(422, "F&B subtotal cannot exceed 1000000");
          }
          const res = await sessionsColl.updateOne(
            {
              _id: sessionOid,
              status: { $in: ["active", "closed"] },
              billingLocked: { $ne: true },
              fnbOrders: {
                $elemMatch: { _id: line._id, qty: oldQty },
              },
            },
            {
              $set: {
                "fnbOrders.$.qty": newQty,
                "fnbOrders.$.lineTotal": newLineTotal,
                "fnbOrders.$.updatedAt": now,
                updatedAt: now,
              },
            }
          );
          if (res.modifiedCount === 1) {
            await log("fnb_order_add", sessionOid, {
              actorId: actorIdOf(actor),
              fields: {
                lineId: String(line._id),
                productId: String(productOid),
                productName: line.name ?? product.name ?? "",
                qty: amount,
                resultingQty: newQty,
                unitPrice: round2(Number(line.unitPrice ?? 0)),
                lineTotal: newLineTotal,
                merged: true,
              },
            });
            return await billFor(sessionOid);
          }
        } else {
          const unitPrice = round2(Number(product.price ?? 0));
          const lineTotal = round2(unitPrice * amount);
          if (round2(currentFnb + lineTotal) > MAX_FNB_TOTAL) {
            throw httpError(422, "F&B subtotal cannot exceed 1000000");
          }
          const newLine = {
            _id: new ObjectId(),
            productId: productOid,
            name: product.name ?? "",
            category: product.category ?? "other",
            unitPrice,
            qty: amount,
            lineTotal,
            addedBy: actorIdOf(actor),
            addedAt: now,
            updatedAt: now,
          };
          const res = await sessionsColl.updateOne(
            {
              _id: sessionOid,
              status: { $in: ["active", "closed"] },
              billingLocked: { $ne: true },
              "fnbOrders.productId": { $ne: productOid },
            },
            {
              $push: { fnbOrders: newLine },
              $set: { updatedAt: now },
            }
          );
          if (res.modifiedCount === 1) {
            await log("fnb_order_add", sessionOid, {
              actorId: actorIdOf(actor),
              fields: {
                lineId: String(newLine._id),
                productId: String(productOid),
                productName: newLine.name,
                qty: amount,
                unitPrice,
                lineTotal,
                merged: false,
              },
            });
            return await billFor(sessionOid);
          }
        }

        // The session changed between read and write (concurrent add, payment
        // or status change). Re-read and retry against the fresh document.
        doc = await loadSession(sessionOid);
        await assertEditable(doc);
      }

      throw httpError(409, "could not update the order, try again");
    },

    /** PUT /api/cashier/sessions/{id}/orders/{lineId} — quantity only. */
    async update(sessionId, lineId, { qty } = {}, actor) {
      const amount = parseQty(qty);
      if (!isHexId(lineId)) {
        throw httpError(404, "order line not found");
      }
      let doc = await loadSession(sessionId);
      await assertEditable(doc);

      for (let attempt = 0; attempt < 4; attempt++) {
        const line = (Array.isArray(doc.fnbOrders) ? doc.fnbOrders : []).find(
          (l) => String(l._id) === String(lineId)
        );
        if (!line) throw httpError(404, "order line not found");
        const oldQty = Number(line.qty ?? 0);
        const newLineTotal = round2(Number(line.unitPrice ?? 0) * amount);
        const projected = round2(
          fnbTotalOf(doc) - Number(line.lineTotal ?? 0) + newLineTotal
        );
        if (projected > MAX_FNB_TOTAL) {
          throw httpError(422, "F&B subtotal cannot exceed 1000000");
        }
        const now = new Date();
        const res = await sessionsColl.updateOne(
          {
            _id: doc._id,
            status: { $in: ["active", "closed"] },
            billingLocked: { $ne: true },
            fnbOrders: {
              $elemMatch: { _id: line._id, qty: oldQty },
            },
          },
          {
            $set: {
              "fnbOrders.$.qty": amount,
              "fnbOrders.$.lineTotal": newLineTotal,
              "fnbOrders.$.updatedAt": now,
              updatedAt: now,
            },
          }
        );
        if (res.modifiedCount === 1) {
          await log("fnb_order_update", doc._id, {
            actorId: actorIdOf(actor),
            fields: {
              lineId: String(line._id),
              productId: line.productId != null ? String(line.productId) : null,
              productName: line.name ?? "",
              oldQty,
              newQty: amount,
              unitPrice: round2(Number(line.unitPrice ?? 0)),
              lineTotal: newLineTotal,
            },
          });
          return await billFor(doc._id);
        }
        doc = await loadSession(sessionId);
        await assertEditable(doc);
      }

      throw httpError(409, "could not update the order, try again");
    },

    /** DELETE /api/cashier/sessions/{id}/orders/{lineId} */
    async remove(sessionId, lineId, actor) {
      if (!isHexId(lineId)) {
        throw httpError(404, "order line not found");
      }
      let doc = await loadSession(sessionId);
      await assertEditable(doc);

      for (let attempt = 0; attempt < 4; attempt++) {
        const line = (Array.isArray(doc.fnbOrders) ? doc.fnbOrders : []).find(
          (l) => String(l._id) === String(lineId)
        );
        if (!line) throw httpError(404, "order line not found");
        const now = new Date();
        const res = await sessionsColl.updateOne(
          {
            _id: doc._id,
            status: { $in: ["active", "closed"] },
            billingLocked: { $ne: true },
            "fnbOrders._id": line._id,
          },
          {
            $pull: { fnbOrders: { _id: line._id } },
            $set: { updatedAt: now },
          }
        );
        if (res.modifiedCount === 1) {
          await log("fnb_order_remove", doc._id, {
            actorId: actorIdOf(actor),
            fields: {
              lineId: String(line._id),
              productId: line.productId != null ? String(line.productId) : null,
              productName: line.name ?? "",
              qty: Number(line.qty ?? 0),
              unitPrice: round2(Number(line.unitPrice ?? 0)),
              lineTotal: round2(Number(line.lineTotal ?? 0)),
            },
          });
          return await billFor(doc._id);
        }
        doc = await loadSession(sessionId);
        await assertEditable(doc);
      }

      throw httpError(409, "could not update the order, try again");
    },
  };
}
