// Rate limiting using express-rate-limit (npm).
//
// Thirteen limiters cover the shapes of traffic this API sees:
//   api               every /api request, per IP (runs before the body parser)
//   auth              login / authenticator changes / register / invite lookup
//                     (IP-based; unsuccessful requests count)
//   writes            POST/PUT/PATCH/DELETE (per user, otherwise per IP)
//   actions           one mutation per method+path+payload per short window,
//                     so a double-clicked button cannot fire the same action
//                     twice
//   reservations      public booking create/lookup/cancel (guests only)
//   staffLists        reservation/session/transaction list reads
//   reports           admin income reports (daily/monthly/income)
//   exports           CSV report generation
//   audit             activity-log reads (admin and self)
//   notifications     reservation accept (calendar + mail), invitations, and
//                     password-reset mail
//   integrationChecks super-admin provider validation on credential changes
//   profileEdits      self-service profile updates (2MB avatar payloads)
//   health            public health probe
//
// Counters live in express-rate-limit's in-memory store: one window per
// process, reset on restart. That is deliberate - JWT auth needs no per-request
// session read, and a Mongo-backed counter would add a write per request just
// to protect the API from abuse. A separate store (Redis, rate-limit-mongo) is
// only needed if the backend ever runs as more than one process.
//
// Disable with RATE_LIMIT_ENABLED=0 (contract tests do this). Auth defaults
// come from env and can be changed at runtime by the super administrator.
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const FALLBACK = {
  apiWindowMs: 60 * 1000,
  apiLimit: 300,
  authWindowMs: 15 * 60 * 1000,
  authLimit: 10,
  writeLimit: 60,
  actionWindowMs: 1000,
  actionLimit: 1,
  reservationWindowMs: 10 * 60 * 1000,
  reservationLimit: 10,
  staffListWindowMs: 60 * 1000,
  staffListLimit: 60,
  reportWindowMs: 60 * 1000,
  reportLimit: 20,
  exportWindowMs: 10 * 60 * 1000,
  exportLimit: 5,
  auditWindowMs: 60 * 1000,
  auditLimit: 20,
  notificationWindowMs: 10 * 60 * 1000,
  notificationLimit: 10,
  integrationWindowMs: 15 * 60 * 1000,
  integrationLimit: 10,
  profileWindowMs: 60 * 1000,
  profileLimit: 5,
  healthWindowMs: 60 * 1000,
  healthLimit: 30,
};

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Build a key per signed-in user, falling back to the normalized IP for
 * anonymous traffic. ipKeyGenerator() collapses IPv6 clients to a /56 subnet
 * so one client cannot rotate addresses through the whole prefix.
 */
function clientKey(name) {
  return (req) => {
    const user = req.authUser;
    if (user && user.id) return `${name}:user:${String(user.id)}`;
    return `${name}:ip:${ipKeyGenerator(req.ip)}`;
  };
}

function ipOnlyKey(name) {
  return (req) => `${name}:ip:${ipKeyGenerator(req.ip)}`;
}

// Per-action key: the same user/IP may not repeat one method+path+payload
// faster than the configured cooldown. The payload is part of the key so two
// genuinely different actions on one collection endpoint (e.g. adding two
// different menu items) are not treated as a double-click.
const actionClientKey = clientKey("actions");
function bodyFingerprint(body) {
  if (!body || typeof body !== "object") return "";
  let text;
  try {
    text = JSON.stringify(body);
  } catch {
    return "";
  }
  // Huge payloads (profile avatars) are rare; let them share one bucket
  // rather than hashing megabytes on every request.
  if (text.length > 2048) return "large";
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function actionKey(req) {
  const fingerprint = bodyFingerprint(req.body);
  return `${actionClientKey(req)}:${req.method}:${req.path}${
    fingerprint ? `:${fingerprint}` : ""
  }`;
}

class DynamicWindowStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.clients = new Map();
    this.localKeys = true;
    this.cleanupTimer = setInterval(() => this.clearExpired(), 60_000);
    this.cleanupTimer.unref?.();
  }

  currentWindowMs() {
    return positiveInt(this.windowMs(), FALLBACK.authWindowMs);
  }

  async get(key) {
    const client = this.clients.get(key);
    if (!client) return undefined;
    const resetTime = new Date(client.startedAt + this.currentWindowMs());
    if (resetTime.getTime() <= Date.now()) {
      this.clients.delete(key);
      return undefined;
    }
    return { totalHits: client.totalHits, resetTime };
  }

  async increment(key) {
    const now = Date.now();
    const windowMs = this.currentWindowMs();
    let client = this.clients.get(key);
    if (!client || now >= client.startedAt + windowMs) {
      client = { totalHits: 0, startedAt: now };
    }
    client.totalHits += 1;
    this.clients.set(key, client);
    return {
      totalHits: client.totalHits,
      resetTime: new Date(client.startedAt + windowMs),
    };
  }

  async decrement(key) {
    const client = this.clients.get(key);
    if (!client) return;
    if (client.totalHits <= 1) this.clients.delete(key);
    else client.totalHits -= 1;
  }

  async resetKey(key) {
    this.clients.delete(key);
  }

  async resetAll() {
    this.clients.clear();
  }

  clearExpired() {
    const now = Date.now();
    const windowMs = this.currentWindowMs();
    for (const [key, client] of this.clients) {
      if (now >= client.startedAt + windowMs) this.clients.delete(key);
    }
  }

  shutdown() {
    clearInterval(this.cleanupTimer);
    this.clients.clear();
  }
}

function limitReached(name) {
  return (req, res) => {
    // Deliberately log no URL: paths can contain invitation/reservation
    // references, and those must never reach log files.
    logger("warn", "rate limit exceeded", { limiter: name, method: req.method });
    res.status(429).json({
      ok: false,
      error: "too many requests, please try again later",
    });
  };
}

function authRateLimitHeaders(req, res) {
  const info = req.rateLimit;
  if (!info) return;
  const resetSeconds = info.resetTime
    ? Math.max(0, Math.ceil((info.resetTime.getTime() - Date.now()) / 1000))
    : 0;
  res.setHeader("X-Auth-Attempts-Limit", String(info.limit));
  res.setHeader("X-Auth-Attempts-Remaining", String(info.remaining));
  res.setHeader("X-Auth-Attempts-Reset", String(resetSeconds));
  if (info.remaining === 0) res.setHeader("Retry-After", String(resetSeconds));
}

/** Resolve limiters from an env-like object; exported so tests can inject one. */
export function resolveRateLimitConfig(source = env) {
  const flag = source.RATE_LIMIT_ENABLED;
  const disabled = flag === false || flag === "0" || flag === "false";
  return {
    enabled: !disabled,
    api: {
      windowMs: positiveInt(source.RATE_LIMIT_WINDOW_MS, FALLBACK.apiWindowMs),
      limit: positiveInt(source.RATE_LIMIT_MAX, FALLBACK.apiLimit),
    },
    auth: {
      windowMs: positiveInt(source.AUTH_RATE_LIMIT_WINDOW_MS, FALLBACK.authWindowMs),
      limit: positiveInt(source.AUTH_RATE_LIMIT_MAX, FALLBACK.authLimit),
    },
    writes: {
      windowMs: positiveInt(source.RATE_LIMIT_WINDOW_MS, FALLBACK.apiWindowMs),
      limit: positiveInt(source.WRITE_RATE_LIMIT_MAX, FALLBACK.writeLimit),
    },
    actions: {
      windowMs: positiveInt(
        source.ACTION_RATE_LIMIT_WINDOW_MS,
        FALLBACK.actionWindowMs
      ),
      limit: positiveInt(source.ACTION_RATE_LIMIT_MAX, FALLBACK.actionLimit),
    },
    reservations: {
      windowMs: positiveInt(
        source.RESERVATION_RATE_LIMIT_WINDOW_MS,
        FALLBACK.reservationWindowMs
      ),
      limit: positiveInt(source.RESERVATION_RATE_LIMIT_MAX, FALLBACK.reservationLimit),
    },
    staffLists: {
      windowMs: positiveInt(
        source.STAFF_LIST_RATE_LIMIT_WINDOW_MS,
        FALLBACK.staffListWindowMs
      ),
      limit: positiveInt(source.STAFF_LIST_RATE_LIMIT_MAX, FALLBACK.staffListLimit),
    },
    reports: {
      windowMs: positiveInt(
        source.REPORT_RATE_LIMIT_WINDOW_MS,
        FALLBACK.reportWindowMs
      ),
      limit: positiveInt(source.REPORT_RATE_LIMIT_MAX, FALLBACK.reportLimit),
    },
    exports: {
      windowMs: positiveInt(
        source.EXPORT_RATE_LIMIT_WINDOW_MS,
        FALLBACK.exportWindowMs
      ),
      limit: positiveInt(source.EXPORT_RATE_LIMIT_MAX, FALLBACK.exportLimit),
    },
    audit: {
      windowMs: positiveInt(
        source.AUDIT_RATE_LIMIT_WINDOW_MS,
        FALLBACK.auditWindowMs
      ),
      limit: positiveInt(source.AUDIT_RATE_LIMIT_MAX, FALLBACK.auditLimit),
    },
    notifications: {
      windowMs: positiveInt(
        source.NOTIFICATION_RATE_LIMIT_WINDOW_MS,
        FALLBACK.notificationWindowMs
      ),
      limit: positiveInt(
        source.NOTIFICATION_RATE_LIMIT_MAX,
        FALLBACK.notificationLimit
      ),
    },
    integrationChecks: {
      windowMs: positiveInt(
        source.INTEGRATION_RATE_LIMIT_WINDOW_MS,
        FALLBACK.integrationWindowMs
      ),
      limit: positiveInt(
        source.INTEGRATION_RATE_LIMIT_MAX,
        FALLBACK.integrationLimit
      ),
    },
    profileEdits: {
      windowMs: positiveInt(
        source.PROFILE_RATE_LIMIT_WINDOW_MS,
        FALLBACK.profileWindowMs
      ),
      limit: positiveInt(source.PROFILE_RATE_LIMIT_MAX, FALLBACK.profileLimit),
    },
    health: {
      windowMs: positiveInt(
        source.HEALTH_RATE_LIMIT_WINDOW_MS,
        FALLBACK.healthWindowMs
      ),
      limit: positiveInt(source.HEALTH_RATE_LIMIT_MAX, FALLBACK.healthLimit),
    },
  };
}

function build(name, { windowMs, limit }, extra = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7", // RateLimit-* + Retry-After on 429
    legacyHeaders: false,
    keyGenerator: clientKey(name),
    handler: limitReached(name),
    ...extra,
  });
}

/**
 * Create the limiter set. `config` defaults to the env values; tests pass a
 * small window/limit so they do not need to sleep.
 */
export function createRateLimiters(config = resolveRateLimitConfig()) {
  const passThrough = (req, res, next) => next();
  let authConfig = { ...config.auth };
  const result = {
    configureAuth(nextConfig) {
      const limit = positiveInt(nextConfig && nextConfig.limit, FALLBACK.authLimit);
      const windowMs = positiveInt(
        nextConfig && nextConfig.windowMs,
        FALLBACK.authWindowMs
      );
      authConfig = { limit, windowMs };
      return { ...authConfig };
    },
  };
  if (!config.enabled) {
    return {
      ...result,
      api: passThrough,
      auth: passThrough,
      writes: passThrough,
      actions: passThrough,
      reservations: passThrough,
      staffLists: passThrough,
      reports: passThrough,
      exports: passThrough,
      audit: passThrough,
      notifications: passThrough,
      integrationChecks: passThrough,
      profileEdits: passThrough,
      health: passThrough,
    };
  }
  const authStore = new DynamicWindowStore(() => authConfig.windowMs);
  const authLimiter = rateLimit({
    windowMs: authConfig.windowMs,
    limit: () => authConfig.limit,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: ipOnlyKey("auth"),
    store: authStore,
    skipSuccessfulRequests: true,
    handler: (req, res) => {
      authRateLimitHeaders(req, res);
      limitReached("auth")(req, res);
    },
  });
  const auth = (req, res, next) => authLimiter(req, res, (error) => {
    if (error) return next(error);
    authRateLimitHeaders(req, res);
    next();
  });
  return {
    ...result,
    api: build("api", config.api),
    auth,
    writes: build("writes", config.writes, {
      // Reads are covered by the broader `api` limiter.
      skip: (req) => !WRITE_METHODS.has(req.method),
    }),
    // Cooldown after a mutation: a mashed button gets a 429 with Retry-After
    // instead of executing twice. Reads are skipped (search/polling stay fast).
    actions: build("actions", config.actions, {
      skip: (req) => !WRITE_METHODS.has(req.method),
      keyGenerator: actionKey,
    }),
    reservations: build("reservations", config.reservations, {
      // Signed-in staff use the same guest routes for reference lookups; brute
      // force protection is for anonymous visitors, so let staff through (the
      // api/writes budgets still apply to them).
      skip: (req) => Boolean(req.authUser),
     }),
    staffLists: build("staffLists", config.staffLists),
    reports: build("reports", config.reports),
    exports: build("exports", config.exports),
    audit: build("audit", config.audit),
    notifications: build("notifications", config.notifications),
    integrationChecks: build("integrationChecks", config.integrationChecks),
    profileEdits: build("profileEdits", config.profileEdits),
    health: build("health", config.health),
  };
}

// Shared instances mounted in app.js / route groups. One store each, so a
// wide-open GET cannot eat the write budget.
export const rateLimiters = createRateLimiters();

export function configureAuthRateLimit(config) {
  return rateLimiters.configureAuth(config);
}
