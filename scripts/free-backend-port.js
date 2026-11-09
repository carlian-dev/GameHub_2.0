#!/usr/bin/env node
// Free the backend port (default 8000) before starting the Node backend.
// A leftover node process from a previous run keeps serving stale code/data,
// which surfaces as "invalid credentials" / disabled Google sign-in.

const { execFileSync } = require("child_process");

const port = Number(process.argv[2] || 8000);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function listenerPids() {
  try {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
    const re = new RegExp(`[:.]${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "g");
    return [...new Set([...out.matchAll(re)].map((m) => Number(m[1])))];
  } catch {
    return [];
  }
}

for (const pid of listenerPids()) {
  console.log(`Port ${port} is held by PID ${pid}; stopping it.`);
  try {
    execFileSync("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" });
  } catch (e) {
    console.error(`Could not stop PID ${pid}: ${e.message}`);
    process.exit(1);
  }
}

for (let i = 0; i < 30 && listenerPids().length > 0; i++) sleep(100);
if (listenerPids().length > 0) {
  console.error(`Port ${port} is still in use; refusing to start.`);
  process.exit(1);
}
console.log(`Port ${port} is free.`);
