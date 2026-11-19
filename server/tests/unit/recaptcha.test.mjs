// reCAPTCHA verification rules (no network: fetch is injected).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recaptchaService } from "../../src/services/recaptcha.service.js";

const ENABLED = {
  enabled: true,
  siteKey: "6LcSiteKeyForTests0000000000000000000000",
  secretKey: "6LcSecretKeyForTests00000000000000000000",
};

function fakeFetch(payload, { ok = true, calls = [] } = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => payload,
    };
  };
}

describe("recaptchaService.verify", () => {
  it("is a no-op when the integration is disabled", async () => {
    let called = false;
    const svc = recaptchaService({
      configProvider: async () => ({ enabled: false, siteKey: "", secretKey: "" }),
      fetchImpl: async () => { called = true; },
    });
    const result = await svc.verify("", "127.0.0.1");
    assert.deepEqual(result, { ok: true, skipped: true });
    assert.equal(called, false);
  });

  it("skips (with a warning) when enabled but a key is missing", async () => {
    const svc = recaptchaService({
      configProvider: async () => ({ enabled: true, siteKey: "site", secretKey: "" }),
      fetchImpl: async () => { throw new Error("must not be called"); },
    });
    const result = await svc.verify("token");
    assert.equal(result.skipped, true);
  });

  it("requires a token when enabled", async () => {
    const svc = recaptchaService({
      configProvider: async () => ENABLED,
      fetchImpl: fakeFetch({ success: true }),
    });
    await assert.rejects(
      svc.verify("", "127.0.0.1"),
      (err) => err.status === 422
    );
  });

  it("rejects an over-long token", async () => {
    const svc = recaptchaService({
      configProvider: async () => ENABLED,
      fetchImpl: fakeFetch({ success: true }),
    });
    await assert.rejects(
      svc.verify("x".repeat(5000)),
      (err) => err.status === 422
    );
  });

  it("posts the secret, response and remote ip to siteverify", async () => {
    const calls = [];
    const svc = recaptchaService({
      configProvider: async () => ENABLED,
      fetchImpl: fakeFetch({ success: true }, { calls }),
    });
    const result = await svc.verify("abc123", "203.0.113.9");
    assert.deepEqual(result, { ok: true, skipped: false });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /google\.com\/recaptcha\/api\/siteverify$/);
    const body = new URLSearchParams(calls[0].options.body);
    assert.equal(body.get("secret"), ENABLED.secretKey);
    assert.equal(body.get("response"), "abc123");
    assert.equal(body.get("remoteip"), "203.0.113.9");
  });

  it("maps success:false to 403", async () => {
    const svc = recaptchaService({
      configProvider: async () => ENABLED,
      fetchImpl: fakeFetch({ success: false, "error-codes": ["invalid-input-response"] }),
    });
    await assert.rejects(
      svc.verify("bad-token"),
      (err) => err.status === 403
    );
  });

  it("fails closed with 503 when Google cannot be reached", async () => {
    const svc = recaptchaService({
      configProvider: async () => ENABLED,
      fetchImpl: async () => { throw new Error("network down"); },
    });
    await assert.rejects(
      svc.verify("abc123"),
      (err) => err.status === 503
    );
  });

  it("fails closed with 503 when the settings read fails", async () => {
    const svc = recaptchaService({
      configProvider: async () => { throw new Error("db down"); },
      fetchImpl: fakeFetch({ success: true }),
    });
    await assert.rejects(
      svc.verify("abc123"),
      (err) => err.status === 503
    );
  });
});
