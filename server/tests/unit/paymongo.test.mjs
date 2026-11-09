// PayMongo service + webhook signature rules (no network: fetch is injected).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  paidPaymentId,
  paymongoService,
  paymentsHavePaid,
  paymentsHavePending,
  verifyPaymongoSignature,
} from "../../src/services/paymongo.service.js";

const ENABLED = {
  enabled: true,
  secretKey: "sk_test_paymongo_secret",
  webhookSecret: "whsec_paymongo_webhook",
};

function fakeFetch(payload, { ok = true, status = 200, calls = [] } = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    return {
      ok,
      status,
      json: async () => payload,
    };
  };
}

function sign(body, secret, timestamp = "1700000000") {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

describe("paymongoService.createCheckout", () => {
  it("creates a GCash checkout for the exact peso amount", async () => {
    const calls = [];
    const svc = paymongoService({
      configProvider: async () => ENABLED,
      frontendUrl: "http://localhost:5500/",
      fetchImpl: fakeFetch(
        {
          data: {
            id: "cs_test_123",
            attributes: {
              checkout_url: "https://checkout.paymongo.com/cs_test_123",
              status: "active",
            },
          },
        },
        { calls }
      ),
    });

    const checkout = await svc.createCheckout({
      amount: 123.45,
      description: "GameHub · Table 2 session bill",
      referenceNumber: "SES-abc-123",
      metadata: { sessionId: "64b000000000000000000000" },
    });

    assert.deepEqual(checkout, {
      id: "cs_test_123",
      url: "https://checkout.paymongo.com/cs_test_123",
      status: "active",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.paymongo.com/v2/checkout_sessions");
    assert.equal(
      calls[0].options.headers.Authorization,
      `Basic ${Buffer.from(`${ENABLED.secretKey}:`).toString("base64")}`
    );
    const body = JSON.parse(calls[0].options.body);
    const attrs = body.data.attributes;
    assert.equal(attrs.line_items[0].currency, "PHP");
    assert.equal(attrs.line_items[0].amount, 12345);
    assert.equal(attrs.line_items[0].quantity, 1);
    assert.deepEqual(attrs.payment_method_types, ["gcash"]);
    assert.equal(
      attrs.success_url,
      "http://localhost:5500/paymongo/return.html?status=paid"
    );
    assert.equal(
      attrs.cancel_url,
      "http://localhost:5500/paymongo/return.html?status=cancelled"
    );
    assert.equal(attrs.reference_number, "SES-abc-123");
    assert.deepEqual(attrs.metadata, {
      sessionId: "64b000000000000000000000",
    });
  });

  it("fails closed when PayMongo is disabled", async () => {
    let called = false;
    const svc = paymongoService({
      configProvider: async () => ({ ...ENABLED, enabled: false }),
      fetchImpl: async () => {
        called = true;
      },
      frontendUrl: "http://localhost:5500",
    });
    await assert.rejects(
      () => svc.createCheckout({ amount: 140 }),
      (err) => err.status === 503 && /not enabled/i.test(err.message)
    );
    assert.equal(called, false);
  });

  it("maps PayMongo API errors to a 502 without leaking keys", async () => {
    const svc = paymongoService({
      configProvider: async () => ENABLED,
      frontendUrl: "http://localhost:5500",
      fetchImpl: fakeFetch(
        { errors: [{ detail: "Invalid API key" }] },
        { ok: false, status: 401 }
      ),
    });
    await assert.rejects(
      () => svc.createCheckout({ amount: 140 }),
      (err) =>
        err.status === 502 &&
        /PayMongo request failed: Invalid API key/.test(err.message) &&
        !err.message.includes(ENABLED.secretKey)
    );
  });
});

describe("paymongoService checkout status", () => {
  it("retrieves payment attempts and expires the hosted page", async () => {
    const calls = [];
    const svc = paymongoService({
      configProvider: async () => ENABLED,
      frontendUrl: "http://localhost:5500",
      fetchImpl: fakeFetch(
        {
          data: {
            id: "cs_test_123",
            attributes: {
              status: "active",
              payments: [
                { id: "pay_failed_1", attributes: { status: "failed" } },
                { id: "pay_processing_1", attributes: { status: "processing" } },
              ],
            },
          },
        },
        { calls }
      ),
    });

    const status = await svc.retrieveCheckout("cs_test_123");
    assert.equal(status.status, "active");
    assert.equal(status.payments[0].id, "pay_failed_1");
    assert.equal(status.paid, false);
    assert.equal(status.pending, true);
    assert.equal(
      calls[0].url,
      "https://api.paymongo.com/v1/checkout_sessions/cs_test_123"
    );

    await svc.expireCheckout("cs_test_123");
    assert.equal(
      calls[1].url,
      "https://api.paymongo.com/v1/checkout_sessions/cs_test_123/expire"
    );
    assert.equal(calls[1].options.method, "POST");
  });

  it("marks a checkout paid only when one attempt actually succeeded", async () => {
    const svc = paymongoService({
      configProvider: async () => ENABLED,
      frontendUrl: "http://localhost:5500",
      fetchImpl: fakeFetch({
        data: {
          id: "cs_test_123",
          attributes: {
            status: "active",
            payments: [
              { id: "pay_failed_1", attributes: { status: "failed" } },
              { id: "pay_paid_1", attributes: { status: "paid" } },
            ],
          },
        },
      }),
    });

    const status = await svc.retrieveCheckout("cs_test_123");
    assert.equal(status.paid, true);
    assert.equal(status.pending, false);
  });

  it("still cleans up an existing checkout after the integration is disabled", async () => {
    const calls = [];
    const svc = paymongoService({
      configProvider: async () => ({ ...ENABLED, enabled: false }),
      frontendUrl: "http://localhost:5500",
      fetchImpl: fakeFetch(
        {
          data: {
            id: "cs_test_123",
            attributes: { status: "active", payments: [] },
          },
        },
        { calls }
      ),
    });

    const status = await svc.retrieveCheckout("cs_test_123");
    assert.equal(status.status, "active");
    await svc.expireCheckout("cs_test_123");
    assert.equal(calls.length, 2);
  });
});

describe("PayMongo payment attempt helpers", () => {
  it("does not treat failed or pending attempts as paid", () => {
    const attempts = [
      { id: "pay_failed", status: "failed" },
      { id: "pay_pending", attributes: { status: "pending" } },
      { id: "pay_processing", attributes: { status: "processing" } },
    ];
    assert.equal(paymentsHavePaid(attempts), false);
    assert.equal(paymentsHavePending(attempts), true);
    assert.equal(paidPaymentId(attempts), "");
  });

  it("returns the successful attempt id when mixed with failures", () => {
    const attempts = [
      { id: "pay_failed", status: "failed" },
      { id: "pay_paid", attributes: { status: "paid" } },
    ];
    assert.equal(paymentsHavePaid(attempts), true);
    assert.equal(paymentsHavePending(attempts), false);
    assert.equal(paidPaymentId(attempts), "pay_paid");
  });
});

describe("PayMongo webhook signatures", () => {
  const body = JSON.stringify({
    data: { type: "checkout_session.payment.paid" },
  });

  it("accepts the current t=,te=,li= signature scheme", () => {
    const timestamp = "1700000000";
    const signature = sign(body, ENABLED.webhookSecret, timestamp);
    assert.equal(
      verifyPaymongoSignature(
        body,
        `t=${timestamp},te=${signature},li=live-signature`,
        ENABLED.webhookSecret
      ),
      true
    );
  });

  it("rejects a tampered body and a wrong secret", () => {
    const timestamp = "1700000000";
    const signature = sign(body, ENABLED.webhookSecret, timestamp);
    assert.equal(
      verifyPaymongoSignature(
        `${body} `,
        `t=${timestamp},te=${signature},li=`,
        ENABLED.webhookSecret
      ),
      false
    );
    assert.equal(
      verifyPaymongoSignature(
        body,
        `t=${timestamp},te=${signature},li=`,
        "whsec_wrong"
      ),
      false
    );
  });

  it("supports a raw-body signature header for older webhook setups", () => {
    const signature = crypto
      .createHmac("sha256", ENABLED.webhookSecret)
      .update(body)
      .digest("hex");
    assert.equal(
      verifyPaymongoSignature(body, signature, ENABLED.webhookSecret),
      true
    );
  });

  it("verifyWebhook rejects when no signature is sent", async () => {
    const svc = paymongoService({
      configProvider: async () => ENABLED,
      fetchImpl: fakeFetch({}),
      frontendUrl: "http://localhost:5500",
    });
    await assert.rejects(
      () => svc.verifyWebhook(body, ""),
      (err) => err.status === 401
    );
  });

  it("keeps verifying signed events while the integration is disabled", async () => {
    const timestamp = "1700000000";
    const signature = sign(body, ENABLED.webhookSecret, timestamp);
    const svc = paymongoService({
      configProvider: async () => ({ ...ENABLED, enabled: false }),
      fetchImpl: fakeFetch({}),
      frontendUrl: "http://localhost:5500",
    });
    assert.equal(
      await svc.verifyWebhook(
        body,
        `t=${timestamp},te=${signature},li=live-signature`
      ),
      true
    );
  });
});
