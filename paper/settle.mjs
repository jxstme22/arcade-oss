#!/usr/bin/env node
/**
 * Unified paper SETTLEMENT resolver (all Jev variants + pure-price).
 *
 * SIMULATION ONLY. Never touches live ledgers or live DBs.
 *
 * RULE (the verified paper convention, unchanged): next round's open vs this
 * round's open decides; venue `outcome` recorded as cross-check (mismatch
 * flagged, never silently resolved); void on exact flat refunds stake.
 * PAYOUT 1.99x gross on win, stake forfeited on loss, 1% venue fee on stake.
 *
 * Pending bets derive from each ledger (bets minus settlements); the DB mirror
 * gets every settlement row. Skips are ledger-only and never become pending.
 *
 * Flags:
 *   --strategy <db>   settle only one variant DB (e.g. --strategy agree-jev-a).
 * PAPER_JEV_ONLY scoping is honored the same way (other ledgers freeze).
 */
import { readFileSync, appendFileSync, existsSync } from "node:fs";

const dataDir = () => process.env.ARCADE_DATA_DIR || "./data";
const API = "https://prediction-market-api.jup.ag/api/v1/play";
const MULT = 1.99;
const FEE_BPS = 100;

const BASE = ["agree-jev-a", "agree-jev-b", "agree-jev-c", "mom60-jev-d", "mom60-jev-dctrl", "agree-jev-e", "agree-jev-f", "agree-jev-g", "agree-jev-h", "agree-i-pure"];
{ // Optional scope-down (PAPER_JEV_ONLY=agree-jev-a): other ledgers freeze.
  const only = new Set((process.env.PAPER_JEV_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean));
  const stratIdx = process.argv.indexOf("--strategy");
  const strat = stratIdx !== -1 ? process.argv[stratIdx + 1] : null;
  if (strat) {
    const keep = BASE.filter((b) => b === strat);
    BASE.length = 0; keep.forEach((b) => BASE.push(b));
  } else if (only.size) {
    const keep = BASE.filter((b) => only.has(b));
    BASE.length = 0; keep.forEach((b) => BASE.push(b));
  }
}
const DBS = BASE.map((b) => ({ db: b, asset: "BTC" }));
const LEDGER = (db) => `${dataDir()}/${db}-ledger.jsonl`;

const settled = new Map(); // db -> Set(openTs)
const bets = new Map();    // db -> Map(openTs -> row)
for (const { db } of DBS) {
  settled.set(db, new Set());
  bets.set(db, new Map());
  const p = LEDGER(db);
  if (!existsSync(p)) continue;
  for (const l of readFileSync(p, "utf8").split("\n")) {
    if (!l.trim()) continue;
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (r.type === "bet" && !bets.get(db).has(r.openTs)) bets.get(db).set(r.openTs, r);
    else if (r.type === "settlement") settled.get(db).add(r.openTs);
  }
}

const pendingCount = DBS.reduce((a, { db }) => a + [...bets.get(db).keys()].filter((k) => !settled.get(db).has(k)).length, 0);
if (!pendingCount) process.exit(0);

let dbmod = null;
async function mirror(db, row) {
  try {
    if (!dbmod) dbmod = await import("./db.mjs");
    const pdb = dbmod.openDb(db);
    pdb.recordSettlement(row);
    pdb.close();
  } catch { /* ledger already has it; backfill on next open */ }
}

const FEEDS = {};
for (const { asset } of DBS) {
  if (FEEDS[asset]) continue;
  try {
    const res = await fetch(`${API}/rounds?asset=${asset}`, { signal: AbortSignal.timeout(8000) });
    FEEDS[asset] = res.ok ? new Map((((await res.json()).data) || []).map((x) => [x.id, x])) : new Map();
  } catch { FEEDS[asset] = new Map(); }
}
try {
  for (const { db, asset } of DBS) {
    const byId = FEEDS[asset] || new Map();
    const prefix = asset.toLowerCase() + "-";
    for (const [openTs, b] of bets.get(db)) {
      if (settled.get(db).has(openTs)) continue;
      const r = byId.get(b.round_id);
      if (!r || r.status !== "settled") continue;
      if (r.openPrice == null) continue;
      const nxt = byId.get(`${prefix}${r.openTs + 60}`);
      if (!nxt || nxt.openPrice == null) continue;

      const open = Number(r.openPrice);
      const nextOpen = Number(nxt.openPrice);
      const direction = nextOpen > open ? "UP" : nextOpen < open ? "DOWN" : "FLAT";
      const won = direction === "FLAT" ? null : b.side === direction;
      const venueOutcome = (r.outcome === "UP" || r.outcome === "DOWN") ? r.outcome : null;
      const mismatch = venueOutcome != null && direction !== "FLAT" && venueOutcome !== direction;

      const gross = won === null ? b.stake : won ? Math.round(b.stake * MULT) : 0;
      const fee = Math.round((b.stake * FEE_BPS) / 10000);
      const row = {
        type: "settlement", openTs, closeTs: r.closeTs,
        round_id: r.id, round_address: r.address, side: b.side,
        variant: b.variant ?? null,
        rule: "next-open", roundOpen: open, nextOpen, direction,
        outcome: direction === "FLAT" ? "VOID" : direction,
        venueOutcome, venueMismatch: mismatch,
        stake: b.stake, gross, fee, pnl: gross - b.stake - fee, won,
        settled_at: new Date().toISOString(),
      };
      appendFileSync(LEDGER(db), JSON.stringify(row) + "\n");
      await mirror(db, row);
      settled.get(db).add(openTs);
    }
  }
} catch { /* transient; next tick retries */ }
