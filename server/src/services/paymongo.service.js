// PayMongo service — hosted Checkout Sessions for cashier bill payments.
// The admin Settings page stores the secret + webhook-signing keys (encrypted);
// this service only ever receives them from settings.service.js.
//
// API notes:
//   - Create uses Checkout Sessions V2: POST /v2/checkout_sessions.
//   - Retrieve/expire remain the documented V1 checkout-session endpoints.
//   - Amounts are PHP centavos (peso amount × 100).
//   - GCash only for now, so the existing "gcash" transaction method stays
//     accurate. Cards/Maya can be added by widening payment_method_types.
import crypto from "node:crypto";

const API_BASE = "https://api.paymongo.com";
const REQUEST_TIMEOUT_MS = 15000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseSignatureHeader(header) {
  const out = {};
  for (const part of String(header || "").split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function safeEqualHex(expected, actual) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(actual || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Payment objects may expose `status` directly or under `attributes`. */
export function paymentStatus(payment) {
  if (!payment || typeof payment !== "object") return "";
  return String(
    payment.status ||
      (payment.attributes && payment.attributes.status) ||
      ""
  ).toLowerCase();
}

/** True only for a completed payment, not merely a failed/pending attempt. */
export function paymentsHavePaid(payments) {
  return (
    Array.isArray(payments) &&
    payments.some((payment) => paymentStatus(payment) === "paid")
  );
}

/** True while a payment attempt is still pending/processing. */
export function paymentsHavePending(payments) {
  return (
    Array.isArray(payments) &&
    payments.some((payment) =>
      ["pending", "processing", "awaiting_payment"].includes(
        paymentStatus(payment)
      )
    )
  );
}

/** The id of the successful payment, if any. */
export function paidPaymentId(payments) {
  if (!Array.isArray(payments)) return "";
  const paid = payments.find((payment) => paymentStatus(payment) === "paid");
  return paid && paid.id ? String(paid.id) : "";
}

/**
 * Verify a PayMongo webhook signature.
 * PayMongo sends `Paymongo-Signature: t=<unix>,te=<test sig>,li=<live sig>`.
 * The signed payload is `<t>.<raw body>` HMAC-SHA256 with the webhook secret.
 * Some dashboard examples sign the raw body directly; support both so older
 * webhook configurations keep working (the header still proves possession).
 */
export function verifyPaymongoSignature(rawBody, signatureHeader, secret) {
  const key = String(secret || "").trim();
  const header = String(signatureHeader || "").trim();
  if (!key || !header) return false;

  const parts = parseSignatureHeader(header);
  const timestamp = parts.t;
  const candidates = [parts.te, parts.li].filter(Boolean);
  const payload = rawBody == null ? "" : String(rawBody);

  if (timestamp && candidates.length > 0) {
    const expected = crypto
      .createHmac("sha256", key)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    return candidates.some((sig) => safeEqualHex(expected, sig));
  }

  // Raw-body fallback (header contains only the signature itself).
  const expected = crypto
    .createHmac("sha256", key)
    .update(payload)
    .digest("hex");
  return safeEqualHex(expected, header);
}

export function paymongoService({
  configProvider,
  fetchImpl = globalThis.fetch,
  frontendUrl = "",
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  async function config({ requireEnabled = false } = {}) {
    const cfg = await configProvider();
    if (!cfg || (requireEnabled && !cfg.enabled)) {
      throw httpError(503, "PayMongo is not enabled");
    }
    if (!cfg.secretKey) {
      throw httpError(503, "PayMongo secret key is missing");
    }
    return cfg;
  }

  async function request(
    path,
    { method = "GET", body = null, requireEnabled = false } = {}
  ) {
    const cfg = await config({ requireEnabled });
    const headers = {
      Authorization: `Basic ${Buffer.from(`${cfg.secretKey}:`).toString("base64")}`,
      Accept: "application/json",
    };
    if (body) headers["Content-Type"] = "application/json";

    const controller =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(timeoutMs)
        : undefined;

    let res;
    try {
      res = await fetchImpl(`${API_BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        ...(controller ? { signal: controller } : {}),
      });
    } catch {
      // Never echo transport details (they can include the URL or TLS info).
      throw httpError(503, "PayMongo is unreachable, try again");
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const first = payload && Array.isArray(payload.errors) ? payload.errors[0] : null;
      const detail =
        (first && (first.detail || first.code || first.title)) ||
        (payload && payload.message) ||
        `HTTP ${res.status}`;
      throw httpError(502, `PayMongo request failed: ${String(detail).slice(0, 300)}`);
    }
    return payload || {};
  }

  function returnUrl(kind) {
    const base = String(frontendUrl || "").replace(/\/+$/, "");
    if (!base) throw httpError(503, "FRONTEND_URL is not configured");
    return `${base}/paymongo/return.html?status=${kind}`;
  }

  return {
    /** Create a hosted GCash checkout for an exact peso amount. */
    async createCheckout({ amount, description = "", referenceNumber = "", metadata = {} } = {}) {
      const centavos = Math.round(Number(amount) * 100);
      if (!Number.isInteger(centavos) || centavos <= 0 || centavos > 100000000) {
        throw httpError(422, "invalid payment amount");
      }

      const meta = {};
      for (const [key, value] of Object.entries(metadata || {})) {
        if (value != null) meta[key] = String(value);
      }

      const payload = await request("/v2/checkout_sessions", {
        method: "POST",
        requireEnabled: true,
        body: {
          data: {
            attributes: {
              line_items: [
                {
                  currency: "PHP",
                  amount: centavos,
                  name: String(description || "GameHub payment").slice(0, 255),
                  quantity: 1,
                },
              ],
              payment_method_types: ["gcash"],
              success_url: returnUrl("paid"),
              cancel_url: returnUrl("cancelled"),
              description: String(description || "GameHub session bill").slice(0, 255),
              reference_number: String(referenceNumber || "").slice(0, 255),
              send_email_receipt: false,
              show_description: true,
              show_line_items: true,
              metadata: meta,
            },
          },
        },
      });

      const data = payload && payload.data ? payload.data : {};
      const attrs = data.attributes || {};
      const id = String(data.id || "");
      const checkoutUrl = String(attrs.checkout_url || "");
      if (!id || !checkoutUrl) {
        throw httpError(502, "PayMongo did not return a checkout link");
      }
      return {
        id,
        url: checkoutUrl,
        status: String(attrs.status || "pending"),
      };
    },

    /** Retrieve a checkout session (V1 endpoint works for V2 sessions). */
    async retrieveCheckout(checkoutId) {
      const id = String(checkoutId || "").trim();
      if (!id) throw httpError(422, "checkoutId is required");
      const payload = await request(`/v1/checkout_sessions/${encodeURIComponent(id)}`);
      const data = payload && payload.data ? payload.data : {};
      const attrs = data.attributes || {};
      const status = String(attrs.status || "").toLowerCase();
      const payments = Array.isArray(attrs.payments) ? attrs.payments : [];
      return {
        id: String(data.id || id),
        status,
        payments,
        paid: status === "paid" || paymentsHavePaid(payments),
        pending: paymentsHavePending(payments),
      };
    },

    /** Expire the hosted page so it can no longer be paid after cancellation. */
    async expireCheckout(checkoutId) {
      const id = String(checkoutId || "").trim();
      if (!id) throw httpError(422, "checkoutId is required");
      await request(`/v1/checkout_sessions/${encodeURIComponent(id)}/expire`, {
        method: "POST",
      });
      return true;
    },

    /** Verify the raw webhook body against the stored signing secret. */
    async verifyWebhook(rawBody, signatureHeader) {
      // Keep accepting signed events while the integration is switched off:
      // an already-created checkout can still be paid, and that payment must
      // be recorded rather than silently lost.
      const cfg = await configProvider();
      if (!cfg || !cfg.webhookSecret) {
        throw httpError(503, "PayMongo webhook signing secret is missing");
      }
      if (!verifyPaymongoSignature(rawBody, signatureHeader, cfg.webhookSecret)) {
        throw httpError(401, "invalid PayMongo signature");
      }
      return true;
    },
  };
}
