// Unit tests for settings masking.
// migration.md §16: settings masking/required-credential rules.
// migration.md §13.6: 8 bullets plus a safe 4-char hint.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { maskValue, googleClientIdHint } from "../../src/utils/mask.js";
import { settingsService } from "../../src/services/settings.service.js";

/** Minimal stand-in for twoFactorService: accepts one known code. */
function twoFactorStub(code = "123456") {
  return {
    async verifyStepUp(userId, submitted) {
      if (String(submitted).replace(/\s+/g, "") !== code) {
        const err = new Error("invalid authenticator code");
        err.status = 422;
        throw err;
      }
      return true;
    },
  };
}

describe("maskValue", () => {
  it("returns empty for empty value", () => {
    assert.strictEqual(maskValue(""), "");
  });

  it("returns 8 bullets for short value (<= 8 chars)", () => {
    assert.strictEqual(maskValue("abc"), "••••••••");
    assert.strictEqual(maskValue("12345678"), "••••••••");
  });

  it("returns 8 bullets + hint for long value (> 8 chars)", () => {
    assert.strictEqual(
      maskValue("abcdefghijkl", "ijkl"),
      "••••••••ijkl"
    );
    assert.strictEqual(
      maskValue("my-secret-key-12345", "12345"),
      "••••••••12345"
    );
  });

  it("uses last4 when no hint provided", () => {
    assert.strictEqual(maskValue("abcdefghijkl"), "••••••••ijkl");
  });
});

describe("googleClientIdHint", () => {
  it("returns last 4 before .apps.googleusercontent.com", () => {
    assert.strictEqual(
      googleClientIdHint("1234567890-abcdef.apps.googleusercontent.com"),
      "cdef"
    );
    assert.strictEqual(
      googleClientIdHint("XYZ123.apps.googleusercontent.com"),
      "Z123"
    );
  });

  it("returns empty for empty value", () => {
    assert.strictEqual(googleClientIdHint(""), "");
  });

  it("returns last 4 for non-Google-ID values", () => {
    assert.strictEqual(googleClientIdHint("somelongkey1234"), "1234");
  });
});

describe("settings update role split", () => {
  // Role checks run before any DB access, so a null db is safe here.
  const svc = settingsService({
    settingsModel: { findMany: async () => ({}) },
    db: {
      collection: () => ({ findOne: async () => null, insertOne: async () => {} }),
    },
    mongoClient: null,
    googleClientIdFromEnv: "",
    googleCalendarFromEnv: {},
    settingsEncryptionKey: "",
    recaptchaFromEnv: {},
  });

  it("rejects an admin toggling enabled", async () => {
    await assert.rejects(
      () => svc.update("googleMaps", { enabled: true }, { role: "admin" }),
      (err) => err.status === 403 && /super administrator/i.test(err.message)
    );
  });

  it("rejects an admin changing credentials", async () => {
    await assert.rejects(
      () =>
        svc.update(
          "googleMaps",
          { credentials: { apiKey: "abc" } },
          { role: "admin" }
        ),
      (err) => err.status === 403 && /super administrator/i.test(err.message)
    );
  });

  it("hides credentials from the admin listing", async () => {
    const data = await svc.adminIntegrations();
    for (const integration of data.integrations) {
      assert.ok(
        !("credentials" in integration),
        `${integration.key} must not expose credentials`
      );
    }
  });

  it("returns masked credentials to the super admin listing", async () => {
    const data = await svc.superAdminIntegrations();
    const maps = data.integrations.find((i) => i.key === "googleMaps");
    assert.ok(Array.isArray(maps.credentials));
    assert.ok(
      maps.credentials.every(
        (c) => typeof c.masked === "string" && c.value === undefined
      )
    );
  });

  it("rejects a missing role", async () => {
    await assert.rejects(
      () => svc.update("googleMaps", { enabled: true }, {}),
      (err) => err.status === 403
    );
  });

  it("rejects a non-boolean enabled from a super admin", async () => {
    await assert.rejects(
      () => svc.update("googleMaps", { enabled: "yes" }, { role: "super_admin" }),
      (err) => err.status === 422 && /boolean/i.test(err.message)
    );
  });

  const guarded = settingsService({
    settingsModel: { findMany: async () => ({}) },
    db: {
      collection: () => ({ findOne: async () => null, insertOne: async () => {} }),
    },
    mongoClient: null,
    twoFactorService: twoFactorStub(),
  });

  it("requires an authenticator code when changing credentials", async () => {
    await assert.rejects(
      () =>
        guarded.update(
          "googleMaps",
          { credentials: { apiKey: "abc" } },
          { role: "super_admin", id: "super-1" }
        ),
      (err) =>
        err.status === 422 &&
        /6-digit code from your authenticator app/i.test(err.message)
    );
  });

  it("rejects an invalid authenticator code before writing", async () => {
    await assert.rejects(
      () =>
        guarded.update(
          "googleMaps",
          { credentials: { apiKey: "abc" }, code: "000000" },
          { role: "super_admin", id: "super-1" }
        ),
      (err) => err.status === 422 && /invalid authenticator code/i.test(err.message)
    );
  });
});

describe("settings env fallback", () => {
  const ENV_KEYS = [
    "RECAPTCHA_SITE_KEY",
    "RECAPTCHA_SECRET_KEY",
    "RECAPTCHA_SITE_KEY_OVERRIDE",
    "RECAPTCHA_SECRET_KEY_OVERRIDE",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_AUTH_CLIENT_ID_OVERRIDE",
  ];
  const saved = {};

  function service(docs = {}) {
    return settingsService({
      settingsModel: {
        findMany: async () => docs,
        findOne: async (key) => docs[key] || null,
      },
      db: null,
      mongoClient: null,
      googleClientIdFromEnv: "",
      googleCalendarFromEnv: {},
      settingsEncryptionKey: "",
      recaptchaFromEnv: {},
    });
  }

  function recaptchaDoc(credentials = {}, enabled = true) {
    return {
      recaptcha: {
        key: "recaptcha",
        enabled,
        credentials,
      },
    };
  }

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("uses the base env value when the settings document is empty", async () => {
    process.env.RECAPTCHA_SITE_KEY = "base-site-123456789012345678901111";
    process.env.RECAPTCHA_SECRET_KEY = "base-secret-123456789012345678901111";
    const svc = service(
      recaptchaDoc({
        siteKey: { value: "", last4: "" },
        secretKey: { value: "", last4: "" },
      })
    );

    const data = await svc.superAdminIntegrations();
    const recaptcha = data.integrations.find((i) => i.key === "recaptcha");
    const site = recaptcha.credentials.find((c) => c.name === "siteKey");
    const secret = recaptcha.credentials.find((c) => c.name === "secretKey");

    assert.strictEqual(recaptcha.enabled, true);
    assert.strictEqual(site.configured, true);
    assert.strictEqual(site.source, "env");
    assert.strictEqual(secret.source, "env");
    assert.ok(site.masked.endsWith("1111"));
  });

  it("prefers the base env value over a legacy DB value when no override exists", async () => {
    process.env.RECAPTCHA_SITE_KEY = "base-site-123456789012345678901111";
    process.env.RECAPTCHA_SECRET_KEY = "base-secret-123456789012345678901111";
    const svc = service(
      recaptchaDoc({
        siteKey: { value: "db-site-123456789012345678903333", last4: "3333" },
        secretKey: { value: "db-secret-123456789012345678903333", last4: "3333" },
      })
    );

    const data = await svc.superAdminIntegrations();
    const site = data.integrations
      .find((i) => i.key === "recaptcha")
      .credentials.find((c) => c.name === "siteKey");

    assert.strictEqual(site.source, "env");
    assert.strictEqual(site.configured, true);
    assert.ok(site.masked.endsWith("1111"));
  });

  it("prefers the override field over the DB value and base env", async () => {
    process.env.RECAPTCHA_SITE_KEY = "base-site-123456789012345678901111";
    process.env.RECAPTCHA_SECRET_KEY = "base-secret-123456789012345678901111";
    process.env.RECAPTCHA_SITE_KEY_OVERRIDE =
      "override-site-123456789012345678902222";
    const svc = service(
      recaptchaDoc({
        siteKey: { value: "db-site-123456789012345678903333", last4: "3333" },
        secretKey: { value: "db-secret-123456789012345678903333", last4: "3333" },
      })
    );

    const data = await svc.superAdminIntegrations();
    const site = data.integrations
      .find((i) => i.key === "recaptcha")
      .credentials.find((c) => c.name === "siteKey");

    assert.strictEqual(site.source, "override");
    assert.strictEqual(site.configured, true);
    assert.ok(site.masked.endsWith("2222"));
  });

  it("uses the base env Google client ID when no document exists", async () => {
    process.env.GOOGLE_CLIENT_ID = "12345-abc.apps.googleusercontent.com";
    const cfg = await service({}).googleAuthConfig();
    assert.strictEqual(cfg.enabled, true);
    assert.strictEqual(cfg.clientId, "12345-abc.apps.googleusercontent.com");
  });

  it("uses the Google client ID override when set", async () => {
    process.env.GOOGLE_CLIENT_ID = "12345-abc.apps.googleusercontent.com";
    process.env.GOOGLE_AUTH_CLIENT_ID_OVERRIDE =
      "67890-def.apps.googleusercontent.com";
    const cfg = await service({
      googleAuth: {
        key: "googleAuth",
        enabled: true,
        credentials: { clientId: { value: "", last4: "" } },
      },
    }).googleAuthConfig();
    assert.strictEqual(cfg.clientId, "67890-def.apps.googleusercontent.com");
  });
});

describe("settings update mirrors credentials to .env", () => {
  function makeDb(existing) {
    let doc = existing;
    return {
      db: {
        collection(name) {
          if (name === "settings") {
            return {
              async findOne() {
                return doc;
              },
              async findOneAndUpdate(filter, update) {
                doc = doc ? { ...doc } : { key: filter.key };
                for (const [path, value] of Object.entries(update.$set || {})) {
                  if (path.startsWith("credentials.")) {
                    doc.credentials = { ...(doc.credentials || {}) };
                    doc.credentials[path.slice("credentials.".length)] = value;
                  } else {
                    doc[path] = value;
                  }
                }
                for (const path of Object.keys(update.$unset || {})) {
                  if (path.startsWith("credentials.")) {
                    doc.credentials = { ...(doc.credentials || {}) };
                    delete doc.credentials[path.slice("credentials.".length)];
                  } else {
                    delete doc[path];
                  }
                }
                for (const [path, value] of Object.entries(
                  update.$setOnInsert || {}
                )) {
                  if (path.startsWith("credentials.")) {
                    doc.credentials = doc.credentials || {};
                    const credName = path.slice("credentials.".length);
                    if (!doc.credentials[credName]) {
                      doc.credentials[credName] = value;
                    }
                  } else if (doc[path] === undefined) {
                    doc[path] = value;
                  }
                }
                return doc;
              },
            };
          }
          if (name === "activityLogs") {
            return { async insertOne() {} };
          }
          throw new Error(`unexpected collection ${name}`);
        },
      },
    };
  }

  it("writes the matching override key after a successful save", async () => {
    const { db } = makeDb({
      key: "recaptcha",
      enabled: true,
      credentials: {
        siteKey: { value: "old-site-12345678901234567890", last4: "7890" },
        secretKey: { value: "old-secret-12345678901234567890", last4: "7890" },
      },
    });
    const persisted = [];
    const svc = settingsService({
      settingsModel: { findMany: async () => ({}), findOne: async () => null },
      db,
      mongoClient: null,
      googleClientIdFromEnv: "",
      googleCalendarFromEnv: {},
      settingsEncryptionKey: "a".repeat(64),
      recaptchaFromEnv: {},
      twoFactorService: twoFactorStub(),
      persistEnvValue: async (key, value) => {
        persisted.push([key, value]);
        process.env[key] = value;
      },
    });

    try {
      const shaped = await svc.update(
        "recaptcha",
        { credentials: { siteKey: "new-site-12345678901234567890" }, code: "123456" },
        { role: "super_admin", id: "super-1", email: "superadmin@example.com" }
      );
      assert.deepStrictEqual(persisted, [
        ["RECAPTCHA_SITE_KEY_OVERRIDE", "new-site-12345678901234567890"],
      ]);
      const site = shaped.credentials.find((c) => c.name === "siteKey");
      assert.strictEqual(site.source, "override");
      assert.strictEqual(site.configured, true);
    } finally {
      delete process.env.RECAPTCHA_SITE_KEY_OVERRIDE;
    }
  });

  it("clears the override key when the super admin clears a credential", async () => {
    const { db } = makeDb({
      key: "recaptcha",
      enabled: true,
      credentials: {
        siteKey: { value: "old-site-12345678901234567890", last4: "7890" },
        secretKey: { value: "old-secret-12345678901234567890", last4: "7890" },
      },
    });
    const persisted = [];
    const svc = settingsService({
      settingsModel: { findMany: async () => ({}), findOne: async () => null },
      db,
      mongoClient: null,
      googleClientIdFromEnv: "",
      googleCalendarFromEnv: {},
      settingsEncryptionKey: "a".repeat(64),
      recaptchaFromEnv: {},
      twoFactorService: twoFactorStub(),
      persistEnvValue: async (key, value) => {
        persisted.push([key, value]);
        process.env[key] = value;
      },
    });

    const previousBase = process.env.RECAPTCHA_SITE_KEY;
    const previousOverride = process.env.RECAPTCHA_SITE_KEY_OVERRIDE;
    delete process.env.RECAPTCHA_SITE_KEY;
    process.env.RECAPTCHA_SITE_KEY_OVERRIDE = "old-site-12345678901234567890";
    try {
      const shaped = await svc.update(
        "recaptcha",
        { credentials: { siteKey: "" }, code: "123456" },
        { role: "super_admin", id: "super-1", email: "superadmin@example.com" }
      );
      assert.deepStrictEqual(persisted, [["RECAPTCHA_SITE_KEY_OVERRIDE", ""]]);
      const site = shaped.credentials.find((c) => c.name === "siteKey");
      assert.strictEqual(site.configured, false);
      assert.strictEqual(site.source, "");
    } finally {
      if (previousBase === undefined) delete process.env.RECAPTCHA_SITE_KEY;
      else process.env.RECAPTCHA_SITE_KEY = previousBase;
      if (previousOverride === undefined) {
        delete process.env.RECAPTCHA_SITE_KEY_OVERRIDE;
      } else {
        process.env.RECAPTCHA_SITE_KEY_OVERRIDE = previousOverride;
      }
    }
  });
});

describe("export integrations", () => {
  function service(docs = {}) {
    return settingsService({
      settingsModel: { findMany: async () => docs },
      db: null,
      mongoClient: null,
    });
  }

  it("lists the PDF receipt and CSV export integrations, on by default", async () => {
    const data = await service({}).adminIntegrations();
    const receipt = data.integrations.find((i) => i.key === "receiptPdf");
    const csv = data.integrations.find((i) => i.key === "csvExport");

    assert.ok(receipt, "receiptPdf must be present in registry");
    assert.ok(csv, "csvExport must be present in registry");
    assert.strictEqual(receipt.enabled, true);
    assert.strictEqual(csv.enabled, true);
    assert.ok(!("credentials" in receipt), "admin listing must not expose credentials");
    assert.ok(!("credentials" in csv), "admin listing must not expose credentials");
  });

  it("reports the stored on/off state through exportConfig", async () => {
    assert.deepStrictEqual(await service({}).exportConfig(), {
      receiptPdf: true,
      csvExport: true,
    });

    const off = await service({
      receiptPdf: { key: "receiptPdf", enabled: false, credentials: {} },
      csvExport: { key: "csvExport", enabled: false, credentials: {} },
    }).exportConfig();
    assert.deepStrictEqual(off, { receiptPdf: false, csvExport: false });
  });
});

describe("provider validation of new credentials", () => {
  const ENV_KEYS = [
    "GOOGLE_CALENDAR_ID",
    "GOOGLE_CALENDAR_ID_OVERRIDE",
    "GOOGLE_CALENDAR_CLIENT_EMAIL",
    "GOOGLE_CALENDAR_CLIENT_EMAIL_OVERRIDE",
    "GOOGLE_CALENDAR_PRIVATE_KEY",
    "GOOGLE_CALENDAR_PRIVATE_KEY_OVERRIDE",
  ];
  const saved = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  /** Minimal settings collection that counts writes and mutates its document. */
  function trackingDb(existing = null) {
    const state = { doc: existing, writes: 0 };
    const db = {
      collection(name) {
        if (name === "settings") {
          return {
            async findOne() {
              return state.doc;
            },
            async findOneAndUpdate(filter, update) {
              state.writes += 1;
              state.doc = { ...(state.doc || { key: filter.key }) };
              for (const [path, value] of Object.entries(update.$set || {})) {
                if (path.startsWith("credentials.")) {
                  state.doc.credentials = { ...(state.doc.credentials || {}) };
                  state.doc.credentials[path.slice("credentials.".length)] = value;
                } else {
                  state.doc[path] = value;
                }
              }
              return state.doc;
            },
          };
        }
        if (name === "activityLogs") {
          return { async insertOne() {} };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    };
    return { db, state };
  }

  function serviceWith(db, validator) {
    return settingsService({
      settingsModel: { findMany: async () => ({}), findOne: async () => null },
      db,
      mongoClient: null,
      settingsEncryptionKey: "b".repeat(64),
      twoFactorService: twoFactorStub(),
      integrationValidator: validator,
    });
  }

  it("refuses to save a credential its provider rejects", async () => {
    const { db, state } = trackingDb({ key: "googleMaps", enabled: false, credentials: {} });
    const svc = serviceWith(db, {
      async verify() {
        const err = new Error(
          "Google Maps API key is not valid — Google rejected it. Nothing was saved."
        );
        err.status = 422;
        throw err;
      },
    });

    await assert.rejects(
      () =>
        svc.update(
          "googleMaps",
          { credentials: { apiKey: "AIzaSyBadKey12345678901234567890" }, code: "123456" },
          { role: "super_admin", id: "super-1" }
        ),
      (err) => err.status === 422 && /not valid/i.test(err.message)
    );

    assert.strictEqual(state.writes, 0, "a rejected key must never reach the database");
  });

  it("checks a new value together with the values already in effect", async () => {
    const { db } = trackingDb({
      key: "googleCalendar",
      enabled: false,
      credentials: {
        clientEmail: {
          value: "gamehub@project.iam.gserviceaccount.com",
          last4: ".com",
        },
        privateKey: { value: "-----BEGIN PRIVATE KEY-----stored", last4: "ored" },
      },
    });
    let seen = null;
    const svc = serviceWith(db, {
      async verify(key, input) {
        seen = { key, ...input };
        return { provider: "Google Calendar", credentials: [], notes: [] };
      },
    });

    await svc.update(
      "googleCalendar",
      { credentials: { calendarId: "gamehub@group.calendar.google.com" }, code: "123456" },
      { role: "super_admin", id: "super-1" }
    );

    assert.strictEqual(seen.key, "googleCalendar");
    assert.deepStrictEqual(seen.changed, ["calendarId"]);
    assert.strictEqual(seen.values.calendarId, "gamehub@group.calendar.google.com");
    assert.strictEqual(
      seen.values.clientEmail,
      "gamehub@project.iam.gserviceaccount.com"
    );
  });

  it("returns which provider accepted the value", async () => {
    const { db } = trackingDb({
      key: "googleMaps",
      enabled: true,
      credentials: { apiKey: { value: "old-key-12345678901234567890", last4: "7890" } },
    });
    const svc = serviceWith(db, {
      async verify() {
        return {
          provider: "Google Maps",
          credentials: ["apiKey"],
          notes: ["Saved after a live check."],
        };
      },
    });

    const shaped = await svc.update(
      "googleMaps",
      { credentials: { apiKey: "new-key-123456789012345678901" }, code: "123456" },
      { role: "super_admin", id: "super-1" }
    );

    assert.deepStrictEqual(shaped.verification, {
      provider: "Google Maps",
      credentials: ["apiKey"],
      notes: ["Saved after a live check."],
    });
  });

  it("does not call the provider when a credential is cleared", async () => {
    const { db } = trackingDb({
      key: "googleMaps",
      enabled: true,
      credentials: { apiKey: { value: "old-key-12345678901234567890", last4: "7890" } },
    });
    let calls = 0;
    const svc = serviceWith(db, {
      async verify() {
        calls += 1;
        return { provider: "", credentials: [], notes: [] };
      },
    });

    await svc.update(
      "googleMaps",
      { credentials: { apiKey: "" }, code: "123456" },
      { role: "super_admin", id: "super-1" }
    );

    assert.strictEqual(calls, 0);
  });

  it("rejects a private key that is not a PEM key before any provider call", () => {
    const svc = serviceWith(null, {
      async verify() {
        assert.fail("no provider call expected for a malformed key");
      },
    });

    assert.throws(
      () => svc.validateCredential("googleCalendar", "privateKey", "not-a-pem"),
      (err) => err.status === 422 && /PEM/i.test(err.message)
    );
  });
});

describe("reset integrations to .env defaults", () => {
  const ENV_KEYS = [
    "RECAPTCHA_SITE_KEY",
    "RECAPTCHA_SITE_KEY_OVERRIDE",
    "RECAPTCHA_SECRET_KEY",
    "RECAPTCHA_SECRET_KEY_OVERRIDE",
  ];
  const saved = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  /**
   * Settings collection that mirrors bulkWrite updates and records audit logs.
   * findMany returns the mutated documents, like the real model.
   */
  function fixture(docs = []) {
    const state = {
      docs: docs.map((doc) => ({
        ...doc,
        credentials: { ...(doc.credentials || {}) },
      })),
      logs: [],
      writes: 0,
    };
    const db = {
      collection(name) {
        if (name === "settings") {
          return {
            async bulkWrite(operations) {
              state.writes += 1;
              for (const { updateOne } of operations) {
                const doc = state.docs.find(
                  (candidate) => candidate.key === updateOne.filter.key
                );
                if (!doc) continue;
                for (const path of Object.keys(updateOne.update.$unset || {})) {
                  if (path === "credentials") delete doc.credentials;
                }
                Object.assign(doc, updateOne.update.$set || {});
              }
            },
          };
        }
        if (name === "activityLogs") {
          return {
            async insertOne(log) {
              state.logs.push(log);
            },
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    };
    return { db, state };
  }

  function service(docs = []) {
    const { db, state } = fixture(docs);
    const persisted = [];
    const svc = settingsService({
      settingsModel: {
        async findMany() {
          return Object.fromEntries(state.docs.map((doc) => [doc.key, doc]));
        },
      },
      db,
      mongoClient: null,
      settingsEncryptionKey: "",
      twoFactorService: twoFactorStub(),
      persistEnvValue: async (key, value) => {
        persisted.push([key, value]);
        process.env[key] = value;
      },
    });
    return { svc, state, persisted };
  }

  const actor = {
    role: "super_admin",
    id: "super-1",
    email: "superadmin@example.com",
  };

  it("clears the override and saved value so the original .env key applies", async () => {
    process.env.RECAPTCHA_SITE_KEY = "base-site-123456789012345678901234";
    process.env.RECAPTCHA_SECRET_KEY = "base-secret-123456789012345678901234";
    process.env.RECAPTCHA_SITE_KEY_OVERRIDE = "override-site-123456789012345678901111";
    const { svc, state, persisted } = service([
      {
        key: "recaptcha",
        enabled: true,
        credentials: {
          siteKey: {
            value: "override-site-123456789012345678901111",
            last4: "1111",
          },
          secretKey: {
            value: "saved-secret-123456789012345678901234",
            last4: "1234",
          },
        },
      },
    ]);

    const result = await svc.resetToDefaults(actor, "123456");

    assert.ok(
      persisted.some(
        ([key, value]) => key === "RECAPTCHA_SITE_KEY_OVERRIDE" && value === ""
      ),
      "the reCAPTCHA override must be cleared"
    );
    assert.strictEqual(state.docs[0].credentials, undefined);
    assert.strictEqual(state.docs[0].enabled, true);
    const recaptcha = result.integrations.find((i) => i.key === "recaptcha");
    const site = recaptcha.credentials.find((c) => c.name === "siteKey");
    assert.strictEqual(recaptcha.enabled, true);
    assert.strictEqual(site.source, "env");
    assert.ok(site.masked.endsWith("1234"));
    assert.ok(result.clearedOverrides.includes("RECAPTCHA_SITE_KEY_OVERRIDE"));
    assert.strictEqual(state.logs[0].action, "integration_reset_default");
    assert.strictEqual(state.logs[0].meta.role, "super_admin");
  });

  it("turns an integration off when no original .env key exists", async () => {
    process.env.RECAPTCHA_SITE_KEY_OVERRIDE = "override-site-123456789012345678901111";
    const { svc, state } = service([
      {
        key: "recaptcha",
        enabled: true,
        credentials: {
          siteKey: {
            value: "override-site-123456789012345678901111",
            last4: "1111",
          },
        },
      },
    ]);

    const result = await svc.resetToDefaults(actor, "123456");

    assert.strictEqual(state.docs[0].enabled, false);
    const recaptcha = result.integrations.find((i) => i.key === "recaptcha");
    assert.strictEqual(recaptcha.enabled, false);
    const site = recaptcha.credentials.find((c) => c.name === "siteKey");
    assert.strictEqual(site.configured, false);
    assert.strictEqual(site.source, "");
  });

  it("rejects a non-super-admin", async () => {
    const { svc } = service([]);
    await assert.rejects(
      () => svc.resetToDefaults({ role: "admin", id: "admin-1" }, "123456"),
      (err) => err.status === 403 && /super administrator/i.test(err.message)
    );
  });

  it("requires a current authenticator code before clearing anything", async () => {
    const { svc, state } = service([
      { key: "recaptcha", enabled: true, credentials: {} },
    ]);
    await assert.rejects(
      () => svc.resetToDefaults(actor, ""),
      (err) =>
        err.status === 422 && /6-digit code from your authenticator app/i.test(err.message)
    );
    assert.strictEqual(state.writes, 0);
    assert.strictEqual(state.logs.length, 0);
  });
});
