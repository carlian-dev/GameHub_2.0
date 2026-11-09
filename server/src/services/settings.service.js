// Settings service — business rules for settings endpoints.
// migration.md §13.6: DB authoritative, env defaults only when doc absent,
// masked credentials, fail-closed config, transaction + audit on update.
import { maskValue } from "../utils/mask.js";
import { isValidGoogleClientId } from "../utils/google.js";
import { createSecretBox } from "../utils/secretBox.js";

const REGISTRY = [
  {
    key: "googleAuth",
    name: "Google Authentication",
    description: "Admin Google sign-in",
    available: true,
    credentials: [
      { name: "clientId", label: "OAuth Client ID", required: true, secret: false },
    ],
  },
  {
    key: "googleMaps",
    name: "Google Maps",
    description: "Location map on the public landing page",
    available: true,
    credentials: [
      { name: "apiKey", label: "Maps API key (optional)", required: false, secret: false },
    ],
  },
  {
    key: "googleCalendar",
    name: "Google Calendar",
    description: "Accepted reservations become calendar events",
    available: true,
    credentials: [
      { name: "calendarId", label: "Calendar ID", required: true, secret: false },
      { name: "clientEmail", label: "Service account email", required: true, secret: false },
      { name: "privateKey", label: "Service account private key", required: true, secret: true },
    ],
  },
  {
    key: "recaptcha",
    name: "reCAPTCHA",
    description: "Bot protection for public forms (staff login, cashier signup, reservations)",
    available: true,
    credentials: [
      { name: "siteKey", label: "Site key (v2 checkbox)", required: true, secret: false },
      { name: "secretKey", label: "Secret key", required: true, secret: true },
    ],
  },
  {
    key: "paymongo",
    name: "PayMongo",
    description: "GCash checkout for closed session bills",
    available: true,
    credentials: [
      { name: "secretKey", label: "Secret key", required: true, secret: true },
      {
        name: "webhookSecret",
        label: "Webhook signing secret (optional)",
        required: false,
        secret: true,
      },
    ],
  },
  {
    key: "otp",
    name: "OTP / email codes",
    description: "Email verification codes (planned)",
    available: false,
    credentials: [],
  },
];

// Secret credentials (`secret: true`) are stored encrypted with AES-256-GCM.
// The box is created once per service factory call; a bad key fails startup
// loudly instead of silently storing plaintext.
let secretBox = createSecretBox("");
// Env defaults captured from the factory (only used when a document is absent).
let recaptchaEnv = {};

function credentialShape(name, def, raw) {
  const value = raw && raw.value != null ? String(raw.value) : "";
  const hint = raw && raw.last4 != null ? String(raw.last4) : "";
  return {
    name,
    label: def.label,
    required: !!def.required,
    configured: value !== "",
    masked: maskValue(value, hint),
  };
}

/** Read a stored credential, decrypting it when it was saved by secretBox. */
function storedCredentialValue(raw) {
  if (!raw || typeof raw !== "object") return "";
  if (raw.ciphertext) return secretBox.decrypt(raw);
  return String(raw.value || "");
}

// Read `credentials` as an object keyed by credential name. Older seed scripts
// wrote an array of {name, value, ...}; normalize it so those documents still
// read (and never break) instead of silently dropping every credential value.
function credentialsMap(basis) {
  const raw = basis && basis.credentials;
  if (Array.isArray(raw)) {
    const out = {};
    for (const c of raw) {
      if (c && c.name) out[c.name] = c;
    }
    return out;
  }
  return raw && typeof raw === "object" ? raw : {};
}

function effectiveDoc(key, doc) {
  const reg = REGISTRY.find((r) => r.key === key);
  if (!reg) return null;
  const basis = doc || defaultDoc(key);
  const stored = credentialsMap(basis);
  const credentials = {};
  for (const cred of reg.credentials) {
    const raw = stored[cred.name] || {};
    credentials[cred.name] = {
      value: storedCredentialValue(raw),
      last4: String(raw.last4 || ""),
    };
  }
  let enabled = !!basis.enabled;
  for (const cred of reg.credentials) {
    if (cred.required && credentials[cred.name].value === "") {
      enabled = false;
    }
  }
  return {
    key,
    enabled,
    credentials,
    updatedAt: basis.updatedAt || null,
    updatedBy: basis.updatedBy != null ? String(basis.updatedBy) : null,
  };
}

// Env fallbacks captured from the service factory (DB authoritative once a
// document exists; these only apply when the document is positively absent).
let googleAuthEnvClientId = "";
let googleCalendarEnv = {};

function defaultDoc(key) {
  const reg = REGISTRY.find((r) => r.key === key);
  if (!reg) return { enabled: false, credentials: {} };
  const credentials = {};
  for (const cred of reg.credentials) {
    credentials[cred.name] = { value: "", last4: "" };
  }
  let enabled = false;
  if (key === "googleMaps") enabled = true;
  if (key === "googleAuth") {
    // GOOGLE_CLIENT_ID is the default client ID (parity with the archived PHP
    // settings_default()). Without this the login page never shows the Google
    // button on a fresh database. Only a well-formed client ID is published.
    const cid = String(googleAuthEnvClientId || "").trim();
    if (isValidGoogleClientId(cid)) {
      enabled = true;
      credentials.clientId = {
        value: cid,
        last4: credentialHint("googleAuth", "clientId", cid),
        updatedAt: null,
      };
    }
  }
  if (key === "googleCalendar") {
    const calendarId = String((googleCalendarEnv && googleCalendarEnv.calendarId) || "").trim();
    const clientEmail = String((googleCalendarEnv && googleCalendarEnv.clientEmail) || "").trim();
    const privateKey = String((googleCalendarEnv && googleCalendarEnv.privateKey) || "").trim();
    if (calendarId && clientEmail && privateKey) {
      enabled = true;
      credentials.calendarId = {
        value: calendarId,
        last4: credentialHint("googleCalendar", "calendarId", calendarId),
        updatedAt: null,
      };
      credentials.clientEmail = {
        value: clientEmail,
        last4: clientEmail.slice(-4),
        updatedAt: null,
      };
      credentials.privateKey = {
        value: privateKey,
        last4: privateKey.slice(-4),
        updatedAt: null,
      };
    }
  }
  if (key === "recaptcha") {
    // Env defaults only apply while no `settings.recaptcha` document exists.
    const siteKey = String((recaptchaEnv && recaptchaEnv.siteKey) || "").trim();
    const secretKey = String((recaptchaEnv && recaptchaEnv.secretKey) || "").trim();
    if (siteKey && secretKey) {
      enabled = true;
      credentials.siteKey = {
        value: siteKey,
        last4: siteKey.slice(-4),
        updatedAt: null,
      };
      credentials.secretKey = {
        value: secretKey,
        last4: secretKey.slice(-4),
        updatedAt: null,
      };
    }
  }
  return { enabled, credentials };
}

function credentialHint(key, name, value) {
  if (!value) return "";
  if (key === "googleAuth" && name === "clientId") {
    const suffix = ".apps.googleusercontent.com";
    if (value.endsWith(suffix)) {
      const prefix = value.slice(0, -suffix.length);
      return prefix ? prefix.slice(-4) : "";
    }
  }
  return value.slice(-4);
}

// Transactions need a replica-set member (Atlas, or a local replSet). A
// standalone mongod rejects them with "Transaction numbers are only allowed on
// a replica set member or mongos", so probe once per write.
async function hasTransactionSupport(client) {
  if (!client) return false;
  try {
    const hello = await client.db().admin().command({ hello: 1 });
    return Boolean(hello.setName);
  } catch {
    return false;
  }
}

export function settingsService({
  settingsModel,
  db,
  mongoClient,
  googleClientIdFromEnv,
  googleCalendarFromEnv,
  settingsEncryptionKey,
  recaptchaFromEnv,
}) {
  googleAuthEnvClientId = String(googleClientIdFromEnv || "");
  googleCalendarEnv = googleCalendarFromEnv || {};
  recaptchaEnv = recaptchaFromEnv || {};
  secretBox = createSecretBox(settingsEncryptionKey);
  return {
    registry() {
      return REGISTRY;
    },
    async publicConfig() {
      try {
        const docs = await settingsModel.findMany(["googleAuth", "googleMaps", "recaptcha", "paymongo"]);
        const auth = effectiveDoc("googleAuth", docs.googleAuth || null);
        const maps = effectiveDoc("googleMaps", docs.googleMaps || null);
        const recaptcha = effectiveDoc("recaptcha", docs.recaptcha || null);
        const paymongo = effectiveDoc("paymongo", docs.paymongo || null);
        return {
          googleAuth: {
            enabled: auth.enabled,
            clientId: auth.enabled ? auth.credentials.clientId.value : "",
          },
          googleMaps: {
            enabled: maps.enabled,
            apiKey: maps.enabled ? maps.credentials.apiKey.value : "",
          },
          // Only the public site key ever reaches the browser. The secret key
          // stays server-side and is never returned by any endpoint.
          recaptcha: {
            enabled: recaptcha.enabled,
            siteKey: recaptcha.enabled ? recaptcha.credentials.siteKey.value : "",
          },
          // Cashier UI only needs the on/off flag; no PayMongo key is public.
          paymongo: { enabled: paymongo.enabled },
        };
      } catch {
        // Fail closed (migration.md §13.6): all disabled/empty, HTTP 200.
        return {
          googleAuth: { enabled: false, clientId: "" },
          googleMaps: { enabled: false, apiKey: "" },
          recaptcha: { enabled: false, siteKey: "" },
          paymongo: { enabled: false },
        };
      }
    },
    async adminIntegrations() {
      const keys = REGISTRY.map((r) => r.key);
      const docs = await settingsModel.findMany(keys);
      const integrations = REGISTRY.map((reg) => {
        const doc = docs[reg.key] || null;
        const effective = effectiveDoc(reg.key, doc);
        const credentials = reg.credentials.map((c) => {
          const raw = effective && effective.credentials && effective.credentials[c.name] ? effective.credentials[c.name] : {};
          return credentialShape(c.name, c, raw);
        });
        return {
          key: reg.key,
          name: reg.name,
          description: reg.description,
          available: reg.available,
          enabled: effective.enabled,
          credentials,
          updatedAt: effective.updatedAt,
          updatedBy: effective.updatedBy,
        };
      });
      return { integrations };
    },
    async calendarConfig() {
      try {
        const docs = await settingsModel.findMany(["googleCalendar"]);
        const effective = effectiveDoc("googleCalendar", docs.googleCalendar || null);
        return {
          enabled: !!effective.enabled,
          calendarId: effective.enabled ? effective.credentials.calendarId.value : "",
          clientEmail: effective.enabled ? effective.credentials.clientEmail.value : "",
          privateKey: effective.enabled ? effective.credentials.privateKey.value : "",
        };
      } catch {
        return { enabled: false, calendarId: "", clientEmail: "", privateKey: "" };
      }
    },
    /**
     * Server-only reCAPTCHA config (includes the decrypted secret).
     * A stored document's `enabled` flag is the admin's intent; missing or
     * undecryptable keys are reported as empty so the caller can decide.
     * Read failures are intentionally thrown: verification must fail closed.
     */
    async recaptchaConfig() {
      const docs = await settingsModel.findMany(["recaptcha"]);
      const doc = docs.recaptcha || null;
      const effective = effectiveDoc("recaptcha", doc);
      return {
        enabled: doc ? !!doc.enabled : !!effective.enabled,
        siteKey: String(effective.credentials.siteKey?.value || ""),
        secretKey: String(effective.credentials.secretKey?.value || ""),
      };
    },
    /**
     * Server-only PayMongo config (includes decrypted secret keys).
     * PayMongo is only enabled when the required secret key is present; the
     * webhook secret is optional so polling works without a public tunnel.
     */
    async paymongoConfig() {
      const docs = await settingsModel.findMany(["paymongo"]);
      const effective = effectiveDoc("paymongo", docs.paymongo || null);
      return {
        enabled: !!effective.enabled,
        secretKey: String(effective.credentials.secretKey?.value || ""),
        webhookSecret: String(effective.credentials.webhookSecret?.value || ""),
      };
    },
    /**
     * settings_plan_update port: build field-level update plan.
     * Validation and required-credential rules here (testable without DB).
     */
    planUpdate(key, effective, data) {
      const reg = REGISTRY.find((r) => r.key === key);
      if (!reg) {
        const err = new Error("unknown integration");
        err.status = 404;
        throw err;
      }

      let enabled = effective.enabled ?? false;
      let enabledChanged = false;
      const changed = [];
      const credentialWrites = {};
      // Plaintext values used only for the required-credential check below.
      // Never written to Mongo: secret credentials are encrypted first.
      const credentialValues = {};

      if (Object.prototype.hasOwnProperty.call(data, "enabled")) {
        if (typeof data.enabled !== "boolean") {
          const err = new Error("enabled must be a boolean");
          err.status = 422;
          throw err;
        }
        enabled = data.enabled;
        enabledChanged = true;
        changed.push("enabled");
      }

      if (Object.prototype.hasOwnProperty.call(data, "credentials")) {
        const creds = data.credentials;
        if (typeof creds !== "object" || creds === null || Array.isArray(creds)) {
          const err = new Error("credentials must be an object");
          err.status = 422;
          throw err;
        }
        for (const [name, raw] of Object.entries(creds)) {
          const def = reg.credentials.find((c) => c.name === name);
          if (!def) {
            const err = new Error("unknown credential for this integration");
            err.status = 422;
            throw err;
          }
          if (typeof raw !== "string") {
            const err = new Error("credential values must be strings");
            err.status = 422;
            throw err;
          }
          const value = String(raw).trim();
          this.validateCredential(key, name, value);
          credentialValues[name] = value;
          if (value === "") {
            credentialWrites[name] = null;
          } else if (def.secret) {
            // Secret credentials are never stored in plaintext.
            if (!secretBox.configured) {
              const err = new Error(
                "SETTINGS_ENCRYPTION_KEY is not configured; secret credentials cannot be saved"
              );
              err.status = 422;
              throw err;
            }
            credentialWrites[name] = {
              ...secretBox.encrypt(value),
              last4: credentialHint(key, name, value),
              updatedAt: new Date(),
            };
          } else {
            credentialWrites[name] = {
              value,
              last4: credentialHint(key, name, value),
              updatedAt: new Date(),
            };
          }
          changed.push(`credentials.${name}`);
        }
      }

      if (changed.length === 0) {
        const err = new Error("nothing to update (allowed: enabled, credentials)");
        err.status = 422;
        throw err;
      }

      for (const cred of reg.credentials) {
        if (!cred.required) continue;
        const value = Object.prototype.hasOwnProperty.call(credentialValues, cred.name)
          ? String(credentialValues[cred.name] ?? "")
          : String(effective.credentials[cred.name]?.value ?? "");
        if (value !== "") continue;
        if (enabled) {
          if (enabledChanged) {
            const err = new Error("cannot enable this integration without its required credential");
            err.status = 422;
            throw err;
          }
          enabled = false;
          enabledChanged = true;
          if (!changed.includes("enabled")) changed.push("enabled");
        }
      }

      const set = {};
      const unset = {};
      const setOnInsert = { key };

      if (enabledChanged) {
        set.enabled = enabled;
      } else {
        setOnInsert.enabled = enabled;
      }

      for (const cred of reg.credentials) {
        if (Object.prototype.hasOwnProperty.call(credentialWrites, cred.name)) {
          const cw = credentialWrites[cred.name];
          if (cw === null) {
            unset[`credentials.${cred.name}`] = "";
          } else {
            set[`credentials.${cred.name}`] = cw;
          }
          continue;
        }
        const current = effective.credentials && effective.credentials[cred.name] ? effective.credentials[cred.name] : {};
        const currentValue = String(current.value || "");
        if (cred.secret && currentValue !== "") {
          // Env fallbacks are plaintext; never copy them into Mongo as-is.
          if (!secretBox.configured) {
            const err = new Error(
              "SETTINGS_ENCRYPTION_KEY is not configured; secret credentials cannot be saved"
            );
            err.status = 422;
            throw err;
          }
          setOnInsert[`credentials.${cred.name}`] = {
            ...secretBox.encrypt(currentValue),
            last4: String(current.last4 || ""),
            updatedAt: current.updatedAt || null,
          };
        } else {
          setOnInsert[`credentials.${cred.name}`] = {
            value: currentValue,
            last4: String(current.last4 || ""),
            updatedAt: current.updatedAt || null,
          };
        }
      }

      return { enabled, changed, set, unset, set_on_insert: setOnInsert };
    },

    validateCredential(key, name, value) {
      if (value.length > 2048) {
        const err = new Error("credential is too long (maximum 2048 characters)");
        err.status = 422;
        throw err;
      }
      if (key === "googleAuth" && name === "clientId" && value !== "") {
        if (/\s/.test(value) || !isValidGoogleClientId(value)) {
          const err = new Error("Google client ID must end with .apps.googleusercontent.com and include an identifier");
          err.status = 422;
          throw err;
        }
      }
      if (key === "googleMaps" && name === "apiKey" && value !== "" && /\s/.test(value)) {
        const err = new Error("Maps API key must not contain whitespace");
        err.status = 422;
        throw err;
      }
      if (key === "recaptcha" && value !== "" && (/\s/.test(value) || value.length < 20)) {
        const err = new Error("reCAPTCHA keys contain no spaces and are at least 20 characters");
        err.status = 422;
        throw err;
      }
      if (key === "paymongo" && value !== "" && (/\s/.test(value) || value.length < 10)) {
        const err = new Error("PayMongo keys contain no spaces and are at least 10 characters");
        err.status = 422;
        throw err;
      }
    },

    /**
     * settings_update: toggle integration and/or replace/clear credentials.
     * Settings write + integration_settings_update audit log in one transaction.
     */
    async update(key, data, actor = {}) {
      const adminEmail = actor && actor.email ? actor.email : null;
      const actorId = actor && actor.id ? String(actor.id) : null;
      const reg = REGISTRY.find((r) => r.key === key);
      if (!reg) {
        const err = new Error("unknown integration");
        err.status = 404;
        throw err;
      }
      if (!reg.available) {
        const err = new Error("planned integrations cannot be changed");
        err.status = 422;
        throw err;
      }

      const settingsColl = db.collection("settings");
      const activityLogs = db.collection("activityLogs");

      const existingDoc = await settingsColl.findOne({ key });
      const effective = effectiveDoc(key, existingDoc || null);
      const plan = this.planUpdate(key, effective, data);

      const set = { ...plan.set, updatedAt: new Date(), updatedBy: adminEmail };
      const unset = { ...plan.unset };
      const setOnInsert = { ...plan.set_on_insert };

      // Legacy docs seeded as an ARRAY of {name, value, ...}: replace the whole
      // `credentials` object instead of writing dotted paths — Mongo cannot
      // create `credentials.<name>` inside an array element.
      if (existingDoc && Array.isArray(existingDoc.credentials)) {
        const prefix = "credentials.";
        const merged = credentialsMap(existingDoc);
        for (const [k, v] of Object.entries(set)) {
          if (k.startsWith(prefix)) {
            merged[k.slice(prefix.length)] = v;
            delete set[k];
          }
        }
        for (const k of Object.keys(unset)) {
          if (k.startsWith(prefix)) {
            delete merged[k.slice(prefix.length)];
            delete unset[k];
          }
        }
        for (const [k, v] of Object.entries(setOnInsert)) {
          if (k.startsWith(prefix)) {
            const name = k.slice(prefix.length);
            if (!merged[name]) merged[name] = v;
            delete setOnInsert[k];
          }
        }
        set.credentials = merged;
      }

      const update = { $set: set };
      if (Object.keys(unset).length > 0) update.$unset = unset;
      if (Object.keys(setOnInsert).length > 0) update.$setOnInsert = setOnInsert;

      const apply = async (session) => {
        const updated = await settingsColl.findOneAndUpdate(
          { key },
          update,
          { upsert: true, returnDocument: "after", session }
        );
        if (!updated) {
          throw new Error("settings update returned no document");
        }
        const shaped = this.shape(key, effectiveDoc(key, updated));
        await activityLogs.insertOne(
          {
            actorId,
            action: "integration_settings_update",
            target: key,
            meta: { enabled: plan.enabled, changed: plan.changed },
            at: new Date(),
          },
          { session }
        );
        return shaped;
      };

      // Transactions require a replica set (Atlas / local replSet). A standalone
      // mongod rejects them outright, so fall back to the two plain writes.
      if (await hasTransactionSupport(mongoClient)) {
        const session = mongoClient.startSession();
        try {
          return await session.withTransaction(() => apply(session));
        } finally {
          await session.endSession();
        }
      }
      return await apply(null);
    },

    shape(key, effective) {
      const reg = REGISTRY.find((r) => r.key === key);
      if (!reg) return null;
      const credentials = reg.credentials.map((c) => {
        const raw = effective && effective.credentials && effective.credentials[c.name] ? effective.credentials[c.name] : {};
        return credentialShape(c.name, c, raw);
      });
      return {
        key: reg.key,
        name: reg.name,
        description: reg.description,
        available: reg.available,
        enabled: effective.enabled,
        credentials,
        updatedAt: effective.updatedAt,
        updatedBy: effective.updatedBy,
      };
    },
  };
}
