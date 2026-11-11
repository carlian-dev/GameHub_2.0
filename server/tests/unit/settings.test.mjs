// Unit tests for settings masking.
// migration.md §16: settings masking/required-credential rules.
// migration.md §13.6: 8 bullets plus a safe 4-char hint.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { maskValue, googleClientIdHint } from "../../src/utils/mask.js";
import { settingsService } from "../../src/services/settings.service.js";

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
    db: null,
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

  it("rejects a super admin changing credentials", async () => {
    await assert.rejects(
      () =>
        svc.update(
          "googleMaps",
          { credentials: { apiKey: "abc" } },
          { role: "super_admin" }
        ),
      (err) =>
        err.status === 403 && /only turn integrations on or off/i.test(err.message)
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

    const data = await svc.adminIntegrations();
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

    const data = await svc.adminIntegrations();
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

    const data = await svc.adminIntegrations();
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
      persistEnvValue: async (key, value) => {
        persisted.push([key, value]);
        process.env[key] = value;
      },
    });

    try {
      const shaped = await svc.update(
        "recaptcha",
        { credentials: { siteKey: "new-site-12345678901234567890" } },
        { role: "admin", email: "admin@example.com" }
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

  it("clears the override key when an admin clears a credential", async () => {
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
        { credentials: { siteKey: "" } },
        { role: "admin", email: "admin@example.com" }
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

describe("gemini integration settings", () => {
  const ENV_KEYS = ["GEMINI_API_KEY", "GEMINI_API_KEY_OVERRIDE"];
  const saved = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("validates Gemini API key format (rejects spaces or short keys)", () => {
    const svc = settingsService({
      settingsModel: { findMany: async () => ({}) },
      db: null,
      mongoClient: null,
    });

    assert.throws(
      () => svc.validateCredential("gemini", "apiKey", "too-short"),
      (err) => err.status === 422 && /at least 20 characters/i.test(err.message)
    );

    assert.throws(
      () => svc.validateCredential("gemini", "apiKey", "key with space in the middle 1234567"),
      (err) => err.status === 422 && /whitespace/i.test(err.message)
    );

    // Empty value is allowed (for clearing)
    assert.doesNotThrow(() => svc.validateCredential("gemini", "apiKey", ""));

    // Valid format key is allowed
    assert.doesNotThrow(() =>
      svc.validateCredential("gemini", "apiKey", "AIzaSyValidGeminiKey1234567890abcdef")
    );
  });

  it("exposes gemini in adminIntegrations and uses env fallback", async () => {
    process.env.GEMINI_API_KEY = "AIzaSyBaseKey12345678901234567890";
    const svc = settingsService({
      settingsModel: { findMany: async () => ({}) },
      db: null,
      mongoClient: null,
    });

    const data = await svc.adminIntegrations();
    const gemini = data.integrations.find((i) => i.key === "gemini");
    assert.ok(gemini, "gemini must be present in registry");
    assert.strictEqual(gemini.name, "Google Gemini AI");
    assert.strictEqual(gemini.enabled, true);

    const apiKeyCred = gemini.credentials.find((c) => c.name === "apiKey");
    assert.ok(apiKeyCred);
    assert.strictEqual(apiKeyCred.configured, true);
    assert.strictEqual(apiKeyCred.source, "env");
    assert.ok(apiKeyCred.masked.endsWith("7890"));
  });

  it("rejects super admin enabling gemini when apiKey is missing", async () => {
    const mockDb = {
      collection: () => ({
        findOne: async () => null,
        insertOne: async () => {},
      }),
    };
    const svc = settingsService({
      settingsModel: { findMany: async () => ({}) },
      db: mockDb,
      mongoClient: null,
    });

    await assert.rejects(
      () => svc.update("gemini", { enabled: true }, { role: "super_admin" }),
      (err) =>
        err.status === 422 &&
        /cannot enable this integration without its required credential/i.test(
          err.message
        )
    );
  });
});
