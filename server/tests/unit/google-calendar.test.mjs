// Unit tests for the Google Calendar service (service-account JWT + events).
// No network: fetchImpl is a fake that records calls.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { googleCalendarService } from "../../src/services/googleCalendar.service.js";

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CAL_ID = "gamehub@group.calendar.google.com";
const EMAIL = "gamehub-sync@project.iam.gserviceaccount.com";

const reservation = {
  ref: "RS-20261105-ABCD",
  tableName: "Table 3",
  customerName: "Maria Cruz",
  contactNumber: "09171234567",
  startTime: new Date("2026-11-05T11:00:00Z"), // 19:00 Manila
  endTime: new Date("2026-11-05T13:00:00Z"),
  durationMinutes: 120,
};

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeFetch(handlers = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes("oauth2.googleapis.com/token")) {
      return jsonRes(200, { access_token: "tok-1", expires_in: 3600 });
    }
    if (opts.method === "DELETE") return handlers.delete || jsonRes(204, {});
    if (opts.method === "POST") return handlers.post || jsonRes(200, { id: "evt-1" });
    return jsonRes(500, { error: { message: "unexpected call" } });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function service(fetchImpl, overrides = {}) {
  return googleCalendarService({
    calendarId: CAL_ID,
    clientEmail: EMAIL,
    privateKey: PEM,
    fetchImpl,
    ...overrides,
  });
}

describe("googleCalendarService", () => {
  it("is disabled (and silent) without calendar env", async () => {
    const fetchImpl = fakeFetch();
    const svc = googleCalendarService({ fetchImpl });
    assert.equal(svc.enabled, false);
    assert.equal(await svc.createReservationEvent(reservation), "");
    assert.equal(await svc.deleteReservationEvent("evt-1"), false);
    assert.equal(fetchImpl.calls.length, 0);
  });

  it("trades a signed assertion for a token, then creates the event", async () => {
    const fetchImpl = fakeFetch();
    const svc = service(fetchImpl);

    assert.equal(await svc.createReservationEvent(reservation), "evt-1");
    assert.equal(fetchImpl.calls.length, 2);

    const auth = fetchImpl.calls[0];
    assert.equal(auth.opts.method, "POST");
    const form = new URLSearchParams(auth.opts.body);
    assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    const jwt = form.get("assertion");
    assert.equal(jwt.split(".").length, 3);
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    assert.equal(claims.iss, EMAIL);
    assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
    assert.ok(String(claims.scope).includes("calendar.events"));

    const create = fetchImpl.calls[1];
    assert.equal(
      create.url,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL_ID)}/events`
    );
    assert.equal(create.opts.headers.Authorization, "Bearer tok-1");
    const body = JSON.parse(create.opts.body);
    assert.match(body.summary, /Table 3/);
    assert.match(body.summary, /Maria Cruz/);
    assert.match(body.description, /RS-20261105-ABCD/);
    assert.match(body.description, /09171234567/);
    assert.equal(body.start.dateTime, "2026-11-05T11:00:00.000Z");
    assert.equal(body.end.dateTime, "2026-11-05T13:00:00.000Z");
    assert.equal(body.start.timeZone, "Asia/Manila");
    assert.equal(body.end.timeZone, "Asia/Manila");
  });

  it("reuses the access token across calls", async () => {
    const fetchImpl = fakeFetch();
    const svc = service(fetchImpl);
    await svc.createReservationEvent(reservation);
    await svc.createReservationEvent(reservation);
    assert.equal(fetchImpl.calls.length, 3);
    assert.equal(
      fetchImpl.calls.filter((c) => c.url.includes("oauth2.googleapis.com")).length,
      1
    );
  });

  it("accepts a PEM stored with literal \\n escapes", async () => {
    const fetchImpl = fakeFetch();
    const svc = service(fetchImpl, { privateKey: PEM.replace(/\n/g, "\\n") });
    assert.equal(svc.enabled, true);
    assert.equal(await svc.createReservationEvent(reservation), "evt-1");
  });

  it("deletes the event and treats 404 as already gone", async () => {
    const ok = service(fakeFetch());
    assert.equal(await ok.deleteReservationEvent("evt-1"), true);

    const missing = service(
      fakeFetch({ delete: jsonRes(404, { error: { message: "Not Found" } }) })
    );
    assert.equal(await missing.deleteReservationEvent("evt-1"), false);
  });

  it("surfaces API failures so the caller can log them", async () => {
    const svc = service(
      fakeFetch({ post: jsonRes(403, { error: { message: "forbidden" } }) })
    );
    await assert.rejects(() => svc.createReservationEvent(reservation), /forbidden/);
  });
});
