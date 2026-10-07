#!/usr/bin/env node
/**
 * ARCADE-OSS daemon — one supervisor for the paper system.
 *
 * Replaces cron+flock: scheduling, mutual exclusion, restarts and health live
 * in one place, in memory, with no stale lock files. Strategy logic is
 * untouched — the daemon only decides WHEN a script runs and guarantees it
 * never runs twice. Each script keeps its own ledger dedup, so a daemon
 * restart can neither double-bet nor lose a round.
 *
 * WHAT IT SUPERVISES
 *   paper        paper/agree-runner.mjs   every 60s, at most one instance
 *   settle       paper/settle.mjs         every 60s, at most one instance
 *   board        notify/board.mjs         persistent, restarted on exit
 * Live loops are NEVER supervised here (run scripts/live.sh by hand, armed).
 *
 * OPERATION: run under systemd (scripts/systemd/arcade.service.example) or
 * by hand. Health: <data>/daemon-health.json rewritten every tick.
 */
import { spawn } from "node:child_process";
import { writeFileSync, openSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const dataDir = () => process.env.ARCADE_DATA_DIR || `${ROOT}data`;
const NODE = process.execPath;
const TICK_MS = 5000;
const LOOP_EVERY_MS = 60000;
const SHUTDOWN_GRACE_MS = 30000;

const iso = () => new Date().toISOString();
const log = (ev, o = {}) => console.log(JSON.stringify({ ts: iso(), ev, ...o }));

const JOBS = [
  { name: "paper", script: `${ROOT}paper/agree-runner.mjs`, log: `${dataDir()}/paper.log`, mode: "interval", everyMs: LOOP_EVERY_MS },
  { name: "settle", script: `${ROOT}paper/settle.mjs`, log: `${dataDir()}/settle.log`, mode: "interval", everyMs: LOOP_EVERY_MS },
  { name: "board", script: `${ROOT}notify/board.mjs`, log: `${dataDir()}/board.log`, mode: "persistent" },
];

const state = {};
for (const j of JOBS) state[j.name] = { child: null, runs: 0, exits: [], lastSpawn: null };

function spawnJob(j) {
  if (state[j.name].child) {
    log("skip_overlap", { job: j.name });
    return;
  }
  const out = openSync(j.log, "a");
  const child = spawn(NODE, [j.script], {
    cwd: ROOT,
    stdio: ["ignore", out, out],
    env: { ...process.env },
    detached: false,
  });
  state[j.name].child = child;
  state[j.name].runs++;
  state[j.name].lastSpawn = iso();
  log("spawn", { job: j.name, pid: child.pid });
  child.on("exit", (code, signal) => {
    state[j.name].child = null;
    state[j.name].exits.push({ at: iso(), code, signal });
    if (state[j.name].exits.length > 20) state[j.name].exits.shift();
    if (code !== 0) log("child_exit", { job: j.name, code, signal });
  });
  child.on("error", (e) => {
    state[j.name].child = null;
    log("child_error", { job: j.name, err: String((e && e.message) || e).slice(0, 200) });
  });
}

function health() {
  const h = { ts: iso(), uptime_s: Math.round(process.uptime()), jobs: {} };
  for (const j of JOBS) {
    const s = state[j.name];
    h.jobs[j.name] = { running: !!s.child, pid: s.child?.pid ?? null, runs: s.runs, lastSpawn: s.lastSpawn, recentExits: s.exits.slice(-5) };
  }
  try { writeFileSync(`${dataDir()}/daemon-health.json`, JSON.stringify(h, null, 2)); } catch {}
}

let running = true;
let timer = null;
async function tick() {
  if (!running) return;
  const now = Date.now();
  for (const j of JOBS) {
    if (j.mode === "persistent") {
      if (!state[j.name].child) spawnJob(j);
    } else {
      const due = !state[j.name].lastSpawn || now - Date.parse(state[j.name].lastSpawn) >= j.everyMs - TICK_MS;
      if (due) spawnJob(j);
    }
  }
  health();
}

async function shutdown() {
  running = false;
  if (timer) clearInterval(timer);
  log("shutdown", {});
  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  for (const j of JOBS) {
    const c = state[j.name].child;
    if (c) {
      const left = deadline - Date.now();
      if (left > 0) await new Promise((x) => setTimeout(x, Math.min(left, 5000)));
    }
  }
  for (const j of JOBS) {
    const c = state[j.name].child;
    if (c) { try { c.kill("SIGTERM"); } catch {} }
  }
  health();
  process.exit(0);
}
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { shutdown(); });

log("daemon_start", { jobs: JOBS.map((j) => j.name) });
health();
timer = setInterval(tick, TICK_MS);
await tick();
