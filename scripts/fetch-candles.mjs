#!/usr/bin/env node
/**
 * Candle harvester (research aid). Downloads 1-minute OHLC candles into the
 * data dir for offline replay. Read-only against the venue; writes only under
 * ARCADE_DATA_DIR. Usage:
 *   node scripts/fetch-candles.mjs [BTC] [fromUnix] [toUnix]
 */
import { appendFileSync, mkdirSync } from "node:fs";

const dataDir = () => process.env.ARCADE_DATA_DIR || "./data";
const PRICE = "https://prediction-market-price-service.fly.dev/price/crypto";
const FEED = { BTC: `${PRICE}/btcusdt` }[process.argv[2] || "BTC"] || `${PRICE}/btcusdt`;
const asset = (process.argv[2] || "BTC").toUpperCase();
const now = Math.floor(Date.now() / 1000);
const to = Number(process.argv[4] || now);
const from = Number(process.argv[3] || (to - 86400));

mkdirSync(dataDir(), { recursive: true });
const out = `${dataDir()}/candles-${asset.toLowerCase()}.jsonl`;
let n = 0;
for (let start = from; start < to; start += 86400) {
  const end = Math.min(start + 86400, to);
  try {
    const r = await fetch(`${FEED}/candles?from=${start}&to=${end}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) { console.error(`candles ${start}: status ${r.status}`); continue; }
    const cs = ((await r.json()).candles || []);
    for (const c of cs) appendFileSync(out, JSON.stringify({ asset, ...c }) + "\n");
    n += cs.length;
    console.log(`candles ${start}..${end}: ${cs.length}`);
  } catch (e) {
    console.error(`candles ${start}: ${String((e && e.message) || e).slice(0, 80)} (offline?)`);
  }
}
console.log(`wrote ${n} candles to ${out}`);
