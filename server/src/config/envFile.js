// Safe reader/writer for the server .env file.
//
// Settings > API writes admin-entered credentials to the matching
// `*_OVERRIDE` keys in server/.env. The file is updated in place so comments,
// ordering and CRLF/LF line endings survive; writes are serialized per process
// and committed with a temp-file rename so a crash cannot leave a half line.
import fs from "node:fs/promises";
import path from "node:path";

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Encode a value the way dotenv expects it.
 * Simple tokens stay unquoted; anything with spaces/#/quotes/newlines is
 * double-quoted. Newlines become \n so the whole value stays on one line
 * (dotenv expands them again when it loads the file).
 */
export function encodeEnvValue(value) {
  const text = value == null ? "" : String(value);
  if (text === "") return "";
  if (/^[A-Za-z0-9_./:@+=-]+$/.test(text)) return text;
  const escaped = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function splitBom(text) {
  const source = String(text ?? "");
  return source.startsWith("\uFEFF")
    ? { bom: "\uFEFF", body: source.slice(1) }
    : { bom: "", body: source };
}

/** True when `key` already has a line (active, not commented out) in `text`. */
export function hasEnvKey(text, key) {
  if (!KEY_RE.test(key)) return false;
  const { body } = splitBom(text);
  const matcher = new RegExp(
    `^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`,
    "m"
  );
  return matcher.test(body);
}

/**
 * Replace an existing KEY=... line or append a new one.
 * `onlyIfMissing` leaves the file untouched when the key already exists.
 */
export function upsertEnvText(text, key, value, { onlyIfMissing = false } = {}) {
  if (!KEY_RE.test(key)) {
    throw new Error(`invalid .env key: ${key}`);
  }
  const { bom, body } = splitBom(text);
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const matcher = new RegExp(
    `^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`
  );
  const encoded = encodeEnvValue(value);

  for (let i = 0; i < lines.length; i += 1) {
    if (!matcher.test(lines[i])) continue;
    if (onlyIfMissing) return bom + body;
    lines[i] = `${key}=${encoded}`;
    return bom + lines.join(eol);
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  lines.push(`${key}=${encoded}`, "");
  return bom + lines.join(eol);
}

/**
 * Create a store bound to one .env file.
 * `set` also updates process.env immediately, so the running server picks up
 * the new value even if the disk write is slow or fails.
 */
export function createEnvFileStore({ filePath, processEnv = process.env } = {}) {
  if (!filePath) throw new Error("env file path is required");
  let queue = Promise.resolve();

  async function readText() {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return "";
      throw err;
    }
  }

  async function writeAtomic(text) {
    const dir = path.dirname(filePath);
    const tmp = path.join(
      dir,
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
    );
    let mode = 0o600;
    try {
      mode = (await fs.stat(filePath)).mode & 0o777;
    } catch {
      // New file: keep the restrictive default.
    }
    await fs.writeFile(tmp, text, { encoding: "utf8", mode });
    try {
      await fs.rename(tmp, filePath);
    } catch {
      // Some Windows filesystems refuse rename-over-existing. Fall back to a
      // direct write, then remove the temp file.
      await fs.writeFile(filePath, text, { encoding: "utf8", mode });
      await fs.unlink(tmp).catch(() => {});
    }
  }

  function enqueue(task) {
    const run = queue.then(task, task);
    // Keep the chain alive after a failed write so later saves still work.
    queue = run.catch(() => {});
    return run;
  }

  return {
    /** Write KEY=value (or KEY= for an empty value). */
    set(key, value) {
      if (!KEY_RE.test(key)) {
        return Promise.reject(new Error(`invalid .env key: ${key}`));
      }
      const text = value == null ? "" : String(value);
      processEnv[key] = text;
      return enqueue(async () => {
        const current = await readText();
        await writeAtomic(upsertEnvText(current, key, text));
      });
    },

    /** Add KEY=value only when the key is missing; never overwrite. */
    ensure(key, value = "") {
      if (!KEY_RE.test(key)) {
        return Promise.reject(new Error(`invalid .env key: ${key}`));
      }
      return enqueue(async () => {
        const current = await readText();
        if (hasEnvKey(current, key)) return false;
        await writeAtomic(upsertEnvText(current, key, value));
        return true;
      });
    },
  };
}
