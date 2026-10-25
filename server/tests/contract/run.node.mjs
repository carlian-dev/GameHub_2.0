// Contract runner entry: run JSON cases against the Node Express app.
// Requires a test database (MONGODB_DB ending in _migtest) reachable.
// Usage: MONGODB_DB=gamehub_2_0_migtest node tests/contract/run.node.mjs
import app from "../src/app.js";
import { runCases, summarize } from "./runner.js";

const casesDir = new URL("./cases", import.meta.url).pathname;

runCases({ app, casesDir })
  .then((results) => {
    process.stdout.write(summarize(results));
    process.exit(results.failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    process.stderr.write(`[contract:node] fatal: ${err.message}\n`);
    process.exit(1);
  });
