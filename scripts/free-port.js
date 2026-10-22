#!/usr/bin/env node
// live-server silently binds a random port when the requested one is busy.
// A leftover live-server from a previous run therefore makes the next run
// open, say, 8081 instead of 5500. Free the port before starting the server.

const { execFileSync } = require("child_process");
const fs = require("fs");

const port = Number(process.argv[2] || 5500);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function listenerPids() {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
      const re = new RegExp(`[:.]${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "g");
      return [...new Set([...out.matchAll(re)].map((m) => Number(m[1])))];
    }
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
    return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
  } catch {
    return [];
  }
}

function commandLine(pid) {
  try {
    if (process.platform === "win32") {
      return execFileSync(
        "powershell",
        ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
        { encoding: "utf8" }
      ).trim();
    }
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
  } catch {
    return "";
  }
}

for (const pid of listenerPids()) {
  const cmd = commandLine(pid);
  if (!cmd.includes("live-server")) {
    console.error(`Port ${port} is busy with another program (PID ${pid}${cmd ? `: ${cmd}` : ""}).`);
    console.error(`Stop it, then run the dev server again so it can use port ${port}.`);
    process.exit(1);
  }
  console.log(`Port ${port} is held by a leftover live-server (PID ${pid}); stopping it.`);
  try {
    process.kill(pid);
  } catch (e) {
    console.error(`Could not stop PID ${pid}: ${e.message}`);
    process.exit(1);
  }
}

for (let i = 0; i < 30 && listenerPids().length > 0; i++) sleep(100);
if (listenerPids().length > 0) {
  console.error(`Port ${port} is still in use; refusing to start on a different port.`);
  process.exit(1);
}
