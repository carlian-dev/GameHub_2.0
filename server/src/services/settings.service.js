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
    key: "gemini",
    name: "Google Gemini AI",
    description: "AI assistance and intelligent automation services",
    available: true,
    credentials: [
      { name: "apiKey", label: "Gemini API key", required: true, secret: true },
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

// Credential -> .env field mapping. `override` is written by Settings > API;
// `base` is the existing/default env value. Resolution order per credential:
//   1. override field (non-empty)
//   2. base env field
//   3. stored settings document value (legacy/backup)
// This is what makes "empty override -> use RECAPTCHA_SECRET_KEY" work even
// when an older settings document still has a credential.
const ENV_CREDENTIALS = {
  googleAuth: {
    clientId: {
      override: "GOOGLE_AUTH_CLIENT_ID_OVERRIDE",
      base: "GOOGLE_CLIENT_ID",
    },
  },
  googleMaps: {
    apiKey: {
      override: "GOOGLE_MAPS_API_KEY_OVERRIDE",
      base: "GOOGLE_MAPS_API_KEY",
    },
  },
  googleCalendar: {
    calendarId: {
      override: "GOOGLE_CALENDAR_ID_OVERRIDE",
      base: "GOOGLE_CALENDAR_ID",
    },
    clientEmail: {
      override: "GOOGLE_CALENDAR_CLIENT_EMAIL_OVERRIDE",
      base: "GOOGLE_CALENDAR_CLIENT_EMAIL",
    },
    privateKey: {
      override: "GOOGLE_CALENDAR_PRIVATE_KEY_OVERRIDE",
      base: "GOOGLE_CALENDAR_PRIVATE_KEY",
    },
  },
  recaptcha: {
    siteKey: {
      override: "RECAPTCHA_SITE_KEY_OVERRIDE",
      base: "RECAPTCHA_SITE_KEY",
    },
    secretKey: {
      override: "RECAPTCHA_SECRET_KEY_OVERRIDE",
      base: "RECAPTCHA_SECRET_KEY",
    },
  },
  paymongo: {
    secretKey: {
      override: "PAYMONGO_SECRET_KEY_OVERRIDE",
      base: "PAYMONGO_SECRET_KEY",
    },
    webhookSecret: {
      override: "PAYMONGO_WEBHOOK_SECRET_OVERRIDE",
      base: "PAYMONGO_WEBHOOK_SECRET",
    },
  },
  gemini: {
    apiKey: {
      override: "GEMINI_API_KEY_OVERRIDE",
      base: "GEMINI_API_KEY",
    },
  },
};

// Secret credentials (`secret: true`) are stored encrypted with AES-256-GCM.
// The box is created once per service factory call; a bad key fails startup
// loudly instead of silently storing plaintext.
let secretBox = createSecretBox("");
// Env defaults captured from the factory. Used by unit tests and as a last
// resort when process.env has not been populated.
let capturedEnv = {};

function envFieldValue(key, name, field) {
  const fields = ENV_CREDENTIALS[key]?.[name];
  if (!fields || !field) return "";
  const fromProcess = String(process.env[fields[field]] || "").trim();
  if (fromProcess) return fromProcess;
  if (field === "base") {
    const fromFactory = capturedEnv[key]?.[name];
    return String(fromFactory || "").trim();
  }
  return "";
}

function overrideEnvValue(key, name) {
  return envFieldValue(key, name, "override");
}

function baseEnvValue(key, name) {
  return envFieldValue(key, name, "base");
}

/** Env value used to decide whether an absent settings document is enabled. */
function resolvedEnvValue(key, name) {
  return overrideEnvValue(key, name) || baseEnvValue(key, name);
}

function credentialShape(name, def, raw) {
  const value = raw && raw.value != null ? String(raw.value) : "";
  const hint = raw && raw.last4 != null ? String(raw.last4) : "";
  return {
    name,
    label: def.label,
    required: !!def.required,
    configured: value !== "",
    masked: maskValue(value, hint),
    // "override" = saved to .env by Settings > API, "db" = settings document,
    // "env" = base .env default, "" = not configured. Values are never exposed.
    source: raw && raw.source ? String(raw.source) : "",
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
    const override = overrideEnvValue(key, cred.name);
    let value = "";
    let last4 = "";
    let source = "";

    if (override) {
      value = override;
      last4 = credentialHint(key, cred.name, override);
      source = "override";
    } else {
      const base = baseEnvValue(key, cred.name);
      if (base) {
        value = base;
        last4 = credentialHint(key, cred.name, base);
        source = "env";
      } else {
        const storedValue = storedCredentialValue(raw);
        if (storedValue) {
          value = storedValue;
          last4 =
            String(raw.last4 || "") ||
            credentialHint(key, cred.name, storedValue);
          source = "db";
        }
      }
    }

    credentials[cred.name] = { value, last4, source };
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

function defaultDoc(key) {
  const reg = REGISTRY.find((r) => r.key === key);
  if (!reg) return { enabled: false, credentials: {} };
  const credentials = {};
  for (const cred of reg.credentials) {
    credentials[cred.name] = { value: "", last4: "", source: "" };
  }
  let enabled = false;
  if (key === "googleMaps") enabled = true;
  if (key === "googleAuth") {
    // GOOGLE_CLIENT_ID (or its admin override) is the default client ID
    // (parity with the archived PHP settings_default()). Without this the
    // login page never shows the Google button on a fresh database. Only a
    // well-formed client ID is published.
    const cid = resolvedEnvValue("googleAuth", "clientId");
    if (isValidGoogleClientId(cid)) enabled = true;
  }
  if (key === "googleCalendar") {
    const calendarId = resolvedEnvValue("googleCalendar", "calendarId");
    const clientEmail = resolvedEnvValue("googleCalendar", "clientEmail");
    const privateKey = resolvedEnvValue("googleCalendar", "privateKey");
    if (calendarId && clientEmail && privateKey) enabled = true;
  }
  if (key === "recaptcha") {
    const siteKey = resolvedEnvValue("recaptcha", "siteKey");
    const secretKey = resolvedEnvValue("recaptcha", "secretKey");
    if (siteKey && secretKey) enabled = true;
  }
  if (key === "paymongo") {
    // A secret key in .env is enough to make a fresh database usable; an
    // existing settings document still owns the on/off switch.
    if (resolvedEnvValue("paymongo", "secretKey")) enabled = true;
  }
  if (key === "gemini") {
    if (resolvedEnvValue("gemini", "apiKey")) enabled = true;
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
  googleMapsApiKeyFromEnv,
  googleCalendarFromEnv,
  settingsEncryptionKey,
  recaptchaFromEnv,
  paymongoFromEnv,
  geminiApiKeyFromEnv = "",
  persistEnvValue = null,
}) {
  capturedEnv = {
    googleAuth: { clientId: String(googleClientIdFromEnv || "") },
    googleMaps: { apiKey: String(googleMapsApiKeyFromEnv || "") },
    googleCalendar: googleCalendarFromEnv || {},
    recaptcha: recaptchaFromEnv || {},
    paymongo: paymongoFromEnv || {},
    gemini: { apiKey: String(geminiApiKeyFromEnv || "") },
  };
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
    /**
     * Super admin view: activation state only. Credentials are deliberately
     * excluded so this role cannot read or change integration configuration.
     */
    async superAdminIntegrations() {
      const keys = REGISTRY.map((r) => r.key);
      const docs = await settingsModel.findMany(keys);
      return {
        integrations: REGISTRY.map((reg) =>
          this.toggleShape(reg.key, effectiveDoc(reg.key, docs[reg.key] || null))
        ),
      };
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
     * Server-only Google sign-in config. Uses the same effective-document
     * resolution as GET /api/config so the audience check and the rendered
     * button always agree, including .env overrides.
     */
    async googleAuthConfig() {
      const docs = await settingsModel.findMany(["googleAuth"]);
      const effective = effectiveDoc("googleAuth", docs.googleAuth || null);
      return {
        enabled: !!effective.enabled,
        clientId: String(effective.credentials.clientId?.value || ""),
      };
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
     * Server-only Google Gemini AI config (includes decrypted API key).
     */
    async geminiConfig() {
      const docs = await settingsModel.findMany(["gemini"]);
      const effective = effectiveDoc("gemini", docs.gemini || null);
      return {
        enabled: !!effective.enabled,
        apiKey: String(effective.credentials.apiKey?.value || ""),
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
      // Plaintext values used for the required-credential check and for the
      // .env override write after the DB commit. Never serialized.
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
        if (!Object.prototype.hasOwnProperty.call(credentialWrites, cred.name)) {
          // Leave untouched credentials alone. In particular, do not copy an
          // env fallback into a new settings document: the env layer must stay
          // authoritative for as long as the admin has not saved a value.
          continue;
        }
        const cw = credentialWrites[cred.name];
        if (cw === null) {
          unset[`credentials.${cred.name}`] = "";
        } else {
          set[`credentials.${cred.name}`] = cw;
        }
      }

      return {
        enabled,
        changed,
        set,
        unset,
        set_on_insert: setOnInsert,
        // Internal only: used to mirror explicit admin values into .env.
        values: credentialValues,
      };
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
      if (key === "gemini" && name === "apiKey" && value !== "") {
        if (/\s/.test(value) || value.length < 20) {
          const err = new Error("Gemini API key must not contain whitespace and must be at least 20 characters");
          err.status = 422;
          throw err;
        }
      }
    },

    /**
     * settings_update with role-separated writes:
     *   admin       -> replace/clear credentials (enabled is rejected)
     *   super_admin -> flip enabled only (credentials are rejected)
     * The settings write and its audit log commit in one transaction.
     */
    async update(key, data, actor = {}) {
      // Role enforcement lives here as well as in the route guards: admins
      // configure credentials, super admins only flip activation.
      const actorRole = actor && actor.role;
      if (actorRole !== "admin" && actorRole !== "super_admin") {
        const err = new Error("admin only");
        err.status = 403;
        throw err;
      }
      const payload = data && typeof data === "object" && !Array.isArray(data) ? data : {};
      if (actorRole === "super_admin") {
        const fields = Object.keys(payload);
        if (fields.length === 0) {
          const err = new Error("enabled is required");
          err.status = 422;
          throw err;
        }
        if (fields.some((field) => field !== "enabled")) {
          const err = new Error("super administrators can only turn integrations on or off");
          err.status = 403;
          throw err;
        }
        if (typeof payload.enabled !== "boolean") {
          const err = new Error("enabled must be a boolean");
          err.status = 422;
          throw err;
        }
      } else if (Object.prototype.hasOwnProperty.call(payload, "enabled")) {
        const err = new Error("only a super administrator can turn integrations on or off");
        err.status = 403;
        throw err;
      }

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
      const plan = this.planUpdate(key, effective, payload);

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
        await activityLogs.insertOne(
          {
            actorId,
            action:
              actorRole === "super_admin"
                ? "integration_toggle"
                : "integration_settings_update",
            target: key,
            meta: { enabled: plan.enabled, changed: plan.changed, role: actorRole },
            at: new Date(),
          },
          { session }
        );
        return updated;
      };

      // Write the admin values to their *_OVERRIDE .env keys only after the
      // settings document + audit log committed. A failed disk write is logged
      // but does not roll back the DB save; process.env is already updated by
      // the env-file store so this process keeps using the new value.
      const persistCredentialOverrides = async () => {
        if (typeof persistEnvValue !== "function") return;
        for (const [name, value] of Object.entries(plan.values || {})) {
          const fields = ENV_CREDENTIALS[key]?.[name];
          if (!fields) continue;
          try {
            await persistEnvValue(fields.override, String(value ?? ""));
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              `[gamehub] could not write ${fields.override} to .env: ${
                err && err.message ? err.message : err
              }`
            );
          }
        }
      };

      // Transactions require a replica set (Atlas / local replSet). A standalone
      // mongod rejects them outright, so fall back to the two plain writes.
      let updatedDoc;
      if (await hasTransactionSupport(mongoClient)) {
        const session = mongoClient.startSession();
        try {
          updatedDoc = await session.withTransaction(() => apply(session));
        } finally {
          await session.endSession();
        }
      } else {
        updatedDoc = await apply(null);
      }

      await persistCredentialOverrides();
      const fresh = effectiveDoc(key, updatedDoc);
      return actorRole === "super_admin"
        ? this.toggleShape(key, fresh)
        : this.shape(key, fresh);
    },

    /** Shape for super admins: activation state, never credentials. */
    toggleShape(key, effective) {
      const reg = REGISTRY.find((r) => r.key === key);
      if (!reg) return null;
      return {
        key: reg.key,
        name: reg.name,
        description: reg.description,
        available: reg.available,
        enabled: effective.enabled,
        updatedAt: effective.updatedAt,
        updatedBy: effective.updatedBy,
      };
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
