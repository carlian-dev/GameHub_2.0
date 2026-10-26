// Contract / parity test runner.
// Runs JSON cases under tests/contract/cases/*.json against the Express app,
// normalizes dynamic fields, and compares status + body. Guards: refuses to run
// unless MONGODB_DB ends with _migtest (migration.md §16).
import fs from "node:fs";
import path from "node:path";
import { validateEnv, env, assertTestDb } from "../../src/config/env.js";
import { normalizeResponse } from "./normalize.js";

// Approved divergences from migration.md §14 (the ONLY allowed diffs).
export const DIVERGENCE_ALLOWLIST = [
  "root service string says Node instead of PHP",
  "unexpected 500 returns generic message",
  "/api/me status re-check destroys session",
  "duplicate key maps to 409",
  "session lifetime 12h rolling",
  "explicit cookie flags",
  "ETag disabled",
];

function loadCases(dir) {
  const cases = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    cases.push(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
  }
  return cases;
}

function diff(a, b, pathPrefix = "") {
  const diffs = [];
  if (typeof a !== typeof b) {
    diffs.push(`${pathPrefix || "root"}: type mismatch ${typeof a} vs ${typeof b}`);
    return diffs;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${pathPrefix || "root"}: array length ${a.length} vs ${b.length}`);
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      diffs.push(...diff(a[i], b[i], `${pathPrefix || "root"}[${i}]`));
    }
    return diffs;
  }
  if (a && b && typeof a === "object" && !Array.isArray(a)) {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) {
      diffs.push(...diff(a[k], b[k], `${pathPrefix || "root"}.${k}`));
    }
    return diffs;
  }
  if (a !== b) {
    diffs.push(`${pathPrefix || "root"}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
  return diffs;
}

function requestFor(app, method, path) {
  const m = String(method).toUpperCase();
  if (m === "GET") return app.get(path);
  if (m === "POST") return app.post(path);
  if (m === "PUT") return app.put(path);
  if (m === "DELETE") return app.delete(path);
  if (m === "OPTIONS") return app.options(path);
  throw new Error(`unsupported method ${method}`);
}

export async function runCases({ app, casesDir }) {
  assertTestDb(env.MONGODB_DB);
  const cases = loadCases(casesDir);
  const results = { passed: 0, failed: 0, cases: [] };

  for (const c of cases) {
    const entry = { id: c.id, route: c.route, ok: false, diffs: [], error: null };
    try {
      let req = requestFor(app, c.method, c.path);
      if (c.query) req = req.query(c.query);
      if (c.body !== undefined) req = req.send(c.body);
      if (c.headers) req = req.set(c.headers);
      const res = await req;

      if (res.status !== c.expect.status) {
        entry.diffs.push(`status ${res.status} vs expected ${c.expect.status}`);
      }
      const normActual = normalizeResponse(res);
      const normExpected = normalizeResponse({
        status: c.expect.status,
        headers: c.expect.headers || {},
        body: c.expect.body || {},
      });
      entry.diffs.push(...diff(normActual.body, normExpected.body));
      entry.ok = entry.diffs.length === 0;
    } catch (err) {
      entry.error = err.message;
    }
    if (entry.ok) results.passed += 1;
    else results.failed += 1;
    results.cases.push(entry);
  }
  return results;
}

export function summarize(results) {
  let out = `[contract] ${results.passed} passed, ${results.failed} failed\n`;
  for (const c of results.cases) {
    const mark = c.ok ? "ok  " : "FAIL";
    out += `  ${mark} ${c.id} (${c.route})\n`;
    for (const d of c.diffs) out += `      - ${d}\n`;
    if (c.error) out += `      error: ${c.error}\n`;
  }
  return out;
}
