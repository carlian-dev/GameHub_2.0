// Settings service — business rules for settings endpoints.
// migration.md §13.6: DB authoritative, env defaults only when doc absent,
// masked credentials, fail-closed config, transaction + audit on update.
import { maskValue } from "../utils/mask.js";

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
    key: "recaptcha",
    name: "reCAPTCHA",
    description: "Bot protection (planned)",
    available: false,
    credentials: [
      { name: "siteKey", label: "Site key", required: false, secret: false },
      { name: "secretKey", label: "Secret key", required: false, secret: true },
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

function effectiveDoc(key, doc) {
  const reg = REGISTRY.find((r) => r.key === key);
  if (!reg) return null;
  const basis = doc || defaultDoc(key);
  const credentials = {};
  for (const cred of reg.credentials) {
    const raw = basis.credentials && basis.credentials[cred.name] ? basis.credentials[cred.name] : {};
    credentials[cred.name] = { value: String(raw.value || ""), last4: String(raw.last4 || "") };
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
    credentials[cred.name] = { value: "", last4: "" };
  }
  let enabled = false;
  if (key === "googleMaps") enabled = true;
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

export function settingsService({ settingsModel, db, mongoClient, googleClientIdFromEnv }) {
  return {
    registry() {
      return REGISTRY;
    },
    async publicConfig() {
      try {
        const docs = await settingsModel.findMany(["googleAuth", "googleMaps"]);
        const auth = effectiveDoc("googleAuth", docs.googleAuth || null);
        const maps = effectiveDoc("googleMaps", docs.googleMaps || null);
        return {
          googleAuth: {
            enabled: auth.enabled,
            clientId: auth.enabled ? auth.credentials.clientId.value : "",
          },
          googleMaps: {
            enabled: maps.enabled,
            apiKey: maps.enabled ? maps.credentials.apiKey.value : "",
          },
        };
      } catch {
        // Fail closed (migration.md §13.6): both disabled/empty, HTTP 200.
        return {
          googleAuth: { enabled: false, clientId: "" },
          googleMaps: { enabled: false, apiKey: "" },
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
          if (!reg.credentials.some((c) => c.name === name)) {
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
          credentialWrites[name] = value === "" ? null : { value, last4: credentialHint(key, name, value), updatedAt: new Date() };
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
        const cw = credentialWrites[cred.name];
        const value = cw !== undefined ? String(cw.value ?? "") : String(effective.credentials[cred.name]?.value ?? "");
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
        setOnInsert[`credentials.${cred.name}`] = {
          value: String(current.value || ""),
          last4: String(current.last4 || ""),
          updatedAt: current.updatedAt || null,
        };
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
        if (/\s/.test(value) || !/^[A-Za-z0-9_-]{5,}\.apps\.googleusercontent\.com$/.test(value)) {
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
    },

    /**
     * settings_update: toggle integration and/or replace/clear credentials.
     * Settings write + integration_settings_update audit log in one transaction.
     */
    async update(key, data, adminEmail) {
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

      const existingDoc = await settingsColl.findOne({ key });
      const effective = effectiveDoc(key, existingDoc || null);
      const plan = this.planUpdate(key, effective, data);

      const set = { ...plan.set, updatedAt: new Date(), updatedBy: adminEmail };
      const update = { $set: set };
      if (Object.keys(plan.unset).length > 0) update.$unset = plan.unset;
      if (Object.keys(plan.set_on_insert).length > 0) update.$setOnInsert = plan.set_on_insert;

      const settingsColl = db.collection("settings");
      const activityLogs = db.collection("activityLogs");

      const session = mongoClient.startSession();
      try {
        await session.withTransaction(async () => {
          const updated = await settingsColl.findOneAndUpdate(
            { key },
            update,
            { upsert: true, returnDocument: "after", session }
          );
          if (!updated) {
            throw new Error("settings update returned no document");
          }
          const normalized = updated; // driver returns plain object already
          const shaped = this.shape(key, effectiveDoc(key, normalized));
          await activityLogs.insertOne(
            {
              actorId: null,
              action: "integration_settings_update",
              target: key,
              meta: { enabled: plan.enabled, changed: plan.changed },
              at: new Date(),
            },
            { session }
          );
          return shaped;
        });
      } finally {
        await session.endSession();
      }
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
