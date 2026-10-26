// Contract runner entry: run JSON cases against the Node Express app.
// Requires a test database (MONGODB_DB ending in _migtest) reachable.
// Usage: MONGODB_DB=gamehub_2_0_migtest node tests/contract/run.node.mjs
import { fileURLToPath } from "node:url";
import app from "../../src/app.js";
import { wireApp } from "../../src/bootstrap.js";
import { runCases, summarize } from "./runner.js";

const casesDir = fileURLToPath(new URL("./cases", import.meta.url));

// Never send real mail from tests: the invite service logs the link instead
// (same dry-run path the PHP tests used).
if (process.env.MAIL_DRY_RUN !== "1") process.env.MAIL_DRY_RUN = "1";

// Routes are mounted only after the DB is wired (same path server.js takes),
// so build the dependency graph before running any case.
wireApp()
  .then(() => runCases({ app, casesDir }))
  .then((results) => {
    process.stdout.write(summarize(results));
    process.exit(results.failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    process.stderr.write(`[contract:node] fatal: ${err.message}\n`);
    process.exit(1);
  });
