// Unit tests for geminiService.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { geminiService } from "../../src/services/gemini.service.js";

describe("geminiService.getConfig", () => {
  it("returns defaults when no configProvider is supplied", async () => {
    const svc = geminiService();
    const cfg = await svc.getConfig();
    assert.strictEqual(cfg.enabled, false);
    assert.strictEqual(cfg.apiKey, "");
  });

  it("reads config from provider", async () => {
    const svc = geminiService({
      configProvider: async () => ({ enabled: true, apiKey: "AIzaSyTestKey1234567890" }),
    });
    const cfg = await svc.getConfig();
    assert.strictEqual(cfg.enabled, true);
    assert.strictEqual(cfg.apiKey, "AIzaSyTestKey1234567890");
  });
});

describe("geminiService.testConnection", () => {
  it("throws 422 when no API key is configured or passed", async () => {
    const svc = geminiService({
      configProvider: async () => ({ enabled: true, apiKey: "" }),
      fetchImpl: async () => assert.fail("fetch should not be called"),
    });

    await assert.rejects(
      () => svc.testConnection(""),
      (err) => err.status === 422 && /No Gemini API key/i.test(err.message)
    );
  });

  it("calls Google models endpoint with API key and returns model count on success", async () => {
    let capturedUrl = "";
    const mockFetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: "models/gemini-1.5-flash" },
            { name: "models/gemini-1.5-pro" },
          ],
        }),
      };
    };

    const svc = geminiService({
      configProvider: async () => ({ enabled: true, apiKey: "AIzaSyKeyFromProvider123" }),
      fetchImpl: mockFetch,
    });

    const res = await svc.testConnection();
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.modelsCount, 2);
    assert.ok(capturedUrl.includes("key=AIzaSyKeyFromProvider123"));
  });

  it("accepts an explicit apiKeyOverride parameter", async () => {
    let capturedUrl = "";
    const mockFetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: "models/gemini-1.5-flash" }] }),
      };
    };

    const svc = geminiService({
      configProvider: async () => ({ enabled: false, apiKey: "" }),
      fetchImpl: mockFetch,
    });

    const res = await svc.testConnection("AIzaSyOverrideKey12345");
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.modelsCount, 1);
    assert.ok(capturedUrl.includes("key=AIzaSyOverrideKey12345"));
  });

  it("surfaces 422 with Google error message on invalid API key (400)", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 400,
          message: "API key not valid. Please pass a valid API key.",
          status: "INVALID_ARGUMENT",
        },
      }),
    });

    const svc = geminiService({
      configProvider: async () => ({ enabled: true, apiKey: "AIzaSyInvalidKey123456" }),
      fetchImpl: mockFetch,
    });

    await assert.rejects(
      () => svc.testConnection(),
      (err) =>
        err.status === 422 &&
        /API key not valid/i.test(err.message)
    );
  });

  it("surfaces 503 on network / connection failure", async () => {
    const mockFetch = async () => {
      throw new Error("getaddrinfo ENOTFOUND generativelanguage.googleapis.com");
    };

    const svc = geminiService({
      configProvider: async () => ({ enabled: true, apiKey: "AIzaSyValidKey12345678" }),
      fetchImpl: mockFetch,
    });

    await assert.rejects(
      () => svc.testConnection(),
      (err) => err.status === 503 && /Could not reach Google Gemini API/i.test(err.message)
    );
  });
});

describe("geminiService.generateContent", () => {
  it("rejects when integration is disabled (403)", async () => {
    const svc = geminiService({
      configProvider: async () => ({ enabled: false, apiKey: "AIzaSyTestKey12345678" }),
      fetchImpl: async () => assert.fail("fetch should not be called"),
    });

    await assert.rejects(
      () => svc.generateContent({ prompt: "Hello" }),
      (err) => err.status === 403 && /integration is disabled/i.test(err.message)
    );
  });

  it("rejects when apiKey is missing (422)", async () => {
    const svc = geminiService({
      configProvider: async () => ({ enabled: true, apiKey: "" }),
      fetchImpl: async () => assert.fail("fetch should not be called"),
    });

    await assert.rejects(
      () => svc.generateContent({ prompt: "Hello" }),
      (err) => err.status === 422 && /key is missing/i.test(err.message)
    );
  });

  it("rejects when prompt is empty or missing (422)", async () => {
    const svc = geminiService({
      configProvider: async () => ({ enabled: true, apiKey: "AIzaSyValidKey12345678" }),
      fetchImpl: async () => assert.fail("fetch should not be called"),
    });

    await assert.rejects(
      () => svc.generateContent({ prompt: "" }),
      (err) => err.status === 422 && /prompt is required/i.test(err.message)
    );
  });

  it("posts to Gemini endpoint and returns candidate text", async () => {
    let capturedBody = null;
    let capturedUrl = "";

    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Hello! How can I assist you with GameHub today?" }],
              },
            },
          ],
        }),
      };
    };

    const svc = geminiService({
      configProvider: async () => ({ enabled: true, apiKey: "AIzaSyValidKey12345678" }),
      fetchImpl: mockFetch,
    });

    const res = await svc.generateContent({ prompt: "Hi there!" });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.text, "Hello! How can I assist you with GameHub today?");
    assert.ok(capturedUrl.includes("gemini-1.5-flash:generateContent"));
    assert.deepStrictEqual(capturedBody, {
      contents: [{ parts: [{ text: "Hi there!" }] }],
    });
  });
});
