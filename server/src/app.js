import express from "express";
import cors from "cors";
import { validateEnv, env } from "./config/env.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { rateLimiters } from "./middleware/rateLimit.js";
import apiRoutes from "./routes/index.js";

validateEnv();

const app = express();

app.set("etag", false);

if (env.TRUST_PROXY && env.TRUST_PROXY !== "0") {
  const hops = Number(env.TRUST_PROXY);
  app.set("trust proxy", Number.isNaN(hops) ? env.TRUST_PROXY : hops);
}

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    // Let the frontend read Retry-After on a 429 if it wants to show a wait.
    exposedHeaders: ["Retry-After"],
  })
);

// The broad /api budget runs before the JSON body parser on purpose: a flood
// of malformed bodies must still be throttled, and it is cheap to reject
// before parsing. Anonymous and signed-in traffic share this per-IP budget.
app.use("/api", rateLimiters.api);

// JSON only: the frontend always sends application/json.
app.use(express.json());
// Normalize missing bodies to {} so handlers can destructure safely.
app.use((req, res, next) => {
  if (req.body == null) req.body = {};
  next();
});

// Authentication is stateless: the JWT is read from an HttpOnly cookie inside
// the API router, where the user document can verify tokenVersion/status. The
// write budget is mounted there too so it can key signed-in traffic by user id
// instead of sharing one bucket per cafe IP.

// Root service probe (divergence #6: service string says Node).
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "GameHub_2.0 Backend (Node)",
    db: env.MONGODB_DB,
    endpoints: ["GET /api/health", "POST /api/login", "GET /api/me"],
  });
});

// Mount API routes once the DB is wired (called from server.js after getDb()).
export function setupRoutes(controllers, { authenticate } = {}) {
  const routes = apiRoutes({ controllers, authenticate });
  app.use("/api", routes);

  // notFound and errorHandler must be mounted AFTER /api routes so they
  // only catch requests that didn't match any route.
  app.use(notFound);
  app.use(errorHandler);
}

export default app;
