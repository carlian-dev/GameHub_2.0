// Provider-side validation of API integration credentials (Settings > API).
//
// Every credential the super administrator adds or replaces is proved against
// the service that issues it BEFORE it is stored. A credential the provider
// rejects is never written to the settings document or to server/.env; the
// caller receives HTTP 422 with the provider's own reason, which the settings
// card shows under the field and in a toast.
//
// Rules:
//   - credential rejected by the provider -> 422 "{Integration} ... is not valid"
//   - provider unreachable / rate limited  -> 502 "could not verify ... not saved"
//   - credential that no provider can check on its own (a reCAPTCHA site key or
//     secret, a calendar ID without its service account) is reported as
//     unchecked with a note instead of being blocked.
//
// The real fetch is injected so unit tests never touch the network.
import crypto from "node:crypto";
import { HttpError } from "../utils/HttpError.js";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_TOTAL_BUDGET_MS = 9000;

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
// Any registered redirect URI would do; Google only compares it against the
// project's list. A real, public host is required: a reserved TLD (".invalid")
// makes Google answer its generic OAuth policy page instead of naming the
// client, which would make the check useless.
const PROBE_REDIRECT_URI = "https://example.com/oauth2/key-check";

// Providers sometimes quote a masked copy of the key they received. Strip
// token-shaped text so no part of a credential can reach the UI, an audit row,
// or a log line.
const TOKEN_PATTERNS = [
  /\bAIza[0-9A-Za-z_*-]{8,}/g,
  /\b6L[a-zA-Z0-9_*-]{20,}/g,
];

function scrub(text) {
  let out = String(text || "");
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

/** Scrub + shorten provider text before it is echoed to the settings UI. */
function detail(value, max = 180) {
  const text = scrub(value)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function invalid(message) {
  return new HttpError(422, message);
}

function unverified(provider, reason) {
  const suffix = reason ? ` (${detail(reason)})` : "";
  return new HttpError(
    502,
    `${provider} could not verify this credential${suffix}. Nothing was saved — try again.`
  );
}

function ok(provider, credentials = [], notes = []) {
  return { provider, credentials, notes };
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

/** Read a header from a fetch response without assuming a full Headers object. */
function headerValue(res, name) {
  if (!res || !res.headers) return "";
  if (typeof res.headers.get === "function") return String(res.headers.get(name) || "");
  return String(res.headers[name] || "");
}

/**
 * Google's OAuth endpoint reports failures by redirecting to
 * `/signin/oauth/error?authError=<base64>`. Decode it so "invalid_client" can be
 * told apart from "redirect_uri_mismatch" (a client that does exist).
 */
function googleAuthError(location) {
  const raw = String(location || "");
  const match = /[?&]authError=([^&]+)/.exec(raw);
  if (!match) return "";
  try {
    return Buffer.from(decodeURIComponent(match[1]), "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** Trim + de-escape a service-account PEM that was pasted from .env or JSON. */
function pemFromValue(raw) {
  return String(raw || "").replace(/\\n/g, "\n").trim();
}

export function integrationValidationService({
  fetchImpl = typeof fetch === "function" ? fetch : null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  // Whole-check budget so a slow provider can never outlive the browser's
  // request timeout (Frontend/js/api.js) and hide the result of a rejected key.
  totalBudgetMs = DEFAULT_TOTAL_BUDGET_MS,
  now = () => Date.now(),
} = {}) {
  /**
   * One request with a hard timeout. `as = "text"` is used for endpoints that
   * answer with HTML (Google's OAuth error page); JSON bodies never throw.
   * `deadline` bounds the whole check, not just this request.
   */
  async function request(provider, url, options = {}, { as = "json", deadline = 0 } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new HttpError(
        503,
        `${provider} verification is unavailable in this runtime; nothing was saved.`
      );
    }
    const remaining = deadline ? deadline - now() : timeoutMs;
    if (remaining <= 0) throw unverified(provider, "the check took too long");
    const ms = Math.max(500, Math.min(timeoutMs, remaining));
    const signal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(ms)
        : undefined;
    let res;
    try {
      res = await fetchImpl(url, { ...options, ...(signal ? { signal } : {}) });
    } catch {
      // Transport errors can echo the URL, so never forward the raw message.
      throw unverified(provider, "the provider is unreachable");
    }
    let body = null;
    try {
      body = as === "text" ? await res.text() : await res.json();
    } catch {
      body = null;
    }
    return { res, body };
  }

  // ---- Google reCAPTCHA: Google cannot judge a key on its own ----
  // `siteverify` answers "invalid-input-response" for ANY secret when the token
  // is fake, and the anchor/challenge endpoints render identically for a bogus
  // site key. Both values therefore stay unchecked (the secret is proven by the
  // first real visitor check, and a wrong one makes that check fail loudly).
  async function verifyRecaptcha(changed, values) {
    const provider = "Google reCAPTCHA";
    const notes = [];
    if (changed.includes("siteKey") && values.siteKey) {
      notes.push(
        "Google can only confirm a site key in a visitor's browser, so it was saved without a live check."
      );
    }
    if (changed.includes("secretKey") && values.secretKey) {
      notes.push(
        "Google only answers for a real visitor token, never for a secret on its own, so it was saved without a live check — the next completed check will prove it."
      );
    }
    return ok(provider, [], notes);
  }

  // ---- Google Maps: Geocoding with the key ----
  async function verifyGoogleMaps(changed, values, deadline) {
    const provider = "Google Maps";
    if (!changed.includes("apiKey") || !values.apiKey) return ok(provider);

    const url = `${GEOCODE_URL}?address=Manila&key=${encodeURIComponent(values.apiKey)}`;
    const { res, body } = await request(provider, url, { method: "GET" }, { deadline });
    if (!res.ok) throw unverified(provider, `HTTP ${res.status}`);

    const status = String(body?.status || "");
    const message = String(body?.error_message || "");
    if (status === "OK" || status === "ZERO_RESULTS") {
      return ok(provider, ["apiKey"]);
    }
    if (status === "REQUEST_DENIED") {
      if (/invalid|expired/i.test(message)) {
        throw invalid(
          `Google Maps API key is not valid${
            message ? ` — Google: ${detail(message)}` : ""
          }. Nothing was saved.`
        );
      }
      // A real key whose project/key is not opened to the Geocoding API (or is
      // restricted to browser referrers): Google recognised the key itself, so
      // keep it and say what is still missing instead of blocking the save.
      return ok(provider, ["apiKey"], [
        `Google recognised the key, but the Geocoding check was refused${
          message ? ` (${detail(message)})` : ""
        }. The landing page uses the Maps JavaScript API — make sure the key allows it.`,
      ]);
    }
    throw unverified(provider, message || status || `HTTP ${res.status}`);
  }

  // ---- Google sign-in: does the OAuth client exist? ----
  async function verifyGoogleAuth(changed, values, deadline) {
    const provider = "Google";
    if (!changed.includes("clientId") || !values.clientId) return ok(provider);

    const query = new URLSearchParams({
      client_id: values.clientId,
      redirect_uri: PROBE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
    });
    const { res, body } = await request(
      provider,
      `${GOOGLE_AUTH_URL}?${query.toString()}`,
      // Never follow the redirect: Google names the problem in the Location
      // header (authError), which is exactly what proves or disproves the ID.
      { method: "GET", redirect: "manual" },
      { as: "text", deadline }
    );

    const location = headerValue(res, "location");
    const failure = googleAuthError(location);
    const text = `${String(body || "")} ${failure}`;

    if (/invalid_client|deleted_client|OAuth client was not found/i.test(text)) {
      throw invalid(
        "Google OAuth Client ID is not valid — Google does not recognise this client. Nothing was saved."
      );
    }
    if (location.includes("/signin/oauth/error")) {
      // Any other named OAuth error still comes from a client Google knows:
      // a redirect URI that is not registered, a scope the client may not ask
      // for, consent refused by the viewer itself.
      if (
        /redirect_uri_mismatch|restricted_client|access_denied|invalid_scope|login_required|consent_required|interaction_required/i.test(
          failure
        )
      ) {
        return ok(provider, ["clientId"]);
      }
      throw unverified(provider, failure || `HTTP ${res.status}`);
    }
    if (res.status < 400) return ok(provider, ["clientId"]);
    throw unverified(provider, `HTTP ${res.status}`);
  }

  // ---- Google Calendar: service account JWT + a read from the calendar ----
  async function verifyGoogleCalendar(changed, values, deadline) {
    const provider = "Google Calendar";
    const notes = [];
    const { calendarId, clientEmail, privateKey } = values;
    if (!calendarId || !clientEmail || !privateKey) {
      notes.push(
        "Google Calendar is checked automatically once the calendar ID, service account email and private key are all saved."
      );
      return ok(provider, [], notes);
    }

    let keyObject;
    try {
      keyObject = crypto.createPrivateKey(pemFromValue(privateKey));
    } catch {
      throw invalid(
        "Google service account private key is not a valid PEM key. Nothing was saved."
      );
    }

    const issuedAt = Math.floor(now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(
      JSON.stringify({
        iss: clientEmail,
        scope: GOOGLE_CALENDAR_SCOPE,
        aud: GOOGLE_TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + 3600,
      })
    );
    const signingInput = `${header}.${claims}`;
    const assertion = `${signingInput}.${crypto
      .sign("RSA-SHA256", Buffer.from(signingInput), keyObject)
      .toString("base64url")}`;

    const { res: tokenRes, body: tokenBody } = await request(
      provider,
      GOOGLE_TOKEN_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
      },
      { deadline }
    );
    const token = tokenBody && tokenBody.access_token;
    if (!tokenRes.ok || !token) {
      if (tokenRes.status >= 500) {
        throw unverified(provider, `HTTP ${tokenRes.status}`);
      }
      const reason =
        (tokenBody && (tokenBody.error_description || tokenBody.error)) ||
        `HTTP ${tokenRes.status}`;
      throw invalid(
        `Google Calendar service account is not valid — Google rejected the key pair: ${detail(
          reason
        )}. Nothing was saved.`
      );
    }

    const calendarUrl =
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}` +
      "/events?maxResults=1";
    const { res: calRes, body: calBody } = await request(
      provider,
      calendarUrl,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      { deadline }
    );
    if (calRes.ok) {
      return ok(provider, ["calendarId", "clientEmail", "privateKey"], notes);
    }

    const message = String(calBody?.error?.message || "");
    if (calRes.status >= 500) throw unverified(provider, message || `HTTP ${calRes.status}`);
    if (calRes.status === 404) {
      throw invalid(
        `Google Calendar ID is not valid or is not shared with ${clientEmail}${
          message ? ` — Google: ${detail(message)}` : ""
        }. Nothing was saved.`
      );
    }
    if (
      calRes.status === 403 &&
      /has not been used in project|is disabled|enable it by visiting|not been enabled/i.test(
        message
      )
    ) {
      // The key pair is genuine; the project just has not enabled the Calendar
      // API yet. Keep the credentials and say what still has to be done.
      return ok(provider, ["calendarId", "clientEmail", "privateKey"], [
        `The service account is valid, but the Google Calendar API is not enabled on its project${
          message ? ` (${detail(message)})` : ""
        }.`,
      ]);
    }
    throw invalid(
      `Google Calendar access was refused for ${clientEmail}${
        message ? ` — Google: ${detail(message)}` : ""
      }. Nothing was saved.`
    );
  }

  return {
    /**
     * Prove the credentials being saved against their provider.
     * `changed` lists the credential names receiving a non-empty value;
     * `values` are the plaintext values that will be in effect afterwards.
     * Returns { provider, credentials, notes }; throws HttpError when rejected.
     */
    async verify(key, { changed = [], values = {} } = {}) {
      const names = Array.isArray(changed) ? changed.filter(Boolean) : [];
      if (names.length === 0) return ok("");
      const input = values && typeof values === "object" ? values : {};
      // One deadline for every provider call in this save.
      const deadline = totalBudgetMs > 0 ? now() + totalBudgetMs : 0;

      switch (key) {
        case "recaptcha":
          return verifyRecaptcha(names, input, deadline);
        case "googleMaps":
          return verifyGoogleMaps(names, input, deadline);
        case "googleAuth":
          return verifyGoogleAuth(names, input, deadline);
        case "googleCalendar":
          return verifyGoogleCalendar(names, input, deadline);
        default:
          return ok("");
      }
    },
  };
}
