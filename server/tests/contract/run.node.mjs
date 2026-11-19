// Contract runner entry: run JSON cases against the Node Express app.
// Requires a test database (MONGODB_DB ending in _migtest) reachable.
// Usage: MONGODB_DB=gamehub_2_0_migtest node tests/contract/run.node.mjs
import { fileURLToPath } from "node:url";

const casesDir = fileURLToPath(new URL("./cases", import.meta.url));

// Never send real mail from tests: the invite service logs the link instead
// (same dry-run path the PHP tests used).
if (process.env.MAIL_DRY_RUN !== "1") process.env.MAIL_DRY_RUN = "1";

// Contract runs fire many requests from one address; repeated runs must not
// trip the rate limiter. Set before the dynamic imports below so config/env.js
// sees it (dotenv never overrides an existing process.env value).
process.env.RATE_LIMIT_ENABLED = "0";

const { default: app } = await import("../../src/app.js");
const { wireApp } = await import("../../src/bootstrap.js");
const { runCases, summarize } = await import("./runner.js");

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
