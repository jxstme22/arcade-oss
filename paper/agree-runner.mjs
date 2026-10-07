#!/usr/bin/env node
/**
 * Paper runner CLI — one paper cycle over the shared engine.
 *
 * SIMULATION ONLY. Mirrors the cron-tick behavior: evaluate the next
 * actionable round for every variant in scope and append bet/skip rows.
 * Never signs, never broadcasts.
 *
 * Flags:
 *   --once      run a single cycle, then exit (default: single cycle anyway;
 *               kept for launcher parity — this runner never loops).
 *   --dry-run   evaluate and print the verdict; write NOTHING (no ledger rows,
 *               no Jev inference call). Offline-safe: network failure prints a
 *               clean `SKIP offline` and exits 0.
 *   --strategy  limit scope to one variant DB (e.g. --strategy agree-jev-a).
 *               Overrides PAPER_JEV_ONLY for this run.
 */
import { runOnce } from "./engine.mjs";

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const dryRun = args.has("--dry-run");
const stratIdx = process.argv.indexOf("--strategy");
if (stratIdx !== -1 && process.argv[stratIdx + 1]) {
  process.env.PAPER_JEV_ONLY = process.argv[stratIdx + 1];
}
if (!process.env.PAPER_JEV_ONLY) {
  process.env.PAPER_JEV_ONLY = "agree-jev-a,agree-i-pure";
}

const res = await runOnce({ dryRun });
if (res && res.offline) {
  console.log(`SKIP offline (${res.reason || "no network"}) — no rows written, exit 0`);
  process.exit(0);
}
if (dryRun) {
  console.log(JSON.stringify({ dry_run: true, once, ...res }, null, 2));
  process.exit(0);
}
void once;
process.exit(0);
