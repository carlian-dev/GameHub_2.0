import { env } from "./config/env.js";
import { closeDb } from "./config/db.js";
import app from "./app.js";
import { wireApp } from "./bootstrap.js";

// Startup order matters: connect + wire routes BEFORE accepting traffic.
// Wiring used to happen inside the listen() callback, so a MongoDB failure
// left a listening socket with no /api routes (every request 404) and then
// killed the process with an unhandled rejection. A clear message + exit(1)
// is better than a half-started server.
let server = null;

async function start() {
  try {
    // bootstrap.js owns the dependency graph (models → services → controllers
    // → routes); the contract runner calls the same wireApp() so both see the
    // identical app.
    await wireApp();

    server = app.listen(env.PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`[gamehub] node backend listening on http://localhost:${env.PORT}`);
      // eslint-disable-next-line no-console
      console.log("[gamehub] API routes wired");
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[gamehub] startup failed:", err && err.message ? err.message : err);
    if (/querySrv|ECONNREFUSED|ENOTFOUND/i.test(String(err && err.code) + String(err && err.message))) {
      // eslint-disable-next-line no-console
      console.error(
        "[gamehub] MongoDB SRV lookup failed. If the OS can resolve the cluster but Node cannot,\n" +
        "[gamehub] set MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1 in server/.env."
      );
    }
    process.exit(1);
  }
}

start();

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[gamehub] ${signal} received, shutting down`);
  if (!server) process.exit(0);
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export default server;
