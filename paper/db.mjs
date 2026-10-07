/**
 * ARCADE-OSS paper ledger database.
 *
 * The append-only JSONL ledger stays the raw truth. This sqlite mirror exists
 * so totals (rounds, settled, win rate, ROI, bankroll) are computed by query
 * over ALL history and can never be reset by a restart or rotation. Rows are
 * keyed by round_id with INSERT OR IGNORE, so replays are harmless.
 *
 * Parameterized port: the directory resolves from ARCADE_DATA_DIR
 * (default ./data). One parameter for strategy name: "agree-jev-a" ->
 * agree-jev-a.db / agree-jev-a-ledger.jsonl. Each strategy is fully isolated.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, mkdirSync } from "node:fs";

export function dataDir() {
  return process.env.ARCADE_DATA_DIR || "./data";
}
export const START_MICRO = Number(process.env.PAPER_BANKROLL_MICRO || 50000000);

export function openDb(name = "paper", dir = dataDir()) {
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const DB_PATH = `${dir}/${name}.db`;
  const LEDGER_PATH = `${dir}/${name}-ledger.jsonl`;
  const db = new DatabaseSync(DB_PATH);
  db.exec(`PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS bets(
      round_id TEXT PRIMARY KEY, openTs INTEGER, side TEXT, stake INTEGER,
      price REAL, ref REAL, bet_at TEXT);
    CREATE TABLE IF NOT EXISTS settlements(
      round_id TEXT PRIMARY KEY, openTs INTEGER, side TEXT, outcome TEXT,
      won INTEGER, stake INTEGER, gross INTEGER, pnl INTEGER, rule TEXT,
      venueOutcome TEXT, venueMismatch INTEGER, settled_at TEXT);`);
  try { db.exec("ALTER TABLE bets ADD COLUMN variant TEXT"); } catch {}
  try { db.exec("ALTER TABLE bets ADD COLUMN jev_p REAL"); } catch {}
  try { db.exec("ALTER TABLE bets ADD COLUMN jev_ms INTEGER"); } catch {}
  const hasVar = (() => { try { db.prepare("SELECT variant FROM bets LIMIT 0"); return true; } catch { return false; } })();
  const insertBet = hasVar ? db.prepare(
    `INSERT OR IGNORE INTO bets(round_id,openTs,side,stake,price,ref,bet_at,variant,jev_p,jev_ms)
     VALUES(?,?,?,?,?,?,?,?,?,?)`) : db.prepare(
    `INSERT OR IGNORE INTO bets(round_id,openTs,side,stake,price,ref,bet_at)
     VALUES(?,?,?,?,?,?,?)`);
  const insertSettle = db.prepare(
    `INSERT OR IGNORE INTO settlements(round_id,openTs,side,outcome,won,stake,gross,pnl,rule,venueOutcome,venueMismatch,settled_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  // Backfill from the current ledger. Idempotent: replays change nothing.
  if (existsSync(LEDGER_PATH)) {
    for (const l of readFileSync(LEDGER_PATH, "utf8").split("\n")) {
      if (!l.trim()) continue;
      let r; try { r = JSON.parse(l); } catch { continue; }
      if (r.type === "bet") {
        insertBet.run(r.round_id, r.openTs, r.side, r.stake, r.price ?? null, r.ref ?? null, r.bet_at ?? null);
      } else if (r.type === "settlement") {
        insertSettle.run(r.round_id, r.openTs, r.side, r.outcome ?? null,
          r.won === null || r.won === undefined ? null : (r.won ? 1 : 0),
          r.stake, r.gross ?? 0, r.pnl ?? 0, r.rule ?? null,
          r.venueOutcome ?? null, r.venueMismatch ? 1 : 0, r.settled_at ?? null);
      }
    }
  }
  return {
    db,
    recordBet(b) {
      if (hasVar) insertBet.run(b.round_id, b.openTs, b.side, b.stake, b.price ?? null, b.ref ?? null, b.bet_at ?? null, b.variant ?? null, b.jev_p ?? null, b.jev_ms ?? null);
      else insertBet.run(b.round_id, b.openTs, b.side, b.stake, b.price ?? null, b.ref ?? null, b.bet_at ?? null);
    },
    recordSettlement(s) {
      insertSettle.run(s.round_id, s.openTs, s.side, s.outcome ?? null,
        s.won === null || s.won === undefined ? null : (s.won ? 1 : 0),
        s.stake, s.gross ?? 0, s.pnl ?? 0, s.rule ?? null,
        s.venueOutcome ?? null, s.venueMismatch ? 1 : 0, s.settled_at ?? null);
    },
    /** Lifetime totals over ALL settled rounds. Never reset. */
    totals() {
      const t = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(pnl),0) pnl,
        COALESCE(SUM(stake),0) staked, COALESCE(SUM(CASE WHEN won=1 THEN 1 ELSE 0 END),0) wins,
        COALESCE(SUM(CASE WHEN won=0 THEN 1 ELSE 0 END),0) losses,
        COALESCE(SUM(CASE WHEN won IS NULL THEN 1 ELSE 0 END),0) voids
        FROM settlements`).get();
      const bets = db.prepare(`SELECT COUNT(*) n FROM bets`).get().n;
      // Uniform 1% venue fee on settled stake.
      // Computed here so fee-free history and fee-carrying new rows agree.
      const fee = Math.round(t.staked * 100 / 10000);
      const pnlNet = t.pnl - fee;
      return {
        rounds: bets, settled: t.n, wins: t.wins, losses: t.losses, voids: t.voids,
        staked: t.staked,
        winRate: t.n ? t.wins / t.n : null,
        fee,
        roi: t.staked ? pnlNet / t.staked : null,
        bank: START_MICRO + pnlNet,
        pnl: pnlNet,
      };
    },
    close() { db.close(); },
  };
}
