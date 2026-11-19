// Feature access (RBAC matrix) — super-admin controlled permissions for the
// operational pages and endpoints each role can use.
//
// One matrix: every feature is a row, every role is a column, every applicable
// cell is a switch. `FEATURES` is the single source of truth (label, roles,
// per-role description and protected API paths). A role that is not listed for
// a feature has no column cell (rendered "—" in the matrix) and cannot use it.
//
// Switch state lives in the `settings` collection (key `featureAccess`,
// `features.<feature>.<role>: boolean`), so it survives restarts and is DB
// authoritative. Missing documents/cells mean "on": existing installations
// keep every feature until the super administrator turns one off.
//
// Routes are gated by `featureAccessScope` in middleware/featureAccess.js, so
// a switched-off cell is enforced by the server, not just hidden in the UI.
import { HttpError } from "../utils/HttpError.js";

export const FEATURE_ACCESS_SETTINGS_KEY = "featureAccess";

// How long a process trusts its cached copy before re-reading Atlas. The
// process that performs an update refreshes immediately; the TTL only bounds
// staleness if the backend is ever run as more than one instance.
const CACHE_TTL_MS = 30_000;

export const FEATURES = [
  {
    key: "staff",
    label: "Staff & invitations",
    description:
      "Invite staff, edit nicknames and schedules, archive or restore accounts.",
    roles: ["admin"],
    paths: {
      admin: [{ path: "/admin/invitations" }, { path: "/admin/cashiers" }],
    },
  },
  {
    key: "tables",
    label: "Tables & rates",
    description: "Tables in the hall and their hourly rates.",
    roles: ["admin", "cashier"],
    paths: {
      admin: [{ path: "/admin/tables" }, { path: "/admin/rates" }],
      cashier: [{ path: "/cashier/tables" }],
    },
  },
  {
    key: "sessions",
    label: "Sessions & billing",
    description: "Play sessions, timers, F&B order lines and payments.",
    roles: ["admin", "cashier"],
    paths: {
      admin: [{ path: "/admin/sessions" }],
      cashier: [
        { path: "/cashier/sessions" },
        { path: "/cashier/transactions" },
      ],
    },
  },
  {
    key: "menu",
    label: "Menu & products",
    description: "Food and beverage catalogue and the items added to a bill.",
    roles: ["admin", "cashier"],
    paths: {
      admin: [{ path: "/admin/products" }],
      cashier: [{ path: "/cashier/products" }],
    },
  },
  {
    key: "transactions",
    label: "Transactions & reports",
    description: "Transaction history, income reports and the CSV export.",
    roles: ["admin"],
    paths: {
      admin: [{ path: "/admin/transactions" }, { path: "/admin/reports" }],
    },
  },
  {
    key: "activity",
    label: "Activity log",
    description: "Audit trail of staff and system actions.",
    roles: ["admin"],
    paths: { admin: [{ path: "/admin/activity-logs" }] },
  },
  {
    key: "reservations",
    label: "Reservations",
    description: "Customer reservation requests, accept/reject and check-in.",
    roles: ["cashier"],
    paths: {
      cashier: [
        // Only the cashier list is gated; the guest lookup below it
        // (/reservations/:ref) stays public.
        { path: "/reservations", exact: true, method: "GET" },
        { path: "/cashier/reservations" },
      ],
    },
  },
];

function pathMatches(rule, method, path) {
  if (!rule) return false;
  if (rule.method && rule.method !== method) return false;
  if (rule.exact) return path === rule.path;
  return path === rule.path || path.startsWith(`${rule.path}/`);
}

/**
 * Feature that protects one role's request, or null when the path is not
 * switchable for that role. Per-role path lists keep the matrix honest: a
 * cashier never inherits an administrator-only endpoint just because the
 * feature row exists.
 */
export function featureForRequest(role, method, path) {
  if (!role || !path) return null;
  // A trailing slash must not slip past the exact/prefix checks.
  const cleanPath = path.length > 1 ? path.replace(/\/+$/, "") : path;
  for (const feature of FEATURES) {
    if (!feature.roles.includes(role)) continue;
    const rules = feature.paths[role] || [];
    if (rules.some((rule) => pathMatches(rule, method, cleanPath))) {
      return feature.key;
    }
  }
  return null;
}

/** Stored cell key, e.g. `menu.cashier`. */
function cellKey(featureKey, role) {
  return `${featureKey}.${role}`;
}

function defaultValues() {
  const values = {};
  for (const feature of FEATURES) {
    for (const role of feature.roles) values[cellKey(feature.key, role)] = true;
  }
  return values;
}

/**
 * Read one cell. Cell keys contain a dot, and Mongo turns
 * `$set: {"features.menu.cashier": false}` into nested objects, so resolve the
 * path. A document written with a flat key is still accepted.
 */
function storedSwitch(stored, featureKey, role) {
  const flat = cellKey(featureKey, role);
  if (typeof stored[flat] === "boolean") return stored[flat];
  let value = stored;
  for (const part of [featureKey, role]) {
    if (!value || typeof value !== "object") return undefined;
    value = value[part];
  }
  return value;
}

function stateFromDoc(doc) {
  const values = defaultValues();
  const stored =
    doc && doc.features && typeof doc.features === "object" ? doc.features : {};
  for (const feature of FEATURES) {
    for (const role of feature.roles) {
      const saved = storedSwitch(stored, feature.key, role);
      if (typeof saved === "boolean") values[cellKey(feature.key, role)] = saved;
    }
  }
  return {
    values,
    updatedAt: (doc && doc.updatedAt) || null,
    updatedBy: (doc && doc.updatedBy) || null,
  };
}

export function featureAccessService({ settingsModel, db }) {
  let cache = null;
  let loadedAt = 0;
  let pending = null;

  async function load() {
    if (pending) return pending;
    pending = (async () => {
      let doc = null;
      try {
        doc = await settingsModel.findOne(FEATURE_ACCESS_SETTINGS_KEY);
      } catch {
        // Fail open on a read error: an unreadable switch must not lock every
        // operator out of their own dashboard. The settings read simply retries
        // after the TTL.
        doc = null;
      }
      cache = stateFromDoc(doc);
      loadedAt = Date.now();
      return cache;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  async function current() {
    if (cache && Date.now() - loadedAt < CACHE_TTL_MS) return cache;
    return load();
  }

  return {
    /** Re-read the switches now (bootstrap and tests). */
    async refresh() {
      cache = null;
      loadedAt = 0;
      return load();
    },

    /** Matrix payload: one row per feature, one access value per role. */
    async snapshot() {
      const state = await current();
      return {
        features: FEATURES.map((feature) => ({
          key: feature.key,
          label: feature.label,
          description: feature.description,
          roles: [...feature.roles],
          access: Object.fromEntries(
            feature.roles.map((role) => [
              role,
              state.values[cellKey(feature.key, role)] !== false,
            ])
          ),
        })),
        updatedAt: state.updatedAt,
        updatedBy: state.updatedBy,
      };
    },

    /** Enabled feature keys for one role (sent with GET /api/me). */
    async enabledFor(role) {
      const state = await current();
      return FEATURES.filter(
        (feature) =>
          feature.roles.includes(role) &&
          state.values[cellKey(feature.key, role)] !== false
      ).map((feature) => feature.key);
    },

    /** Boolean check used by the route guard for one role's cell. */
    async isEnabled(key, role) {
      const feature = FEATURES.find((f) => f.key === key);
      if (!feature || !feature.roles.includes(role)) return true;
      const state = await current();
      return state.values[cellKey(key, role)] !== false;
    },

    /**
     * Flip one or more cells. Payload keys are `<feature>.<role>`, e.g.
     * `{ features: { "menu.cashier": false } }`. Super administrator only;
     * unknown features, roles the feature does not apply to, and non-boolean
     * values are rejected before anything is written. The settings document
     * and the audit entry are written together, and the in-process cache is
     * refreshed so the next request already sees the change.
     */
    async update(payload, actor = {}) {
      if (!actor || actor.role !== "super_admin") {
        throw new HttpError(403, "super administrator only");
      }
      const features =
        payload && typeof payload === "object" ? payload.features : null;
      if (!features || typeof features !== "object" || Array.isArray(features)) {
        throw new HttpError(
          422,
          "features must be an object of { \"feature.role\": boolean }"
        );
      }
      const entries = Object.entries(features);
      if (entries.length === 0) {
        throw new HttpError(422, "nothing to update");
      }
      const known = new Map(FEATURES.map((feature) => [feature.key, feature]));
      const changes = {};
      for (const [cell, value] of entries) {
        const dot = cell.lastIndexOf(".");
        const key = dot > 0 ? cell.slice(0, dot) : cell;
        const role = dot > 0 ? cell.slice(dot + 1) : "";
        const feature = known.get(key);
        if (!feature) {
          throw new HttpError(422, `unknown feature: ${cell}`);
        }
        if (!feature.roles.includes(role)) {
          throw new HttpError(
            422,
            `${feature.label} does not apply to the ${role || "given"} role`
          );
        }
        if (typeof value !== "boolean") {
          throw new HttpError(422, `${cell} must be true or false`);
        }
        changes[cell] = value;
      }

      const now = new Date();
      const set = {
        key: FEATURE_ACCESS_SETTINGS_KEY,
        updatedAt: now,
        updatedBy: actor.email || null,
      };
      for (const [cell, value] of Object.entries(changes)) {
        // `cell` is already `feature.role`, which Mongo nests as-is.
        set[`features.${cell}`] = value;
      }

      await db.collection("settings").updateOne(
        { key: FEATURE_ACCESS_SETTINGS_KEY },
        { $set: set },
        { upsert: true }
      );
      await db.collection("activityLogs").insertOne({
        actorId: actor.id ? String(actor.id) : null,
        action: "feature_access_update",
        target: FEATURE_ACCESS_SETTINGS_KEY,
        meta: { changed: changes, role: actor.role },
        at: now,
      });

      cache = null;
      loadedAt = 0;
      return this.snapshot();
    },
  };
}
