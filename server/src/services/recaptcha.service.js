// Google reCAPTCHA v2 (checkbox) verification.
// The admin enables it in Settings > API; when disabled every call is a no-op,
// so login/registration/reservations keep working without site keys.
//
// Policy:
// - Enabled + fully configured: the form's token is verified with Google.
// - Missing token: 422, so the browser can ask the guest to tick the box.
// - Google unreachable / non-2xx: 503 (fail closed, the caller may retry).
// - Enabled but credentials are incomplete (for example a lost encryption
//   key): verification is skipped with a warning instead of locking every
//   account out of the app. The admin settings card shows the missing value.
import { HttpError } from "../utils/HttpError.js";

const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TOKEN_LENGTH = 4096;

export function recaptchaService({
  configProvider,
  fetchImpl = typeof fetch === "function" ? fetch : null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  async function readConfig() {
    if (typeof configProvider !== "function") {
      return { enabled: false, siteKey: "", secretKey: "" };
    }
    const cfg = await configProvider();
    return cfg && typeof cfg === "object"
      ? cfg
      : { enabled: false, siteKey: "", secretKey: "" };
  }

  return {
    /**
     * Verify a token when the integration is enabled.
     * Returns { ok: true, skipped: true } when it is off or not fully configured.
     */
    async verify(token, remoteIp = "") {
      let cfg;
      try {
        cfg = await readConfig();
      } catch {
        // The settings read failed: fail closed for public form submissions.
        throw new HttpError(
          503,
          "reCAPTCHA is temporarily unavailable. Please try again."
        );
      }

      if (!cfg.enabled) return { ok: true, skipped: true };
      if (!cfg.siteKey || !cfg.secretKey) {
        // Misconfiguration must not lock every user out of login/booking.
        // eslint-disable-next-line no-console
        console.warn(
          "[gamehub] reCAPTCHA is enabled but site/secret key is missing; skipping verification"
        );
        return { ok: true, skipped: true };
      }

      const response = String(token || "").trim();
      if (!response) {
        throw new HttpError(422, "Please complete the reCAPTCHA check.");
      }
      if (response.length > MAX_TOKEN_LENGTH) {
        throw new HttpError(422, "Please complete the reCAPTCHA check.");
      }

      const body = new URLSearchParams({
        secret: cfg.secretKey,
        response,
      });
      const ip = String(remoteIp || "").trim();
      if (ip) body.set("remoteip", ip);

      let payload;
      let timer = null;
      try {
        if (!fetchImpl) throw new Error("fetch is unavailable");
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetchImpl(VERIFY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`siteverify HTTP ${res.status}`);
        payload = await res.json();
      } catch {
        throw new HttpError(
          503,
          "reCAPTCHA is temporarily unavailable. Please try again."
        );
      } finally {
        if (timer) clearTimeout(timer);
      }

      if (!payload || payload.success !== true) {
        throw new HttpError(
          403,
          "reCAPTCHA verification failed. Please try again."
        );
      }

      return { ok: true, skipped: false };
    },
  };
}
