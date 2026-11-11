// Unit tests for the server/.env writer used by Settings > API.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  upsertEnvText,
  hasEnvKey,
  createEnvFileStore,
} from "../../src/config/envFile.js";

describe("upsertEnvText", () => {
  it("replaces an existing key and keeps comments/order", () => {
    const text = "# comment\nRECAPTCHA_SECRET_KEY=old\nOTHER=1\n";
    const out = upsertEnvText(text, "RECAPTCHA_SECRET_KEY", "new value");
    assert.strictEqual(
      out,
      '# comment\nRECAPTCHA_SECRET_KEY="new value"\nOTHER=1\n'
    );
  });

  it("appends a missing key and preserves CRLF", () => {
    const text = "# comment\r\nA=1\r\n";
    const out = upsertEnvText(text, "B", "2");
    assert.strictEqual(out, "# comment\r\nA=1\r\nB=2\r\n");
  });

  it("does not overwrite with onlyIfMissing", () => {
    const text = "A=1\n";
    assert.strictEqual(
      upsertEnvText(text, "A", "2", { onlyIfMissing: true }),
      text
    );
  });

  it("encodes newlines so dotenv can expand them on load", () => {
    const out = upsertEnvText("", "PRIVATE_KEY", "line1\nline2");
    assert.strictEqual(out, 'PRIVATE_KEY="line1\\nline2"\n');
  });

  it("detects active keys but not commented ones", () => {
    assert.strictEqual(hasEnvKey("# A=1\nB=2\n", "A"), false);
    assert.strictEqual(hasEnvKey("# A=1\nB=2\n", "B"), true);
  });
});

describe("createEnvFileStore", () => {
  let dir;
  let file;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "gamehub-env-"));
    file = path.join(dir, ".env");
    await fs.writeFile(file, "# keep\nA=1\n", "utf8");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes the file and updates process.env immediately", async () => {
    const processEnv = {};
    const store = createEnvFileStore({ filePath: file, processEnv });
    await store.set("B", "two");
    assert.strictEqual(processEnv.B, "two");
    const text = await fs.readFile(file, "utf8");
    assert.strictEqual(text, "# keep\nA=1\nB=two\n");
  });

  it("ensure only adds missing keys", async () => {
    const store = createEnvFileStore({ filePath: file, processEnv: {} });
    assert.strictEqual(await store.ensure("A", "9"), false);
    assert.strictEqual(await store.ensure("C", ""), true);
    const text = await fs.readFile(file, "utf8");
    assert.match(text, /A=1/);
    assert.match(text, /C=\n/);
  });
});
