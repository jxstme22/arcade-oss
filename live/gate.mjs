/**
 * Live gate — the ONLY broadcast authority.
 *
 * ARMED requires ALL of:
 *   1. ARCADE_KILL_FILE points at an existing file (missing = inert);
 *   2. that file sets ARCADE_LIVE_TRADING to 1 AND ARCADE_LIVE_DRY_RUN to 0
 *      AND ARCADE_LIVE_KILL to anything but 1;
 *   3. ARCADE_SIGNER_KEYFILE points at an existing file (missing = inert).
 * Anything else -> INERT: the caller prints a dry_build verdict and exits 0
 * WITHOUT importing the trading library or touching a signer. loadSigner is
 * never called on the inert path, so no broadcast is possible.
 */
import { readFileSync, existsSync } from "node:fs";

export function loadGate() {
  const killFile = process.env.ARCADE_KILL_FILE || "";
  if (!killFile) return { mode: "INERT", reason: "no_kill_file" };
  if (!existsSync(killFile)) return { mode: "INERT", reason: "kill_file_missing" };
  let trading = "0", dry = "1", kill = "0";
  let stake = 3000000n, minBal = 2000000n;
  try {
    for (const line of readFileSync(killFile, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(t);
      if (!m) continue;
      const [, k, v] = m;
      if (k === "ARCADE_LIVE_TRADING") trading = v.trim();
      if (k === "ARCADE_LIVE_DRY_RUN") dry = v.trim();
      if (k === "ARCADE_LIVE_KILL") kill = v.trim();
      if (k === "ARCADE_LIVE_STAKE_MICRO") { try { stake = BigInt(v.trim()); } catch {} }
      if (k === "ARCADE_LIVE_MIN_BALANCE_MICRO") { try { minBal = BigInt(v.trim()); } catch {} }
    }
  } catch {
    return { mode: "INERT", reason: "kill_file_unreadable" };
  }
  if (trading !== "1") return { mode: "INERT", reason: "trading_not_armed" };
  if (dry !== "0") return { mode: "INERT", reason: "dry_run_set" };
  if (kill === "1") return { mode: "INERT", reason: "killed" };
  const keyfile = process.env.ARCADE_SIGNER_KEYFILE || "";
  if (!keyfile) return { mode: "INERT", reason: "no_signer" };
  if (!existsSync(keyfile)) return { mode: "INERT", reason: "signer_missing" };
  return { mode: "ARMED", stake, minBal, killFile, keyfile };
}

/** Inert exit: print the dry_build verdict and stop. No signer, no broadcast. */
export function inertExit(reason, extra = {}) {
  console.log(JSON.stringify({ type: "dry_build", mode: "INERT", reason, ...extra }));
  process.exit(0);
}
