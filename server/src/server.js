import { env } from "./config/env.js";
import { closeDb } from "./config/db.js";
import app from "./app.js";
import { wireApp } from "./bootstrap.js";

const server = app.listen(env.PORT, async () => {
  // eslint-disable-next-line no-console
  console.log(`[gamehub] node backend listening on http://localhost:${env.PORT}`);
  try {
    await wireApp();
    // eslint-disable-next-line no-console
    console.log("[gamehub] API routes wired");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[gamehub] failed to wire API routes:", err && err.message ? err.message : err);
  }
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[gamehub] ${signal} received, shutting down`);
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export default server;
