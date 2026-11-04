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
let sessionSweepTimer = null;

async function start() {
  try {
    // bootstrap.js owns the dependency graph (models → services → controllers
    // → routes); the contract runner calls the same wireApp() so both see the
    // identical app.
    const { services } = await wireApp();

    // Sessions must end when their countdown reaches 0:00 even if no cashier
    // has a dashboard open. A startup pass clears any downtime backlog, then
    // a short interval closes sessions at expiry. list()/start() also sweep
    // lazily so the next request always sees an already-ended session.
    const sweepSessions = async () => {
      try {
        const { closed } = await services.session.autoEndExpired();
        if (closed > 0) {
          // eslint-disable-next-line no-console
          console.log(`[gamehub] auto-ended ${closed} session(s) at time up`);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          "[gamehub] session auto-end sweep failed:",
          err && err.message ? err.message : err
        );
      }
    };
    await sweepSessions();
    sessionSweepTimer = setInterval(sweepSessions, 15000);
    if (typeof sessionSweepTimer.unref === "function") sessionSweepTimer.unref();

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
  if (sessionSweepTimer) clearInterval(sessionSweepTimer);
  if (!server) process.exit(0);
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export default server;
