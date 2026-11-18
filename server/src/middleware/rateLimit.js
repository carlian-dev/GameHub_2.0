// Rate limiting using express-rate-limit (npm).
//
// Four limiters cover the shapes of traffic this API sees:
//   api          every /api request, per IP (runs before the body parser)
//   auth         login / authenticator changes / register / invite lookup
//                (IP-based; unsuccessful requests count)
//   writes       POST/PUT/PATCH/DELETE (per logged-in user, otherwise per IP)
//   reservations public booking create/lookup/cancel (guests only)
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
  reservationWindowMs: 10 * 60 * 1000,
  reservationLimit: 10,
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
    reservations: {
      windowMs: positiveInt(
        source.RESERVATION_RATE_LIMIT_WINDOW_MS,
        FALLBACK.reservationWindowMs
      ),
      limit: positiveInt(source.RESERVATION_RATE_LIMIT_MAX, FALLBACK.reservationLimit),
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
      reservations: passThrough,
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
    reservations: build("reservations", config.reservations, {
      // Signed-in staff use the same guest routes for reference lookups; brute
      // force protection is for anonymous visitors, so let staff through (the
      // api/writes budgets still apply to them).
      skip: (req) => Boolean(req.authUser),
     }),
  };
}

// Shared instances mounted in app.js / route groups. One store each, so a
// wide-open GET cannot eat the write budget.
export const rateLimiters = createRateLimiters();

export function configureAuthRateLimit(config) {
  return rateLimiters.configureAuth(config);
}
