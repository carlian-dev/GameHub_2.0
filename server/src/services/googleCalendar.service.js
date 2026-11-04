// Google Calendar service — accepted reservations become events on one
// business calendar. Auth is a service account (no user consent screen):
// sign a JWT with node:crypto, trade it for an access token, then call the
// Calendar REST API. No googleapis dependency — events create/delete is the
// only surface GameHub needs.
//
// One-time setup (see server/.env.example):
//   1. Google Cloud project → enable "Google Calendar API".
//   2. Create a service account and download a JSON key.
//   3. Share the GameHub calendar with the service-account email
//      ("Make changes to events").
//   4. Fill GOOGLE_CALENDAR_ID / _CLIENT_EMAIL / _PRIVATE_KEY in server/.env.
import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const TIME_ZONE = "Asia/Manila";
const TIMEOUT_MS = 10000;

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

// .env stores the PEM on one line with literal \n escapes.
function pemFromEnv(raw) {
  return String(raw || "").replace(/\\n/g, "\n").trim();
}

export function googleCalendarService({
  calendarId = "",
  clientEmail = "",
  privateKey = "",
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const keyPem = pemFromEnv(privateKey);
  const enabled = Boolean(calendarId && clientEmail && keyPem);
  let key = null;
  let token = "";
  let tokenExpiresAt = 0;

  function assertion() {
    const iat = Math.floor(now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(
      JSON.stringify({
        iss: clientEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat,
        exp: iat + 3600,
      })
    );
    const input = `${header}.${claims}`;
    return `${input}.${crypto
      .sign("RSA-SHA256", Buffer.from(input), key)
      .toString("base64url")}`;
  }

  async function accessToken() {
    if (token && now() < tokenExpiresAt) return token;
    // Parse lazily so a malformed key only breaks calendar calls, never startup.
    if (!key) key = crypto.createPrivateKey(keyPem);
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: assertion(),
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(
        `calendar auth failed: ${
          data.error_description || data.error || `HTTP ${res.status}`
        }`
      );
    }
    token = data.access_token;
    tokenExpiresAt = now() + Math.max(0, Number(data.expires_in || 3600) - 60) * 1000;
    return token;
  }

  async function call(method, path, body) {
    const res = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        `calendar ${method} failed: ${
          data.error?.message || `HTTP ${res.status}`
        }`
      );
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function eventBody(r) {
    return {
      summary: `GameHub · ${r.tableName || "Table"} — ${r.customerName || "Reservation"}`,
      description: [
        `Reservation ${r.ref || ""}`.trim(),
        `Table: ${r.tableName || "—"}`,
        `Customer: ${r.customerName || "—"}`,
        `Email: ${r.customerEmail || "—"}`,
        `Contact: ${r.contactNumber || "—"}`,
        `Duration: ${r.durationMinutes || 0} min`,
      ].join("\n"),
      // UTC instants; timeZone is what the calendar shows the event in.
      start: { dateTime: new Date(r.startTime).toISOString(), timeZone: TIME_ZONE },
      end: { dateTime: new Date(r.endTime).toISOString(), timeZone: TIME_ZONE },
    };
  }

  return {
    enabled,

    /** Create the event for an accepted reservation; returns its event id. */
    async createReservationEvent(reservation) {
      if (!enabled) return "";
      const data = await call(
        "POST",
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        eventBody(reservation)
      );
      return data.id || "";
    },

    /** Remove the event when a reservation is cancelled (404 = already gone). */
    async deleteReservationEvent(eventId) {
      if (!enabled || !eventId) return false;
      try {
        await call(
          "DELETE",
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
        );
      } catch (e) {
        if (e.status === 404 || e.status === 410) return false;
        throw e;
      }
      return true;
    },
  };
}
