#!/usr/bin/env node
/**
 * Board — paper + live status snapshot.
 *
 * Modes via ARCADE_BOARD_MODE (default: console):
 *   console   print the board to stdout (never loads telegram creds);
 *   once      print ONE snapshot and exit (never loads telegram creds);
 *   telegram  send the board to the monitor chats (loads notify/telegram.mjs).
 * Flag --once forces single-snapshot behavior in any mode.
 * Read-only: parses ledgers + sqlite mirrors under ARCADE_DATA_DIR, writes
 * nothing except the telegram-mode state file. Holds no trading credentials.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const dataDir = () => process.env.ARCADE_DATA_DIR || "./data";
const MODE = process.env.ARCADE_BOARD_MODE || "console";
const ONCE = process.argv.includes("--once");
const TZ = process.env.BOARD_TZ || "Asia/Jakarta";
const POLL_MS = 5000;

const PAPER_DBS = ["agree-jev-a", "agree-jev-b", "agree-jev-c", "mom60-jev-d", "mom60-jev-dctrl",
  "agree-jev-e", "agree-jev-f", "agree-jev-g", "agree-jev-h", "agree-i-pure"];
const LIVE_LEDGERS = ["live-aagree-ledger.jsonl", "live-ledger.jsonl"];

const readLines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()) : []);
const usd = (micro) => (micro / 1e6).toFixed(2);
const signed = (micro) => (micro >= 0 ? "+" : "") + "$" + usd(micro);
const pct1 = (v) => (v == null ? "--" : (v * 100).toFixed(1) + "%");
const fmtTime = (ms) => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(ms));
  } catch { return new Date(ms).toISOString(); }
};

async function paperRow(db) {
  let bets = 0, skips = 0;
  for (const l of readLines(`${dataDir()}/${db}-ledger.jsonl`)) {
    try {
      const r = JSON.parse(l);
      if (r.type === "bet") bets++;
      else if (r.type === "skip") skips++;
    } catch {}
  }
  let t = null;
  try {
    const { openDb } = await import("../paper/db.mjs");
    const pdb = openDb(db);
    t = pdb.totals();
    pdb.close();
  } catch { /* no DB yet */ }
  return { db, bets, skips, settled: t ? t.settled : 0, winRate: t ? t.winRate : null, pnl: t ? t.pnl : null };
}

function liveRow(file) {
  let orders = 0, decisions = 0, dryBuilds = 0;
  for (const l of readLines(`${dataDir()}/${file}`)) {
    try {
      const r = JSON.parse(l);
      if (r.type === "order") orders++;
      else if (r.type === "decision") decisions++;
      else if (r.type === "dry_build") dryBuilds++;
    } catch {}
  }
  return { file: file.replace("-ledger.jsonl", ""), orders, decisions, dryBuilds };
}

async function snapshot() {
  const only = new Set((process.env.PAPER_JEV_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean));
  const dbs = PAPER_DBS.filter((d) => !only.size || only.has(d));
  const papers = [];
  for (const db of dbs) papers.push(await paperRow(db));
  const lives = LIVE_LEDGERS.map(liveRow);
  const lines = [];
  lines.push(`ARCADE BOARD — ${fmtTime(Date.now())} (${TZ})`);
  lines.push("");
  lines.push("PAPER  db  bets  skips  settled  win%  pnl");
  for (const p of papers) {
    lines.push(`  ${p.db}  ${p.bets}  ${p.skips}  ${p.settled}  ${pct1(p.winRate)}  ${p.pnl == null ? "?" : signed(p.pnl)}`);
  }
  lines.push("");
  lines.push("LIVE (inert unless armed)  orders  decisions  dry_builds");
  for (const l of lives) {
    lines.push(`  ${l.file}  ${l.orders}  ${l.decisions}  ${l.dryBuilds}`);
  }
  lines.push("");
  lines.push("Paper PNL modeled (1.99x gross, 1% fee). Live bank is on-chain only.");
  return lines.join("\n");
}

async function main() {
  const text = await snapshot();
  if (MODE === "telegram" && !ONCE) {
    // Persistent telegram mode: send on change only, state in data dir.
    const { sendMessage } = await import("./telegram.mjs");
    const stateFile = `${dataDir()}/board-state.json`;
    let last = "";
    try { last = existsSync(stateFile) ? readFileSync(stateFile, "utf8") : ""; } catch {}
    if (text !== last) {
      if (await sendMessage(text)) {
        try { writeFileSync(stateFile, text); } catch {}
      }
    }
    // Keep polling; each tick recomputes and sends only on change.
    for (;;) {
      await new Promise((x) => setTimeout(x, POLL_MS));
      const next = await snapshot();
      if (next === last) continue;
      if (await sendMessage(next)) {
        last = next;
        try { writeFileSync(stateFile, next); } catch {}
      }
    }
  }
  if (MODE === "telegram" && ONCE) {
    const { sendMessage } = await import("./telegram.mjs");
    const ok = await sendMessage(text);
    console.log(ok ? "board sent" : "board send failed");
    process.exit(ok ? 0 : 1);
  }
  // console mode (default): --once prints once; otherwise reprint on change.
  console.log(text);
  if (ONCE || MODE === "once") return;
  let last = text;
  for (;;) {
    await new Promise((x) => setTimeout(x, POLL_MS));
    const next = await snapshot();
    if (next !== last) { console.log("\n" + next); last = next; }
  }
}

await main();
