// Unit tests for the provider-side credential check used by Settings > API.
// The real fetch is replaced, so nothing here touches the network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { integrationValidationService } from "../../src/services/integrationValidation.service.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => assert.fail("this endpoint answers with HTML"),
  };
}

/** Google answers OAuth failures with a 302 to /signin/oauth/error?authError=… */
function googleRedirect(location) {
  return {
    ok: false,
    status: 302,
    text: async () => "",
    json: async () => assert.fail("a redirect has no body"),
    headers: { get: (name) => (name.toLowerCase() === "location" ? location : null) },
  };
}

function authErrorLocation(message) {
  return `https://accounts.google.com/signin/oauth/error?authError=${Buffer.from(
    message
  ).toString("base64")}`;
}

function service(handler) {
  return integrationValidationService({ fetchImpl: handler, timeoutMs: 1000 });
}

const RSA_PEM = crypto
  .generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  })
  .privateKey;

describe("integrationValidation gemini", () => {
  it("accepts a key that Google lists models for", async () => {
    let seen = "";
    const svc = service(async (url) => {
      seen = String(url);
      return jsonResponse(200, { models: [{ name: "models/gemini-1.5-flash" }] });
    });

    const result = await svc.verify("gemini", {
      changed: ["apiKey"],
      values: { apiKey: "AIzaSyValidGeminiKey1234567890" },
    });

    assert.strictEqual(result.provider, "Google Gemini");
    assert.deepStrictEqual(result.credentials, ["apiKey"]);
    assert.match(seen, /generativelanguage\.googleapis\.com/);
  });

  it("rejects a key Google says is not valid", async () => {
    const svc = service(async () =>
      jsonResponse(400, {
        error: {
          code: 400,
          message: "API key not valid. Please pass a valid API key.",
          status: "INVALID_ARGUMENT",
          details: [{ reason: "API_KEY_INVALID" }],
        },
      })
    );

    await assert.rejects(
      () =>
        svc.verify("gemini", {
          changed: ["apiKey"],
          values: { apiKey: "AIzaSyWrongKey12345678901234567890" },
        }),
      (err) => err.status === 422 && /not valid/i.test(err.message)
    );
  });

  it("fails closed when Google is unreachable", async () => {
    const svc = service(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });

    await assert.rejects(
      () =>
        svc.verify("gemini", {
          changed: ["apiKey"],
          values: { apiKey: "AIzaSyUnreachable123456789012345" },
        }),
      (err) =>
        err.status === 502 &&
        /could not verify/i.test(err.message) &&
        !/getaddrinfo/.test(err.message)
    );
  });
});

describe("integrationValidation paymongo", () => {
  it("accepts a secret key that can read payments", async () => {
    let headers = {};
    const svc = service(async (url, options) => {
      headers = options.headers;
      return jsonResponse(200, { data: [] });
    });

    const result = await svc.verify("paymongo", {
      changed: ["secretKey"],
      values: { secretKey: "sk_test_valid_key_12345" },
    });

    assert.deepStrictEqual(result.credentials, ["secretKey"]);
    assert.match(String(headers.Authorization), /^Basic /);
  });

  it("rejects a key PayMongo refuses to authenticate", async () => {
    const svc = service(async () =>
      jsonResponse(401, {
        errors: [
          {
            code: "authentication_failed",
            detail:
              "API key sk_test_thi*****************goKey123 does not exist.",
          },
        ],
      })
    );

    await assert.rejects(
      () =>
        svc.verify("paymongo", {
          changed: ["secretKey"],
          values: { secretKey: "sk_test_broken_key_12345" },
        }),
      (err) =>
        err.status === 422 &&
        /not valid/i.test(err.message) &&
        // Never echo any part of the submitted key back to the browser.
        !/sk_test_thi|goKey123/.test(err.message) &&
        /\[redacted\]/.test(err.message)
    );
  });

  it("does not call PayMongo for a webhook secret it cannot prove", async () => {
    const svc = service(async () => assert.fail("no request expected"));
    const result = await svc.verify("paymongo", {
      changed: ["webhookSecret"],
      values: { webhookSecret: "whsec_1234567890" },
    });

    assert.deepStrictEqual(result.credentials, []);
    assert.strictEqual(result.notes.length, 1);
  });
});

describe("integrationValidation recaptcha", () => {
  it("saves a secret with a note because Google cannot judge one alone", async () => {
    const svc = service(async () => assert.fail("no request expected"));
    const result = await svc.verify("recaptcha", {
      changed: ["secretKey"],
      values: { secretKey: "6Lc-secret-key-1234567890123456789012" },
    });

    assert.deepStrictEqual(result.credentials, []);
    assert.match(result.notes[0], /real visitor token/i);
  });

  it("only notes a site key because Google validates it in the browser", async () => {
    const svc = service(async () => assert.fail("no request expected"));
    const result = await svc.verify("recaptcha", {
      changed: ["siteKey"],
      values: { siteKey: "6Lc-site-key-1234567890" },
    });
    assert.deepStrictEqual(result.credentials, []);
    assert.match(result.notes[0], /visitor's browser/i);
  });
});

describe("integrationValidation google maps", () => {
  it("accepts a key Google geocodes with", async () => {
    const svc = service(async () => jsonResponse(200, { status: "OK", results: [] }));
    const result = await svc.verify("googleMaps", {
      changed: ["apiKey"],
      values: { apiKey: "AIzaSyMapsKey1234567890" },
    });
    assert.deepStrictEqual(result.credentials, ["apiKey"]);
  });

  it("rejects a key Google calls invalid", async () => {
    const svc = service(async () =>
      jsonResponse(200, {
        status: "REQUEST_DENIED",
        error_message: "The provided API key is invalid.",
      })
    );

    await assert.rejects(
      () =>
        svc.verify("googleMaps", {
          changed: ["apiKey"],
          values: { apiKey: "AIzaSyNope1234567890" },
        }),
      (err) => err.status === 422 && /not valid/i.test(err.message)
    );
  });

  it("keeps a real key whose project lacks the Geocoding API, with a note", async () => {
    const svc = service(async () =>
      jsonResponse(200, {
        status: "REQUEST_DENIED",
        error_message: "This API project is not authorized to use this API.",
      })
    );

    const result = await svc.verify("googleMaps", {
      changed: ["apiKey"],
      values: { apiKey: "AIzaSyMapsKey1234567890" },
    });

    assert.deepStrictEqual(result.credentials, ["apiKey"]);
    assert.match(result.notes[0], /Maps JavaScript API/i);
  });
});

describe("integrationValidation google sign-in client id", () => {
  it("accepts a client Google redirects or greets with a login page", async () => {
    const svc = service(async () => textResponse(302, ""));
    const result = await svc.verify("googleAuth", {
      changed: ["clientId"],
      values: { clientId: "12345-abc.apps.googleusercontent.com" },
    });
    assert.deepStrictEqual(result.credentials, ["clientId"]);
  });

  it("accepts a client whose redirect URI is simply not registered", async () => {
    const svc = service(async () =>
      googleRedirect(
        authErrorLocation("redirect_uri_mismatch")
      )
    );
    const result = await svc.verify("googleAuth", {
      changed: ["clientId"],
      values: { clientId: "12345-abc.apps.googleusercontent.com" },
    });
    assert.deepStrictEqual(result.credentials, ["clientId"]);
  });

  it("accepts a client that merely does not allow the probe scopes", async () => {
    const svc = service(async () =>
      googleRedirect(
        authErrorLocation("restricted_client:Unregistered scope(s) in the request: profile")
      )
    );
    const result = await svc.verify("googleAuth", {
      changed: ["clientId"],
      values: { clientId: "12345-abc.apps.googleusercontent.com" },
    });
    assert.deepStrictEqual(result.credentials, ["clientId"]);
  });

  it("rejects a client Google does not recognise, even inside a redirect", async () => {
    const svc = service(async () =>
      googleRedirect(
        authErrorLocation("invalid_client:The OAuth client was not found.")
      )
    );

    await assert.rejects(
      () =>
        svc.verify("googleAuth", {
          changed: ["clientId"],
          values: { clientId: "99999-nope.apps.googleusercontent.com" },
        }),
      (err) => err.status === 422 && /not valid/i.test(err.message)
    );
  });

  it("rejects a client Google does not recognise", async () => {
    const svc = service(async () =>
      textResponse(
        400,
        "Error 400: invalid_client. The OAuth client was not found."
      )
    );

    await assert.rejects(
      () =>
        svc.verify("googleAuth", {
          changed: ["clientId"],
          values: { clientId: "99999-nope.apps.googleusercontent.com" },
        }),
      (err) => err.status === 422 && /not valid/i.test(err.message)
    );
  });
});

describe("integrationValidation google calendar", () => {
  const values = () => ({
    calendarId: "gamehub@group.calendar.google.com",
    clientEmail: "gamehub@project.iam.gserviceaccount.com",
    privateKey: RSA_PEM,
  });

  it("waits until all three service-account values exist", async () => {
    const svc = service(async () => assert.fail("no request expected"));
    const result = await svc.verify("googleCalendar", {
      changed: ["calendarId"],
      values: { calendarId: "gamehub@group.calendar.google.com" },
    });
    assert.deepStrictEqual(result.credentials, []);
    assert.match(result.notes[0], /checked automatically/i);
  });

  it("rejects a private key that is not a PEM key", async () => {
    const svc = service(async () => assert.fail("no request expected"));
    await assert.rejects(
      () =>
        svc.verify("googleCalendar", {
          changed: ["privateKey"],
          values: { ...values(), privateKey: "not-a-key" },
        }),
      (err) => err.status === 422 && /PEM/i.test(err.message)
    );
  });

  it("rejects a key pair Google refuses to exchange", async () => {
    const svc = service(async () =>
      jsonResponse(400, {
        error: "invalid_grant",
        error_description: "Invalid JWT Signature.",
      })
    );

    await assert.rejects(
      () =>
        svc.verify("googleCalendar", {
          changed: ["privateKey"],
          values: values(),
        }),
      (err) => err.status === 422 && /not valid/i.test(err.message)
    );
  });

  it("accepts the triple when the calendar can be read", async () => {
    const calls = [];
    const svc = service(async (url) => {
      calls.push(String(url));
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return jsonResponse(200, { access_token: "token-1", expires_in: 3600 });
      }
      return jsonResponse(200, { items: [] });
    });

    const result = await svc.verify("googleCalendar", {
      changed: ["privateKey"],
      values: values(),
    });

    assert.deepStrictEqual(result.credentials, [
      "calendarId",
      "clientEmail",
      "privateKey",
    ]);
    assert.strictEqual(calls.length, 2);
    assert.match(calls[1], /\/calendars\/.*\/events/);
  });

  it("rejects a calendar the service account cannot see", async () => {
    const svc = service(async (url) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return jsonResponse(200, { access_token: "token-1", expires_in: 3600 });
      }
      return jsonResponse(404, { error: { message: "Not Found" } });
    });

    await assert.rejects(
      () =>
        svc.verify("googleCalendar", {
          changed: ["calendarId"],
          values: values(),
        }),
      (err) =>
        err.status === 422 && /not valid or is not shared/i.test(err.message)
    );
  });

  it("gives up before the browser request timeout", async () => {
    let clock = 0;
    const svc = integrationValidationService({
      fetchImpl: async (url) => {
        clock += 5000;
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return jsonResponse(200, { access_token: "token-1", expires_in: 3600 });
        }
        return jsonResponse(200, { items: [] });
      },
      now: () => clock,
      timeoutMs: 1000,
      totalBudgetMs: 1000,
    });

    await assert.rejects(
      () =>
        svc.verify("googleCalendar", {
          changed: ["calendarId"],
          values: values(),
        }),
      (err) => err.status === 502 && /took too long/i.test(err.message)
    );
  });
});

describe("integrationValidation scope", () => {
  it("does nothing for integrations without checkable credentials", async () => {
    const svc = service(async () => assert.fail("no request expected"));
    const result = await svc.verify("receiptPdf", {
      changed: ["anything"],
      values: { anything: "x" },
    });
    assert.deepStrictEqual(result, { provider: "", credentials: [], notes: [] });
  });

  it("does nothing when no credential is being set", async () => {
    const svc = service(async () => assert.fail("no request expected"));
    const result = await svc.verify("gemini", { changed: [], values: {} });
    assert.deepStrictEqual(result.credentials, []);
  });
});
