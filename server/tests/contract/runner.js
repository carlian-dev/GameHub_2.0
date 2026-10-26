// Contract / parity test runner.
// Runs JSON cases under tests/contract/cases/*.json against the Express app,
// normalizes dynamic fields, and compares status + body. Guards: refuses to run
// unless MONGODB_DB ends with _migtest (migration.md §16).
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { validateEnv, env, assertTestDb } from "../../src/config/env.js";
import { getDb } from "../../src/config/db.js";
import { normalizeResponse, DYN } from "./normalize.js";
import { loginAs } from "./cookieJar.js";

// Seed credentials written by scripts/resetDb.js (same defaults, overridable).
const SEED_ADMIN = {
  role: "admin",
  email: process.env.SEED_ADMIN_EMAIL || "admin@gamehub.local",
  password: process.env.SEED_ADMIN_PASSWORD || "AdminPass123!",
};
const SEED_CASHIER = {
  role: "cashier",
  username: process.env.SEED_CASHIER_USERNAME || "cashier1",
  password: process.env.SEED_CASHIER_PASSWORD || "CashierPass123!",
};

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
  // "<dyn>" in a case file is a wildcard: any actual value is accepted
  // (ids, timestamps, emails seeded per run, ...).
  if (b === DYN) {
    return [];
  }
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

// Build a supertest request for the case's method. `target` is either the
// Express app (public cases) or a logged-in cookie-jar agent (role cases).
// `app.get(path)` with a single argument is Express's settings getter, so every
// call goes through supertest instead.
function requestFor(target, method, path) {
  const r = typeof target === "function" ? request(target) : target;
  const m = String(method).toUpperCase();
  if (m === "GET") return r.get(path);
  if (m === "POST") return r.post(path);
  if (m === "PUT") return r.put(path);
  if (m === "PATCH") return r.patch(path);
  if (m === "DELETE") return r.delete(path);
  if (m === "OPTIONS") return r.options(path);
  throw new Error(`unsupported method ${method}`);
}

// Cases carry no explicit auth: infer the session from the route prefix.
function roleFor(casePath) {
  if (casePath.startsWith("/api/admin/")) return "admin";
  if (casePath.startsWith("/api/cashier/")) return "cashier";
  return null;
}

// Resolve the literal "<dyn>" placeholder in a path/body against live fixture
// data (seeded by scripts/resetDb.js). Returns null when no fixture exists,
// which leaves the placeholder in place and fails the case visibly.
async function resolveDyn(db, c) {
  const casePath = c.path;
  const body = c.body;
  const id = c.id || "";
  const wantOccupied = id.includes("not_available") || casePath.includes("not_available");

  const find = (collection, query) => db.collection(collection).findOne(query);

  let dyn = null;
  const wantsArchived = id.includes("unarchive") || /unarchive$/.test(casePath);
  if (/\/invitations\/<dyn>/.test(casePath)) {
    dyn = (await find("invitations", {}))?._id;
  } else if (/\/cashiers\/<dyn>/.test(casePath)) {
    // "admin target" cases target the admin account (archiving it is refused).
    const isAdminTarget = id.includes("admin_cannot") || c.route.includes("admin target");
    const filter = isAdminTarget
      ? { role: "admin" }
      : wantsArchived
        ? { role: "cashier", status: "archived" }
        : { role: "cashier" };
    dyn = (await find("users", filter))?._id;
  } else if (/\/tables\/<dyn>/.test(casePath)) {
    const filter = wantsArchived
      ? { archived: true }
      : wantOccupied
        ? { status: "occupied" }
        : { archived: false };
    dyn = (await find("tables", filter))?._id;
  } else if (/\/sessions\/<dyn>/.test(casePath)) {
    dyn = (await find("sessions", { status: "active" }))?._id;
  } else if (/\/transactions\/<dyn>/.test(casePath)) {
    dyn = (await find("transactions", {}))?.ref;
  }

  const outPath = dyn ? casePath.replace("<dyn>", String(dyn)) : casePath;
  const outBody = body && typeof body === "object" ? { ...body } : body;

  if (outBody && typeof outBody === "object") {
    if (outBody.tableId === "<dyn>") {
      const table = await find(
        "tables",
        wantOccupied ? { status: "occupied" } : { status: "available", archived: false }
      );
      outBody.tableId = table ? String(table._id) : outBody.tableId;
    }
    if (outBody.sessionId === "<dyn>") {
      const session = await find("sessions", { status: "active" });
      outBody.sessionId = session ? String(session._id) : outBody.sessionId;
    }
  }

  return { path: outPath, body: outBody };
}

export async function runCases({ app, casesDir }) {
  assertTestDb(env.MONGODB_DB);
  const cases = loadCases(casesDir);
  const results = { passed: 0, failed: 0, cases: [] };
  const db = await getDb();

  // One logged-in agent per role, reused across cases (cookie-jar helper).
  const agents = {};

  for (const c of cases) {
    const entry = { id: c.id, route: c.route, ok: false, diffs: [], error: null };
    try {
      const target = await resolveDyn(db, c);
      const role = roleFor(target.path);

      let req;
      if (role) {
        if (!agents[role]) {
          agents[role] = role === "admin" ? await loginAs(app, SEED_ADMIN) : await loginAs(app, SEED_CASHIER);
        }
        req = requestFor(agents[role], c.method, target.path);
      } else {
        req = requestFor(app, c.method, target.path);
      }
      if (c.query) req = req.query(c.query);
      if (target.body !== undefined) req = req.send(target.body);
      if (c.headers) req = req.set(c.headers);
      const res = await req;

      if (res.status !== c.expect.status) {
        entry.diffs.push(`status ${res.status} vs expected ${c.expect.status}`);
      }
      // CSV/text cases (e.g. reports.export.csv) compare the raw body; JSON
      // cases compare the parsed body.
      const actualBody =
        typeof c.expect.body === "string" && typeof res.text === "string" ? res.text : res.body;
      const normActual = normalizeResponse({ status: res.status, headers: res.headers, body: actualBody });
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
