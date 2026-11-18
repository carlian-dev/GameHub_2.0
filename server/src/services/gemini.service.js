// Google Gemini AI service.
// Supports API key verification, configuration lookup, and content generation.
// Credentials and on/off activation are managed via the settings service.
import { HttpError } from "../utils/HttpError.js";

const DEFAULT_MODEL = "gemini-1.5-flash";
const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export function geminiService({
  configProvider,
  fetchImpl = typeof fetch === "function" ? fetch : null,
} = {}) {
  async function readConfig() {
    if (typeof configProvider !== "function") {
      return { enabled: false, apiKey: "" };
    }
    const cfg = await configProvider();
    return cfg && typeof cfg === "object"
      ? cfg
      : { enabled: false, apiKey: "" };
  }

  return {
    /** Return current effective Gemini configuration (server-only). */
    async getConfig() {
      return readConfig();
    },

    /**
     * Test an API key by fetching the list of models from Google Gemini API.
     * Uses apiKeyOverride if provided, otherwise the configured key.
     * Returns { ok: true, modelsCount } or throws an error.
     */
    async testConnection(apiKeyOverride = "") {
      const cfg = await readConfig();
      const apiKey = String(apiKeyOverride || cfg.apiKey || "").trim();

      if (!apiKey) {
        throw new HttpError(422, "No Gemini API key configured to test.");
      }

      if (!fetchImpl) {
        throw new HttpError(500, "fetch is not available in the runtime environment.");
      }

      const url = `${API_BASE_URL}/models?key=${encodeURIComponent(apiKey)}`;
      let res;
      try {
        res = await fetchImpl(url, { method: "GET" });
      } catch (err) {
        throw new HttpError(
          503,
          `Could not reach Google Gemini API: ${err && err.message ? err.message : String(err)}`
        );
      }

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const errorMsg =
          data && data.error && data.error.message
            ? data.error.message
            : `Google Gemini API returned HTTP status ${res.status}`;
        const status = res.status === 400 || res.status === 403 ? 422 : 502;
        throw new HttpError(status, `Gemini API test failed: ${errorMsg}`);
      }

      const modelsCount = Array.isArray(data?.models) ? data.models.length : 0;
      return {
        ok: true,
        modelsCount,
      };
    },

    /**
     * Generate content with Gemini. Requires the integration to be enabled.
     */
    async generateContent({ prompt, model = DEFAULT_MODEL } = {}) {
      const cfg = await readConfig();
      if (!cfg.enabled) {
        throw new HttpError(403, "Google Gemini AI integration is disabled.");
      }
      if (!cfg.apiKey) {
        throw new HttpError(422, "Google Gemini AI API key is missing.");
      }
      if (!prompt || typeof prompt !== "string") {
        throw new HttpError(422, "prompt is required and must be a string.");
      }

      if (!fetchImpl) {
        throw new HttpError(500, "fetch is not available in the runtime environment.");
      }

      const url = `${API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          data && data.error && data.error.message
            ? data.error.message
            : `Gemini API error (HTTP ${res.status})`;
        throw new HttpError(502, message);
      }

      const text =
        data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      return {
        ok: true,
        text,
        model,
        raw: data,
      };
    },
  };
}
