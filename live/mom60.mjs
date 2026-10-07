#!/usr/bin/env node
/**
 * LIVE MOM60 — 60s momentum continuation (INERT BY DEFAULT).
 *
 * Top gate (evaluated FIRST, before any trading import): missing key/conf or
 * kill-file flags anything but armed -> prints dry_build and exits 0.
 * loadSigner is never called on the inert path, so no broadcast is possible.
 *
 * Armed path decides at D = openTs - 6 off price(D-3) vs price(D-63);
 * exact ties break UP toward the venue UP bias (labeled tiebreak:true).
 * One decision row per round, ever.
 */
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { loadGate, inertExit } from "./gate.mjs";

const gate = loadGate();
if (gate.mode !== "ARMED") inertExit(gate.reason, { loop: "mom60" });

const dataDir = () => process.env.ARCADE_DATA_DIR || "./data";
const LEDGER = `${dataDir()}/live-ledger.jsonl`;
const OTHER_LEDGER = `${dataDir()}/live-aagree-ledger.jsonl`;
const BET_CUTOFF_S = 3;
const DECISION_LEAD_S = 6;
const REF_BACK_S = 60;
const PRICE = "https://prediction-market-price-service.fly.dev/price/crypto/btcusdt";
const API = "https://prediction-market-api.jup.ag/api/v1/play";

const iso = (ms) => new Date(ms).toISOString();
const rec = (o) => appendFileSync(LEDGER, JSON.stringify(o) + "\n");
const readLines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()) : []);

function decideContinuation(price, ref) {
  if (!Number.isFinite(price) || !Number.isFinite(ref)) return null;
  if (price === ref) return null;
  return price < ref ? "DOWN" : "UP";
}

async function priceAt(tsSec) {
  for (let b = 0; b <= 6; b++) {
    try {
      const r = await fetch(`${PRICE}?timestamp=${tsSec - b}`, { signal: AbortSignal.timeout(600) });
      if (r.status !== 200) continue;
      const m = /"value":(-?\d+\.?\d*)/.exec(await r.text());
      if (m) return Number(m[1]);
    } catch {}
  }
  return null;
}

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
  const D = t.openTs - DECISION_LEAD_S;

  const warmAt = (D - 3) * 1000;
  const warmWait = warmAt - Date.now();
  if (warmWait > 0) await new Promise((x) => setTimeout(x, warmWait));
  const warmTs = D - 3;
  const [price, ref] = await Promise.all([priceAt(warmTs), priceAt(warmTs - REF_BACK_S)]);
  if (price === null || ref === null) {
    rec({ type: "reject", round_id: t.id, stage: "no_price", at: iso(Date.now()) });
    console.log(`  SKIP ${t.id} no_price`);
    return;
  }
  let side = decideContinuation(price, ref);
  let tiebreak = false;
  if (!side) { side = "UP"; tiebreak = true; }
  rec({ type: "decision", round_id: t.id, openTs: t.openTs, closeTs: t.closeTs, side, price, ref, tiebreak, at: iso(Date.now()) });
  console.log(`  ${t.id}  ${side}  price=${price} ref=${ref}`);

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
    prepared = await live.prepareArcadeBet({ venue: live.VENUE_PROFILES.arcade, walletAddress: String(signer.publicKey), asset: "BTC", side, amountMicro: guard.stakeMicro });
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
