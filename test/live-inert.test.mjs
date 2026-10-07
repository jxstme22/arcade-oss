#!/usr/bin/env node
/**
 * Live-inert tests: both live loops must be inert by default.
 *
 * Each case spawns the loop as a child process and asserts:
 *   - exit code 0, and
 *   - stdout carries a dry_build verdict with mode INERT.
 * loadSigner is never reached on these paths (the gate exits first), so no
 * broadcast is possible and no network is needed.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const LOOPS = ["live/aagree.mjs", "live/mom60.mjs"];
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("FAIL:", name); } };

const run = (file, env) => spawnSync("node", [file], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, ...env },
  encoding: "utf8",
  timeout: 15000,
});

const cleanEnv = () => {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("ARCADE_")) e[k] = v;
  }
  return e;
};

// 1. No kill file, no signer: inert.
for (const loop of LOOPS) {
  const r = run(loop, { ...cleanEnv(), ARCADE_KILL_FILE: "", ARCADE_SIGNER_KEYFILE: "" });
  t(`${loop} exits 0 with no conf`, r.status === 0);
  t(`${loop} prints dry_build inert`, r.stdout.includes("dry_build") && r.stdout.includes("INERT"));
}

// 2. Kill file present but flags disarmed (shipped defaults): inert.
mkdirSync(new URL("../data", import.meta.url), { recursive: true });
const disarmed = new URL("../data/test-kill-disarmed.conf", import.meta.url);
writeFileSync(disarmed, "ARCADE_LIVE_TRADING=0\nARCADE_LIVE_DRY_RUN=1\nARCADE_LIVE_KILL=0\n");
for (const loop of LOOPS) {
  const r = run(loop, { ...cleanEnv(), ARCADE_KILL_FILE: disarmed.pathname, ARCADE_SIGNER_KEYFILE: "" });
  t(`${loop} inert on disarmed flags`, r.status === 0 && r.stdout.includes("INERT"));
}

// 3. Flags armed but signer keyfile missing: still inert (no broadcast path).
const armed = new URL("../data/test-kill-armed.conf", import.meta.url);
writeFileSync(armed, "ARCADE_LIVE_TRADING=1\nARCADE_LIVE_DRY_RUN=0\nARCADE_LIVE_KILL=0\n");
for (const loop of LOOPS) {
  const r = run(loop, {
    ...cleanEnv(),
    ARCADE_KILL_FILE: armed.pathname,
    ARCADE_SIGNER_KEYFILE: "/nonexistent/signer.json",
  });
  t(`${loop} inert without signer`, r.status === 0 && r.stdout.includes("INERT"));
}

// 4. Kill file path itself missing: inert.
for (const loop of LOOPS) {
  const r = run(loop, { ...cleanEnv(), ARCADE_KILL_FILE: "/nonexistent/kill.conf", ARCADE_SIGNER_KEYFILE: "" });
  t(`${loop} inert on missing kill file`, r.status === 0 && r.stdout.includes("INERT"));
}

console.log(`live-inert: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
