// Transaction service — billing + payment close-out.
// Sprint 3 flow extended with F&B (Sprint 5): one payment covers
// session charge + F&B subtotal, and the transaction stores item snapshots.
// Guards: closed session, one transaction per session (unique sessionId),
// short payment (422), duplicate payment (409), and a session-level billing
// lock so an order edit can never land after the total is computed.
//
// PayMongo (GCash hosted checkout) uses the same lock and transaction record:
// starting a checkout locks the bill, and the paid webhook/status poll calls
// recordPayment with provider "paymongo" and received = the locked total.
import { ObjectId } from "mongodb";
import { round2 } from "../utils/numbers.js";
import { billedHours, billTotals, fnbItems } from "../utils/billing.js";
import { paidPaymentId, paymentsHavePaid } from "./paymongo.service.js";

const REF_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_REF_RETRIES = 5;
const LOCK_STALE_MS = 5 * 60 * 1000;

function refOnce() {
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += REF_CHARS[Math.floor(Math.random() * 36)];
  }
  return `GH-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${suffix}`;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isHexId(value) {
  return /^[0-9a-fA-F]{24}$/.test(String(value ?? ""));
}

function actorName(sessionUser, usersColl) {
  const idRaw = sessionUser && sessionUser.id ? String(sessionUser.id) : "";
  if (idRaw && /^[0-9a-fA-F]{24}$/.test(idRaw)) {
    return usersColl
      .findOne({ _id: new ObjectId(idRaw) })
      .then((u) => {
        if (!u) return sessionUser.username ?? sessionUser.email ?? "cashier";
        const dn = String(u.displayName ?? "").trim();
        if (dn !== "") return dn;
        if (u.username) return String(u.username);
        if (u.email) return String(u.email);
        return sessionUser.username ?? sessionUser.email ?? "cashier";
      });
  }
  return Promise.resolve(
    sessionUser.username ?? sessionUser.email ?? "cashier"
  );
}

export function transactionService({
  transactionModel,
  sessionModel,
  sessionService,
  db,
  paymongoService = null,
}) {
  const sessionsColl = db.collection("sessions");
  const transactionsColl = db.collection("transactions");
  const usersColl = db.collection("users");
  const activityLogs = db.collection("activityLogs");

  async function releaseLock(oid) {
    await sessionsColl.updateOne(
      { _id: oid, paidTransactionRef: { $exists: false } },
      { $set: { billingLocked: false, billingLockedAt: null } }
    );
  }

  async function lockSession(oid, now) {
    const staleBefore = new Date(now.getTime() - LOCK_STALE_MS);
    return await sessionsColl.updateOne(
      {
        _id: oid,
        status: "closed",
        $or: [
          { billingLocked: { $ne: true } },
          { billingLockedAt: { $lt: staleBefore } },
        ],
      },
      { $set: { billingLocked: true, billingLockedAt: now } }
    );
  }

  async function explainLockFailure(oid) {
    const fresh = await sessionsColl.findOne({ _id: oid });
    if (!fresh) {
      throw httpError(404, "session not found");
    }
    if (fresh.status !== "closed") {
      throw httpError(422, "session must be closed before billing (end it first)");
    }
    const dup = await transactionsColl.findOne({ sessionId: oid });
    if (dup) {
      throw httpError(409, `session already billed (${dup.ref ?? "billed"})`);
    }
    throw httpError(409, "payment is in progress, try again");
  }

  async function autoEndExpired() {
    try {
      if (sessionService && typeof sessionService.autoEndExpired === "function") {
        await sessionService.autoEndExpired();
      }
    } catch {
      // fall through: the read below reports the truth
    }
  }

  async function paidTransactionFor(sessionOid) {
    return await transactionsColl.findOne({ sessionId: sessionOid });
  }

  /**
   * Record one payment for a closed session. Manual cash/GCash callers acquire
   * the lock here. PayMongo settlement already holds a lock from checkout
   * creation and passes acquireLock: false.
   */
  async function recordPayment(
    {
      sessionId,
      method,
      received,
      provider = null,
      paymongoCheckoutId = null,
      paymongoPaymentId = "",
    },
    actor,
    { acquireLock = true, expectedAmount = null } = {}
  ) {
    if (!isHexId(sessionId)) {
      throw httpError(422, "sessionId is required");
    }
    if (!["cash", "gcash"].includes(method)) {
      throw httpError(422, "method must be cash or gcash");
    }
    if (typeof received !== "number" || !Number.isFinite(received)) {
      throw httpError(422, "received must be a number");
    }
    if (!(received > 0) || received > 1000000) {
      throw httpError(422, "received must be > 0 and <= 1000000");
    }

    await autoEndExpired();

    const oid = new ObjectId(sessionId);
    const session = await sessionsColl.findOne({ _id: oid });
    if (!session) {
      throw httpError(404, "session not found");
    }
    if (session.status !== "closed") {
      throw httpError(422, "session must be closed before billing (end it first)");
    }
    if (acquireLock && session.paymongoStatus === "pending") {
      throw httpError(
        409,
        "an online payment link is active; cancel it before collecting another payment"
      );
    }
    const dup = await sessionsColl.findOne({ _id: oid });
    if (dup && dup.paidTransactionRef) {
      throw httpError(409, `session already billed (${dup.paidTransactionRef})`);
    }
    if (await paidTransactionFor(oid)) {
      throw httpError(409, "session already billed");
    }

    const now = new Date();
    if (acquireLock || !session.billingLocked) {
      const lock = await lockSession(oid, now);
      if (lock.modifiedCount !== 1) {
        await explainLockFailure(oid);
      }
    }

    // Once the lock is held no order edit can change the bill, so the
    // totals computed from this fresh read are exactly what gets stored.
    const locked = await sessionsColl.findOne({ _id: oid });
    if (!locked) {
      if (acquireLock) await releaseLock(oid);
      throw httpError(404, "session not found");
    }

    let insertedId = null;
    let insertedRef = "";
    let sessionTotal = 0;
    let fnbTotal = 0;
    let grandTotal = 0;
    let hours = 0;
    let secs = 0;
    let price = 0;
    let items = [];

    try {
      const start = locked.startTime instanceof Date ? locked.startTime : null;
      if (!start) {
        throw httpError(422, "session has no start time and cannot be billed");
      }
      const until =
        locked.closedAt instanceof Date
          ? new Date(locked.closedAt)
          : new Date();
      secs = (until.getTime() - start.getTime()) / 1000;
      price = locked.pricePerHour != null ? locked.pricePerHour : 140;
      hours = billedHours(secs);
      const totals = billTotals(locked, until);
      sessionTotal = totals.sessionTotal;
      fnbTotal = totals.fnbTotal;
      grandTotal = totals.total;
      items = fnbItems(locked);

      if (received < grandTotal) {
        throw httpError(
          422,
          `short payment: received ${received} < total ${grandTotal}`
        );
      }
      const expected =
        expectedAmount == null ? null : round2(Number(expectedAmount));
      if (expected != null && Math.abs(expected - grandTotal) > 0.009) {
        throw httpError(
          409,
          "bill total changed; cancel the online payment link and try again"
        );
      }

      // PayMongo collects the exact total, so online payments always have no
      // change regardless of the stored checkout amount.
      const actualReceived = provider === "paymongo" ? grandTotal : received;
      const change = provider === "paymongo" ? 0 : round2(actualReceived - grandTotal);
      const rateType = locked.rateType ?? null;

      for (let i = 0; i < MAX_REF_RETRIES; i++) {
        const ref = refOnce();
        if ((await transactionsColl.findOne({ ref })) !== null) continue;
        try {
          const res = await transactionsColl.insertOne({
            ref,
            sessionId: oid,
            tableId: locked.tableId ?? null,
            tableName: locked.tableName ?? "",
            customerName: locked.customerName ?? "",
            cashierId: actor && actor.id ? String(actor.id) : "",
            cashierName: await actorName(actor, usersColl),
            minutes: Math.ceil(Math.max(0, secs) / 60),
            billedHours: hours,
            pricePerHour: price,
            rateType: rateType,
            sessionTotal,
            fnbTotal,
            total: grandTotal,
            items,
            method: method,
            received: actualReceived,
            change: change,
            paidAt: now,
            createdAt: now,
            ...(provider ? { provider } : {}),
            ...(paymongoCheckoutId ? { paymongoCheckoutId } : {}),
            ...(paymongoPaymentId ? { paymongoPaymentId } : {}),
          });
          insertedId = res.insertedId;
          insertedRef = ref;
          break;
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          if (msg.includes("sessionId")) {
            throw httpError(409, "session already billed");
          }
          continue;
        }
      }

      if (!insertedId) {
        throw httpError(500, "could not generate a unique reference, try again");
      }
    } catch (e) {
      // Keep the lock for an online checkout so no order edit can change the
      // bill while the hosted page is still payable. Manual attempts release.
      if (!insertedId && provider !== "paymongo") await releaseLock(oid);
      throw e;
    }

    await sessionsColl.updateOne(
      { _id: oid },
      {
        $set: {
          billingLocked: true,
          paidTransactionRef: insertedRef,
          updatedAt: now,
          ...(provider === "paymongo"
            ? {
                paymongoStatus: "paid",
                paymongoPaidAt: now,
                ...(paymongoPaymentId ? { paymongoPaymentId } : {}),
              }
            : {}),
        },
      }
    );
    await activityLogs.insertOne({
      actorId: actor && actor.id ? String(actor.id) : "",
      action: "payment_record",
      target: String(insertedId),
      sessionId: sessionId,
      sessionTotal,
      fnbTotal,
      total: grandTotal,
      method: method,
      ...(provider ? { provider } : {}),
      ...(paymongoCheckoutId ? { paymongoCheckoutId } : {}),
      at: new Date(),
    });
    const doc = await transactionModel.findById(insertedId);
    return { ok: true, transaction: transactionShape(doc) };
  }

  async function settlePaymongo(session, checkout = {}) {
    const checkoutId = String(
      session.paymongoCheckoutId || checkout.id || ""
    );
    const paymentId = paidPaymentId(checkout.payments);

    let amount = Number(session.paymongoAmount);
    if (!(amount > 0)) {
      const until =
        session.closedAt instanceof Date ? new Date(session.closedAt) : new Date();
      amount = round2(billTotals(session, until).total);
    }

    try {
      return await recordPayment(
        {
          sessionId: String(session._id),
          method: "gcash",
          received: amount,
          provider: "paymongo",
          paymongoCheckoutId: checkoutId,
          paymongoPaymentId: paymentId || String(session.paymongoPaymentId || ""),
        },
        { id: "", username: "PayMongo", email: null },
        { acquireLock: false, expectedAmount: amount }
      );
    } catch (e) {
      // Webhook/poll races and PayMongo retries are normal: return the
      // transaction that already won the unique sessionId index.
      if (e && e.status === 409 && /already billed/i.test(String(e.message))) {
        const tx = await paidTransactionFor(session._id);
        if (tx) return { ok: true, transaction: transactionShape(tx), alreadyPaid: true };
      }
      throw e;
    }
  }

  async function closePaymongoCheckout(session, checkoutId, status, actor) {
    const now = new Date();
    const action =
      status === "cancelled"
        ? "paymongo_checkout_cancel"
        : "paymongo_checkout_expire";
    const res = await sessionsColl.updateOne(
      {
        _id: session._id,
        paymongoCheckoutId: checkoutId,
        paidTransactionRef: { $exists: false },
      },
      {
        $set: {
          paymongoStatus: status,
          paymongoClosedAt: now,
          billingLocked: false,
          billingLockedAt: null,
          updatedAt: now,
        },
      }
    );
    if (res.modifiedCount === 1) {
      await activityLogs.insertOne({
        actorId: actor && actor.id ? String(actor.id) : "",
        action,
        target: String(session._id),
        sessionId: String(session._id),
        checkoutId,
        status,
        at: now,
      });
    }
    return res.modifiedCount === 1;
  }

  return {
    /** POST /api/cashier/transactions — bill session + F&B in one payment. */
    async create({ sessionId, method, received }, actor) {
      return await recordPayment({ sessionId, method, received }, actor, {
        acquireLock: true,
      });
    },

    /**
     * POST /api/cashier/sessions/{id}/paymongo — create (or reuse) a hosted
     * GCash checkout for the exact locked bill total.
     */
    async startPaymongo({ sessionId }, actor) {
      if (!paymongoService) {
        throw httpError(503, "PayMongo is not configured");
      }
      if (!isHexId(sessionId)) {
        throw httpError(422, "sessionId is required");
      }
      await autoEndExpired();

      const oid = new ObjectId(sessionId);
      let session = await sessionsColl.findOne({ _id: oid });
      if (!session) throw httpError(404, "session not found");
      if (session.status !== "closed") {
        throw httpError(422, "session must be closed before billing (end it first)");
      }
      const dup = await paidTransactionFor(oid);
      if (dup) {
        throw httpError(409, `session already billed (${dup.ref ?? "billed"})`);
      }
      if (
        session.paymongoStatus === "pending" &&
        session.paymongoCheckoutId &&
        session.paymongoCheckoutUrl
      ) {
        return {
          ok: true,
          reused: true,
          checkout: {
            id: String(session.paymongoCheckoutId),
            url: String(session.paymongoCheckoutUrl),
            amount:
              session.paymongoAmount != null
                ? Number(session.paymongoAmount)
                : null,
            status: "pending",
          },
        };
      }

      const now = new Date();
      const lock = await lockSession(oid, now);
      if (lock.modifiedCount !== 1) {
        const fresh = await sessionsColl.findOne({ _id: oid });
        if (
          fresh &&
          fresh.paymongoStatus === "pending" &&
          fresh.paymongoCheckoutId &&
          fresh.paymongoCheckoutUrl
        ) {
          return {
            ok: true,
            reused: true,
            checkout: {
              id: String(fresh.paymongoCheckoutId),
              url: String(fresh.paymongoCheckoutUrl),
              amount:
                fresh.paymongoAmount != null
                  ? Number(fresh.paymongoAmount)
                  : null,
              status: "pending",
            },
          };
        }
        await explainLockFailure(oid);
      }

      const locked = await sessionsColl.findOne({ _id: oid });
      if (!locked) {
        await releaseLock(oid);
        throw httpError(404, "session not found");
      }

      const until =
        locked.closedAt instanceof Date ? new Date(locked.closedAt) : now;
      const amount = round2(billTotals(locked, until).total);
      if (!(amount > 0)) {
        await releaseLock(oid);
        throw httpError(422, "invalid bill total");
      }

      let checkout = null;
      try {
        checkout = await paymongoService.createCheckout({
          amount,
          description: `GameHub${locked.tableName ? ` · ${locked.tableName}` : ""} session bill`,
          referenceNumber: `SES-${String(oid)}-${now.getTime().toString(36)}`,
          metadata: { sessionId: String(oid) },
        });
      } catch (e) {
        await releaseLock(oid);
        throw e;
      }

      try {
        const linked = await sessionsColl.updateOne(
          {
            _id: oid,
            status: "closed",
            paidTransactionRef: { $exists: false },
          },
          {
            $set: {
              paymongoCheckoutId: checkout.id,
              paymongoCheckoutUrl: checkout.url,
              paymongoAmount: amount,
              paymongoStatus: "pending",
              paymongoCreatedAt: now,
              updatedAt: now,
            },
          }
        );
        if (linked.modifiedCount !== 1) {
          // A payment may have landed while the checkout was being created.
          // Never overwrite a paid session with a new payable link.
          try {
            await paymongoService.expireCheckout(checkout.id);
          } catch {
            // best effort
          }
          const fresh = await sessionsColl.findOne({ _id: oid });
          if (!fresh || !fresh.paidTransactionRef) await releaseLock(oid);
          throw httpError(
            409,
            fresh && fresh.paidTransactionRef
              ? `session already billed (${fresh.paidTransactionRef})`
              : "session changed while creating the payment link; try again"
          );
        }
      } catch (e) {
        if (!(e && e.status === 409 && /session (already billed|changed)/i.test(e.message))) {
          await releaseLock(oid);
          // The hosted page exists but is not linked to this session. Expire it
          // so a customer cannot pay a bill the app cannot reconcile.
          try {
            await paymongoService.expireCheckout(checkout.id);
          } catch {
            // best effort
          }
        }
        throw e;
      }

      await activityLogs.insertOne({
        actorId: actor && actor.id ? String(actor.id) : "",
        action: "paymongo_checkout_create",
        target: String(oid),
        sessionId: String(oid),
        checkoutId: checkout.id,
        amount,
        at: new Date(),
      });

      return {
        ok: true,
        checkout: {
          id: checkout.id,
          url: checkout.url,
          amount,
          status: "pending",
        },
      };
    },

    /** GET /api/cashier/paymongo/checkouts/{id} — poll/reconcile status. */
    async paymongoStatus(checkoutId) {
      const id = String(checkoutId || "").trim();
      if (!id) throw httpError(422, "checkoutId is required");

      const session = await sessionsColl.findOne({ paymongoCheckoutId: id });
      if (!session) throw httpError(404, "payment link not found");

      if (session.paidTransactionRef) {
        const tx = await transactionModel.findByRef(session.paidTransactionRef);
        return {
          ok: true,
          status: "paid",
          ...(tx ? { transaction: transactionShape(tx) } : {}),
        };
      }
      if (session.paymongoStatus === "cancelled") {
        return { ok: true, status: "cancelled" };
      }
      if (session.paymongoStatus === "expired") {
        return { ok: true, status: "expired" };
      }
      if (!paymongoService) {
        throw httpError(503, "PayMongo is not configured");
      }

      const checkout = await paymongoService.retrieveCheckout(id);
      const paid = checkout.paid === true || checkout.status === "paid";
      if (paid) {
        const result = await settlePaymongo(session, checkout);
        return { ok: true, status: "paid", transaction: result.transaction };
      }
      // A processing attempt must win over an expiry flag: never release the
      // bill while PayMongo could still complete that payment.
      if (checkout.pending) {
        return { ok: true, status: "pending" };
      }
      if (checkout.status === "expired" || checkout.status === "cancelled") {
        const status = checkout.status;
        await closePaymongoCheckout(session, id, status, null);
        return { ok: true, status };
      }
      return { ok: true, status: checkout.status || "pending" };
    },

    /** POST /api/cashier/sessions/{id}/paymongo/cancel */
    async cancelPaymongo(sessionId, actor) {
      if (!isHexId(sessionId)) {
        throw httpError(422, "sessionId is required");
      }
      const oid = new ObjectId(sessionId);
      const session = await sessionsColl.findOne({ _id: oid });
      if (!session) throw httpError(404, "session not found");
      if (session.paidTransactionRef) {
        throw httpError(409, `session already billed (${session.paidTransactionRef})`);
      }
      if (
        session.paymongoStatus !== "pending" ||
        !session.paymongoCheckoutId
      ) {
        throw httpError(409, "no active PayMongo payment link");
      }

      const checkoutId = String(session.paymongoCheckoutId);
      if (paymongoService) {
        // Never unlock a hosted page that may still be payable. If PayMongo
        // cannot be reached, leave the bill locked and let the cashier retry.
        const checkout = await paymongoService.retrieveCheckout(checkoutId);
        if (checkout.paid === true || checkout.status === "paid") {
          const result = await settlePaymongo(session, checkout);
          return {
            ok: true,
            status: "paid",
            transaction: result.transaction,
          };
        }
        if (checkout.pending) {
          throw httpError(
            409,
            "the PayMongo payment is still processing; wait for confirmation before cancelling"
          );
        }
        if (checkout.status === "expired" || checkout.status === "cancelled") {
          const status = checkout.status;
          await closePaymongoCheckout(session, checkoutId, status, actor);
          return { ok: true, status };
        }

        try {
          await paymongoService.expireCheckout(checkoutId);
        } catch (err) {
          // The session may have been paid between retrieve and expire.
          // Re-read before deciding; otherwise keep the lock so a still-active
          // hosted page cannot be paid after the bill is released.
          let fresh = null;
          try {
            fresh = await paymongoService.retrieveCheckout(checkoutId);
          } catch {
            // Keep the original expire error.
          }
          if (fresh) {
            if (fresh.paid === true || fresh.status === "paid") {
              const result = await settlePaymongo(session, fresh);
              return {
                ok: true,
                status: "paid",
                transaction: result.transaction,
              };
            }
            if (fresh.pending) {
              throw httpError(
                409,
                "the PayMongo payment is still processing; wait for confirmation before cancelling"
              );
            }
            if (fresh.status === "expired" || fresh.status === "cancelled") {
              const status = fresh.status;
              await closePaymongoCheckout(session, checkoutId, status, actor);
              return { ok: true, status };
            }
          }
          throw err;
        }
      }

      await closePaymongoCheckout(session, checkoutId, "cancelled", actor);
      return { ok: true, status: "cancelled" };
    },

    /**
     * POST /api/paymongo/webhook — verify the raw body, then settle or expire
     * the matching checkout idempotently. Unknown resources are acknowledged
     * with 200 so PayMongo stops retrying.
     */
    async handlePaymongoWebhook(rawBody, signature, payload) {
      if (!paymongoService) {
        throw httpError(503, "PayMongo is not configured");
      }
      await paymongoService.verifyWebhook(rawBody, signature);

      const root = payload && payload.data ? payload.data : {};
      // Old event shape: data.attributes.type / data.attributes.data.
      // New docs shape:  data.type / data.data.
      const type = String(
        (root.attributes && root.attributes.type) || root.type || ""
      );
      const resource =
        (root.attributes && root.attributes.data) ||
        root.data ||
        (root.id && root.attributes ? root : null);
      if (!resource || !resource.id) {
        return { ok: true, ignored: true };
      }

      const checkoutId = String(resource.id);
      const session = await sessionsColl.findOne({
        paymongoCheckoutId: checkoutId,
      });
      if (!session) {
        return { ok: true, ignored: true };
      }

      const attrs = resource.attributes || {};
      const payments = Array.isArray(attrs.payments) ? attrs.payments : [];
      const paid =
        /paid/i.test(type) ||
        String(attrs.status || "").toLowerCase() === "paid" ||
        paymentsHavePaid(payments);
      if (paid) {
        const result = await settlePaymongo(session, {
          id: checkoutId,
          status: "paid",
          payments,
        });
        return {
          ok: true,
          status: "paid",
          transaction: result.transaction,
        };
      }

      if (/expired|cancelled/i.test(type)) {
        const status = /cancelled/i.test(type) ? "cancelled" : "expired";
        await closePaymongoCheckout(session, checkoutId, status, null);
        return { ok: true, status };
      }

      return { ok: true, ignored: true };
    },

    /** GET /api/cashier/transactions + GET /api/admin/transactions */
    async list({ from, to, month, method, limit = 200 } = {}) {
      const filter = {};
      const range = {};
      if (month) {
        const [y, m] = String(month).split("-").map(Number);
        if (m < 1 || m > 12) {
          throw httpError(422, "month must be YYYY-MM");
        }
        range.$gte = new Date(Date.UTC(y, m - 1, 1));
        range.$lt = new Date(Date.UTC(y, m, 1));
      } else {
        if (from) {
          const d = parseDay(from, "from");
          if (d) range.$gte = d;
        }
        if (to) {
          const d = parseDay(to, "to");
          if (d) range.$lt = new Date(d.getTime() + 24 * 60 * 60 * 1000);
        }
      }
      if (Object.keys(range).length > 0) filter.paidAt = range;
      if (method && ["cash", "gcash"].includes(method)) {
        filter.method = method;
      }
      const docs = await transactionModel.list(filter, { limit });
      return { ok: true, transactions: docs.map(transactionShape) };
    },

    /** GET /api/cashier/transactions/{ref} + GET /api/admin/transactions/{ref} */
    async get(ref) {
      if (!ref) {
        throw httpError(422, "ref is required");
      }
      const doc = await transactionModel.findByRef(ref);
      if (!doc) {
        throw httpError(404, "transaction not found");
      }
      return { ok: true, transaction: transactionShape(doc) };
    },
  };

  function parseDay(raw, field) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
      throw httpError(422, `${field} must be YYYY-MM-DD`);
    }
    const d = new Date(Date.UTC(
      Number(raw.slice(0, 4)),
      Number(raw.slice(5, 7)) - 1,
      Number(raw.slice(8, 10))
    ));
    if (isNaN(d.getTime())) {
      throw httpError(422, `${field} must be YYYY-MM-DD`);
    }
    return d;
  }
}

function transactionShape(doc) {
  const total = doc.total != null ? doc.total : 0;
  return {
    id: doc._id != null ? String(doc._id) : null,
    ref: doc.ref ?? "",
    sessionId: doc.sessionId != null ? String(doc.sessionId) : null,
    tableId: doc.tableId != null ? String(doc.tableId) : null,
    tableName: doc.tableName ?? "—",
    customerName: doc.customerName ?? "",
    cashierId: doc.cashierId != null ? String(doc.cashierId) : null,
    cashierName: doc.cashierName ?? "—",
    minutes: doc.minutes != null ? doc.minutes : 0,
    billedHours: doc.billedHours != null ? doc.billedHours : 0,
    pricePerHour: doc.pricePerHour != null ? doc.pricePerHour : 0,
    rateType: doc.rateType ?? null,
    sessionTotal: doc.sessionTotal != null ? doc.sessionTotal : total,
    fnbTotal: doc.fnbTotal != null ? doc.fnbTotal : 0,
    total: total,
    items: Array.isArray(doc.items)
      ? doc.items.map((item) => ({
          productId:
            item.productId != null ? String(item.productId) : null,
          name: item.name ?? "",
          category: item.category ?? "",
          unitPrice: item.unitPrice != null ? item.unitPrice : 0,
          qty: item.qty != null ? item.qty : 0,
          lineTotal: item.lineTotal != null ? item.lineTotal : 0,
        }))
      : [],
    method: doc.method ?? "",
    provider: doc.provider ?? null,
    received: doc.received != null ? doc.received : 0,
    change: doc.change != null ? doc.change : 0,
    paidAt: doc.paidAt instanceof Date ? doc.paidAt.toISOString() : null,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null,
  };
}
