#!/usr/bin/env node
/**
 * LIVE A:AGREE — MOM60 x VOTE5B consensus mirror (INERT BY DEFAULT).
 *
 * Top gate (evaluated FIRST, before any trading import): missing key/conf or
 * kill-file flags anything but armed -> prints dry_build and exits 0.
 * loadSigner is never called on the inert path, so no broadcast is possible.
 *
 * Armed path mirrors the paper A verdict verbatim (same side on bets, same
 * reason on skips); a missing paper row by deadline -> skip paper_pending.
 * One decision row per round, ever. See strategies/agree.mjs for the rule.
 */
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { loadGate, inertExit } from "./gate.mjs";

const gate = loadGate();
if (gate.mode !== "ARMED") inertExit(gate.reason, { loop: "aagree" });

const dataDir = () => process.env.ARCADE_DATA_DIR || "./data";
const LEDGER = `${dataDir()}/live-aagree-ledger.jsonl`;
const OTHER_LEDGER = `${dataDir()}/live-ledger.jsonl`;
const PAPER_LEDGER = `${dataDir()}/agree-jev-a-ledger.jsonl`;
const BET_CUTOFF_S = 3;
const DECISION_LEAD_S = 6;
const PRICE = "https://prediction-market-price-service.fly.dev/price/crypto/btcusdt";
const API = "https://prediction-market-api.jup.ag/api/v1/play";

const iso = (ms) => new Date(ms).toISOString();
const rec = (o) => appendFileSync(LEDGER, JSON.stringify(o) + "\n");
const readLines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()) : []);

// Armed only past this point: import the execution library and load the signer.
const live = await import("@probz/jupiter");
const fsmod = await import("node:fs");
const signer = live.loadSigner(gate.keyfile, process.cwd(), { readFileSync: fsmod.readFileSync, statSync: fsmod.statSync });

async function main() {
  let rounds;
  try {
    rounds = ((await (await fetch(`${API}/rounds?asset=BTC`, { signal: AbortSignal.timeout(20000) })).json()).data) || [];
  } catch (e) {
    console.log(`  SKIP rounds_fetch_failed ${String((e && e.message) || e).slice(0, 120)}`);
    return;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const seen = new Set();
  for (const l of readLines(LEDGER)) {
    try { seen.add(JSON.parse(l).round_id); } catch {}
  }
  const cand = rounds
    .filter((x) => !seen.has(x.id))
    .filter((x) => (x.closeTs - x.openTs) === 60)
    .filter((x) => x.openTs - DECISION_LEAD_S > nowSec)
    .sort((a, b) => (a.openTs - DECISION_LEAD_S) - (b.openTs - DECISION_LEAD_S));
  if (!cand.length) { console.log("  no actionable round"); return; }
  const t = cand[0];

  // Mirror paper A: poll for its row with a dynamic deadline (1.5s before the
  // venue cutoff). Missing row by deadline -> skip paper_pending, never guess.
  const cutoffMs = (t.openTs - BET_CUTOFF_S) * 1000;
  const deadline = cutoffMs - 1500;
  let paper = null;
  for (;;) {
    for (const l of readLines(PAPER_LEDGER)) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l);
        if (r.round_id === t.id && (r.type === "bet" || r.type === "skip")) paper = r;
      } catch {}
    }
    if (paper || Date.now() >= deadline) break;
    await new Promise((x) => setTimeout(x, 250));
  }
  if (!paper) {
    rec({ type: "reject", round_id: t.id, stage: "paper_pending", error: "no paper-A row by deadline", at: iso(Date.now()) });
    console.log(`  SKIP ${t.id} paper_pending`);
    return;
  }
  if (paper.type === "skip") {
    rec({ type: "skip", round_id: t.id, stage: "skip", reason: "paper_" + (paper.reason || "skip"), at: iso(Date.now()) });
    console.log(`  SKIP ${t.id} paper_${paper.reason || "skip"}`);
    return;
  }
  const side = paper.side;

  for (const l of readLines(LEDGER)) {
    try {
      const r = JSON.parse(l);
      if (r.round_id === t.id && (r.type === "decision" || r.type === "order")) {
        console.log(`  SKIP ${t.id} duplicate_decision`);
        return;
      }
    } catch {}
  }
  rec({ type: "decision", round_id: t.id, openTs: t.openTs, closeTs: t.closeTs, side, mirrored: true, at: iso(Date.now()) });

  // Cross-loop exclusion: the other live loop already took this round.
  if (existsSync(OTHER_LEDGER)) {
    for (const l of readFileSync(OTHER_LEDGER, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l);
        if (r.round_id === t.id && (r.type === "decision" || r.type === "order")) {
          rec({ type: "reject", round_id: t.id, side, stage: "taken_by_other", at: iso(Date.now()) });
          console.log(`  SKIP ${t.id} taken_by_other`);
          return;
        }
      } catch {}
    }
  }

  const settings = {
    tradingFlag: "1", dryRunFlag: "0", killFlag: "0",
    stakeCapMicro: gate.stake, venueId: "arcade",
  };
  const guard = live.resolveMode(settings, true);
  if (guard.mode === "OFF") {
    rec({ type: "reject", round_id: t.id, stage: "guard_off", at: iso(Date.now()) });
    console.log(`  ${t.id}  guard=OFF`);
    return;
  }
  let prepared;
  try {
    prepared = await live.prepareArcadeBet({ venue: live.VENUE_PROFILES.arcade, walletAddress: String(signer.publicKey), asset: "BTC", side, amountMicro: gate.stake });
  } catch (e) {
    rec({ type: "reject", round_id: t.id, side, stage: "prepare_threw", error: String((e && e.message) || e).slice(0, 200), at: iso(Date.now()) });
    console.log(`  PREPARE_THREW`);
    return;
  }
  if (!prepared || prepared.ok !== true) {
    rec({ type: "reject", round_id: t.id, side, stage: "build_refused", at: iso(Date.now()) });
    console.log(`  BUILD_REFUSED`);
    return;
  }
  if (guard.mode === "DRY_RUN") {
    rec({ type: "dry_build", round_id: t.id, side, build_ok: true, at: iso(Date.now()) });
    console.log("  DRY build OK (not broadcast)");
    return;
  }
  const result = await live.signAndExecute({ guard, signer, build: prepared.build, settings, fetchFn: fetch });
  rec({ type: "order", round_id: t.id, side, result_status: result.status, signature: result.signature ?? null, at: iso(Date.now()) });
  console.log(`  ${result.status}`);
}

await main();
