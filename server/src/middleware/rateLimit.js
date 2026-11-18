// Rate limiting using express-rate-limit (npm).
//
// Four limiters cover the shapes of traffic this API sees:
//   api          every /api request, per IP (runs before the body parser)
//   auth         login / authenticator changes / register / invite lookup
//                (brute-force guard; successful requests do not count)
//   writes       POST/PUT/PATCH/DELETE (per logged-in user, otherwise per IP)
//   reservations public booking create/lookup/cancel (guests only)
//
// Counters live in express-rate-limit's in-memory store: one window per
// process, reset on restart. That is deliberate - JWT auth needs no per-request
// session read, and a Mongo-backed counter would add a write per request just
// to protect the API from abuse. A separate store (Redis, rate-limit-mongo) is
// only needed if the backend ever runs as more than one process.
//
// Disable with RATE_LIMIT_ENABLED=0 (contract tests do this). Limits are
// configured in server/src/config/env.js and documented in .env.example.
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
  if (!config.enabled) {
    return { api: passThrough, auth: passThrough, writes: passThrough, reservations: passThrough };
  }
  return {
    api: build("api", config.api),
    auth: build("auth", config.auth, { skipSuccessfulRequests: true }),
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
