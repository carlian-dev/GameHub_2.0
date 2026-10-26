import express from "express";
import cors from "cors";
import session from "express-session";
import MongoStore from "connect-mongo";
import { validateEnv, env } from "./config/env.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
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
  })
);

// JSON only. PHP ignores form-encoded bodies.
app.use(express.json());
// Normalize missing bodies to {} like PHP's json_body().
app.use((req, res, next) => {
  if (req.body == null) req.body = {};
  next();
});

app.use(
  session({
    name: env.AUTH_COOKIE_NAME,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({
      mongoUrl: env.MONGODB_URI,
      dbName: env.MONGODB_DB,
      collectionName: "authSessions", // NOT "sessions"
      ttl: env.SESSION_TTL_SECONDS,
      autoRemove: "native",
    }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/",
    },
  })
);

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
export function setupRoutes(controllers) {
  const routes = apiRoutes({ controllers });
  app.use("/api", routes);

  // notFound and errorHandler must be mounted AFTER /api routes so they
  // only catch requests that didn't match any route.
  app.use(notFound);
  app.use(errorHandler);
}

export default app;
