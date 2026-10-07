#!/usr/bin/env node
/**
 * ARCADE-OSS paper engine — AGREE + Jev experiments (Variants A–I + control).
 *
 * SIMULATION ONLY. No orders, no signing, no venue calls that trade. Reads the
 * public rounds feed + price service only. Never reads or writes any live
 * file, live ledger, wallet key, or kill switch.
 *
 * Parameterized port of the research paper engine. What changed vs the
 * research copy (and ONLY this):
 *   - all filesystem paths resolve under ARCADE_DATA_DIR (default ./data);
 *   - the Jev key comes from TYPESAFE_API_KEY env (missing = veto, never
 *     approval);
 *   - the Jev client is imported from the @probz/jev dependency (missing or
 *     failing client = UNAVAILABLE veto, never approval);
 *   - the Jev state/question/validator contract is imported from
 *     ../strategies/jev-contract.mjs (vendored, frozen).
 * The pure decision core below (vote5, decideContinuation, micro10, VARIANTS,
 * buildPlans, frozen gates) is VERBATIM — any drift breaks test/engine.test.mjs.
 *
 * VARIANTS (identifiers are the spec's required names):
 *   A  AGREE_JEV_A_CONTROL  AGREE entries, no Jev. Contemporaneous control.
 *   B  AGREE_JEV_B_VETO     A-eligible; Jev vetoes only on opposition.
 *   C  AGREE_JEV_C_CONFIRM  A-eligible; enter only on Jev conviction
 *                           (UP p>=0.70, DOWN p<=0.30 — frozen, preregistered).
 *   D  MOM60_JEV_D_VETO     MOM60 direction; Jev vetoes only on opposition.
 *   D0 MOM60_D_MATCHED_CONTROL  MOM60 direction, no Jev, same rounds as D.
 *   E  AGREE_JEV_E_ROUTER   Regime router (POST-HOC, frozen for forward
 *                           validation): Jev strong (|p-.5|>=.20) leads with
 *                           Jev's side; weak + agree bets consensus; else skip.
 *   F  AGREE_JEV_F_ARBITER  Disagreement arbiter (forward-validation only):
 *                           on MOM/VOTE disagreement bet the Jev-favored side.
 *   G  AGREE_JEV_G_SNIPER   Selective triple gate: agree + trailing-minute
 *                           range < 0.0147% + weak Jev (|p-.5|<.10) +
 *                           decisive vote |vote|>=5.
 *   H  AGREE_JEV_H_TRENDSNIPER  G + with-trend (agree side == prior-minute
 *                           candle direction). Anti-trend entries cut.
 *   I  AGREE_I_PUREPRICE    H minus the Jev-weak gate: pure price action,
 *                           zero model risk.
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildJevState, buildJevQuestions, validateJevResponse, JEV_PRIMARY_KEY } from "../strategies/jev-contract.mjs";

export function dataDir() {
  return process.env.ARCADE_DATA_DIR || "./data";
}
const API = "https://prediction-market-api.jup.ag/api/v1/play";
const ASSETS = [
  { asset: "BTC", price: "https://prediction-market-price-service.fly.dev/price/crypto/btcusdt", suffix: "" },
];
const CALLS_LOG = () => `${dataDir()}/jev-calls.jsonl`;
const LOG = () => `${dataDir()}/paper-jev.log`;

const DECISION_LEAD_S = 6;
const REF_BACK_S = 60;
const BET_CUTOFF_S = 3;
const STAKE_MICRO = Number(process.env.PAPER_STAKE_MICRO || 3000000);
const BANKROLL_START_MICRO = Number(process.env.PAPER_BANKROLL_MICRO || 50000000);
const MAX_SOURCE_AGE_MS = 10000;
const JEV_TIMEOUT_MS = 20000;
const JEV_DEADLINE_MS = 25000;
const JEV_MODEL = "jev-1.13.0";
// Conviction gate for Variant C: V4.5 frozen thresholds (preregistered, unfitted).
const CONVICT_UP = 0.70, CONVICT_DOWN = 0.30;
// Router gate for Variant E: POST-HOC, fitted in-sample (A era: weak-jeV
// consensus 113/178=63.5%, strong 66/135=48.9%). Frozen at first write;
// forward sample is the verdict, not this threshold.
const ROUTER_STRONG = 0.20;
// Sniper gate for Variant G: trailing-minute (fully closed, point-in-time
// legal) range fraction below this. Frozen q1 from the selection half of the
// 1,365-round split-half search (2026-10-05). Forward sample decides.
const TRAIL_CALM_MAX = 0.000147;
const JEV_WEAK_MAX = 0.10;
// G v2 (2026-10-05): consensus vote must be decisive, |weighted vote| >= 5.
// Grid search: adding the margin gate lifted every calm+weak slice ~5pp
// (selection ~70%, validation 67-88%). Frozen here; v1 rows (pre-v2) stay in
// the ledger for the record.
const G_VOTE_MIN = 5;

const VARIANTS = [
  { id: "AGREE_JEV_A_CONTROL", db: "agree-jev-a" },
  { id: "AGREE_JEV_B_VETO", db: "agree-jev-b" },
  { id: "AGREE_JEV_C_CONFIRM", db: "agree-jev-c" },
  { id: "MOM60_JEV_D_VETO", db: "mom60-jev-d" },
  { id: "MOM60_D_MATCHED_CONTROL", db: "mom60-jev-dctrl" },
  { id: "AGREE_JEV_E_ROUTER", db: "agree-jev-e" },
  { id: "AGREE_JEV_F_ARBITER", db: "agree-jev-f" },
  { id: "AGREE_JEV_G_SNIPER", db: "agree-jev-g" },
  { id: "AGREE_JEV_H_TRENDSNIPER", db: "agree-jev-h" },
  { id: "AGREE_I_PUREPRICE", db: "agree-i-pure" },
];
const LEDGER = (db) => `${dataDir()}/${db}-ledger.jsonl`;

// Test surface: pure functions + frozen constants. Importing this module must
// never fire a trading cycle (isMain guard at the bottom covers execution).
export { vote5, decideContinuation, micro10, CONVICT_UP, CONVICT_DOWN, ROUTER_STRONG, TRAIL_CALM_MAX, JEV_WEAK_MAX, G_VOTE_MIN, VARIANTS };

const iso = (ms) => new Date(ms).toISOString();
const nowMs = () => Date.now();
const ensureDir = () => { try { mkdirSync(dataDir(), { recursive: true }); } catch {} };
const log = (ev, o = {}) => { ensureDir(); appendFileSync(LOG(), JSON.stringify({ ts: iso(nowMs()), ev, ...o }) + "\n"); };
const readLines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()) : []);
const sha = (s) => createHash("sha256").update(s).digest("hex");

function decideContinuation(price, ref) {
  if (!Number.isFinite(price) || !Number.isFinite(ref)) return null;
  if (price === ref) return null;
  return price < ref ? "DOWN" : "UP";
}

/* VOTE5 core: 5 ticks weights 1-5, flat ticks neutral, tie skips. Pure. */
const TICK_COUNT = 5;
function vote5(series) {
  const ticks = [];
  for (let i = series.length - TICK_COUNT; i < series.length; i++) {
    const cur = series[i], prev = series[i - 1];
    if (!cur || !prev) return { side: null, reason: "missing_price", ticks };
    const w = i - (series.length - TICK_COUNT) + 1; // 1..5, oldest lightest
    const dir = cur.value > prev.value ? 1 : cur.value < prev.value ? -1 : 0;
    ticks.push({ ts: cur.ts, value: cur.value, prev: prev.value, weight: w, dir });
  }
  const total = ticks.reduce((a, t) => a + t.weight * t.dir, 0);
  if (total === 0) return { side: null, reason: "tie", ticks, vote: 0 };
  return { side: total > 0 ? "UP" : "DOWN", vote: total, ticks };
}

/* 10-second microstructure from the 7-sample VOTE window (D-10..D-4), zero
   extra I/O: everything derives from `series`. Pure: exported for tests.
   Feeds the shared snapshot's returns/volatility/range/acceleration so Jev
   sees the last-10s tape shape, not just the 60s drift. Nulls when gappy. */
function micro10(series) {
  const vals = (series || []).map((s) => s && s.value).filter((v) => Number.isFinite(v));
  if (vals.length < 7) return null;
  const [v0, , , v3, , , v6] = vals;
  if (!v0 || !v3) return null;
  const steps = [];
  for (let i = 0; i < 6; i++) steps.push((vals[i + 1] - vals[i]) / vals[i]);
  const mean = steps.reduce((a, x) => a + x, 0) / steps.length;
  const vol = Math.sqrt(steps.reduce((a, x) => a + (x - mean) * (x - mean), 0) / steps.length);
  const recent3s = (v6 - v3) / v3, prior3s = (v3 - v0) / v0;
  return {
    r10s: (v6 - v0) / v0,
    recent3s, prior3s, delta: recent3s - prior3s,
    vol10s: vol,
    range10: (Math.max(...vals) - Math.min(...vals)) / vals[vals.length - 1],
  };
}

async function rounds(asset) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(`${API}/rounds?asset=${asset}`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.data) && j.data.length) return j.data; }
    } catch {}
    await new Promise((r) => setTimeout(r, 1200 * (a + 1)));
  }
  return [];
}

// Hardened fetch path: the price service throws intermittent 400s and slow
// responses. 1500ms attempts, 6s walk-back, plus one full-batch retry by the
// caller. Paper has no execution deadline, so patience beats speed here.
const FETCH_STATS = { ok: 0, non200: 0, threw: 0 };
async function priceAt(priceUrl, tsSec, maxBack = 4) {
  for (let b = 0; b <= maxBack; b++) {
    const ts = tsSec - b;
    try {
      const r = await fetch(`${priceUrl}?timestamp=${ts}`, { signal: AbortSignal.timeout(700) });
      if (r.status === 200) {
        const m = /"value":(-?\d+\.?\d*)/.exec(await r.text());
        if (m) { FETCH_STATS.ok++; return { value: Number(m[1]), source_ts: ts, back_s: b, received_ms: nowMs() }; }
        FETCH_STATS.non200++;
      } else FETCH_STATS.non200++;
    } catch { FETCH_STATS.threw++; }
  }
  return null;
}

/* One Jev call per round, shared by B/C/D (matched evidence guaranteed). Key
   from TYPESAFE_API_KEY env; never printed. Returns {p, latencyMs,
   rejection} where p is a validated 0..1 number or null. */
let _client = null;
function jevKey() {
  return process.env.TYPESAFE_API_KEY || "";
}
async function askJevOnce(snapshot) {
  const started = nowMs();
  try {
    if (!_client) {
      const { createJevClient } = await import("@probz/jev");
      const _made = createJevClient({
        baseUrl: "https://api.typesafe.ai", apiKey: jevKey(), model: JEV_MODEL,
        timeoutMs: JEV_TIMEOUT_MS, maxAttempts: 1, baseBackoffMs: 500, maxBackoffMs: 4000,
      });
      _client = { call: _made.call.bind(_made) };
      if (!jevKey()) return { p: null, latencyMs: 0, rejection: "NO_CREDENTIAL" };
    }
    const res = await _client.call(buildJevState(snapshot), buildJevQuestions());
    const latencyMs = nowMs() - started;
    const chk = validateJevResponse(res?.response);
    if (!chk.ok) {
      const r = chk.reason || "UNKNOWN";
      const rejection = r.startsWith("WRONG_MODEL") ? "WRONG_MODEL"
        : r.includes("ABSENT") ? "PRIMARY_ABSENT" : "INVALID_P";
      return { p: null, latencyMs, rejection, questionKey: JEV_PRIMARY_KEY };
    }
    return { p: chk.rawJevP, latencyMs, rejection: null, questionKey: JEV_PRIMARY_KEY };
  } catch (e) {
    const m = String((e && e.message) || e).toLowerCase();
    const rejection = m.includes("abort") || m.includes("timeout") || m.includes("timed out") ? "TIMEOUT"
      : m.includes("401") || m.includes("403") || m.includes("unauthorized") ? "UNAUTHORIZED"
      : m.includes("429") || m.includes("rate") ? "RATE_LIMITED" : "UNAVAILABLE";
    return { p: null, latencyMs: nowMs() - started, rejection };
  }
}

/* Pure variant-decision core: base signals + one Jev verdict in, ten plan
   objects out. No I/O, no clock reads -- every input is a parameter, so unit
   tests exercise EXACTLY what the live path runs. Exported for tests; the
   module only executes when run directly (isMain guard at the bottom), so
   importing it can never fire a trading cycle. */
export function buildPlans({ mom, vote, agree, jev, late, tvol = null, tdir = null }) {  const jevDir = (jev.p === null || late) ? null : jev.p > 0.5 ? "UP" : jev.p < 0.5 ? "DOWN" : null;
  // B: veto on ANY opposition (p==0.5 directionless counts as veto).
  // C: enter only on conviction (frozen V4.5 gates). Preregistered difference.
  const bPass = agree && jev.p !== null && !late && jevDir !== null && jevDir === agree;
  const cPass = agree && jev.p !== null && !late &&
    ((agree === "UP" && jev.p >= CONVICT_UP) || (agree === "DOWN" && jev.p <= CONVICT_DOWN));
  const dPass = mom && jev.p !== null && !late && jevDir !== null && jevDir === mom;
  // E router: strong Jev leads (Jev's side, consensus ignored); weak Jev +
  // consensus bets consensus; Jev fail/late/p==0.5-strong-impossible vetoes.
  const eStrong = jev.p !== null && !late && Math.abs(jev.p - 0.5) >= ROUTER_STRONG;
  const eDir = eStrong ? (jev.p > 0.5 ? "UP" : "DOWN") : null;
  const eEnter = eStrong ? true : (jev.p !== null && !late && !!agree);
  const eSide = eStrong ? eDir : agree;
  const eReason = eStrong ? null
    : (jev.p === null ? "jev_" + (jev.rejection || "unknown").toLowerCase() : late ? "jev_late"
    : !agree ? (!mom ? "no_mom" : !vote.side ? ("vote_" + vote.reason) : "disagree") : null);
  // F arbiter: ONLY disagreements. Both friends spoke, they differ, Jev's
  // valid timely p picks one of them (jevDir always matches one friend on a
  // disagree round). Agree rounds, missing signals, Jev fail/late/neutral
  // all skip -- this variant measures exactly one question.
  const disagree = mom && vote.side && mom !== vote.side;
  const fArb = disagree && jev.p !== null && !late && jevDir !== null;
  const fReason = !mom ? "no_mom" : !vote.side ? ("vote_" + vote.reason)
    : !disagree ? "agree_not_disagree"
    : jev.p === null ? "jev_" + (jev.rejection || "unknown").toLowerCase()
    : late ? "jev_late" : jevDir === null ? "jev_neutral" : null;
  // G sniper: agree + trailing calm + weak Jev + decisive vote. tvol null
  // (missing candles), Jev fail/late, non-weak Jev, weak vote margin, or no
  // agreement all skip with named reasons.
  const gCalm = tvol !== null && tvol < TRAIL_CALM_MAX;
  const gWeak = jev.p !== null && !late && Math.abs(jev.p - 0.5) < JEV_WEAK_MAX;
  const gMargin = vote.vote != null && Math.abs(vote.vote) >= G_VOTE_MIN;
  const gEnter = !!agree && gCalm && gWeak && gMargin;
  const gReason = !agree ? (!mom ? "no_mom" : !vote.side ? ("vote_" + vote.reason) : "disagree")
    : tvol === null ? "no_trailvol" : !gCalm ? "choppy" : !gWeak
    ? (jev.p === null ? "jev_" + (jev.rejection || "unknown").toLowerCase() : late ? "jev_late" : "jev_not_weak")
    : !gMargin ? "weak_vote" : null;
  // H trendsniper: G v2 gates + agree side == prior-minute candle direction.
  // Flat or missing direction fails closed (antitrend). The with-trend gate
  // is the measured edge: anti-trend entries ran 45% ALL.
  const hTrend = tdir !== null && agree !== null && tdir === agree;
  const hEnter = !!agree && gCalm && gWeak && gMargin && hTrend;
  const hReason = !hEnter
    ? (!agree ? (!mom ? "no_mom" : !vote.side ? ("vote_" + vote.reason) : "disagree")
      : tvol === null ? "no_trailvol" : !gCalm ? "choppy" : !gWeak
      ? (jev.p === null ? "jev_" + (jev.rejection || "unknown").toLowerCase() : late ? "jev_late" : "jev_not_weak")
      : !gMargin ? "weak_vote" : "antitrend")
    : null;
  // I pureprice: H minus Jev. Consensus + calm + margin + with-trend, Jev
  // never consulted (fail/late/strong all irrelevant). The ablation answer
  // to "which G v2 gate is dead weight": the weak-Jev gate (+~2pp at half
  // the coverage). Kill bars: halt <=10/20, kill <=27/50 settled.
  const iEnter = !!agree && gCalm && gMargin && hTrend;
  const iReason = !iEnter
    ? (!agree ? (!mom ? "no_mom" : !vote.side ? ("vote_" + vote.reason) : "disagree")
      : tvol === null ? "no_trailvol" : !gCalm ? "choppy"
      : !gMargin ? "weak_vote" : "antitrend")
    : null;
  const jevWhy = (!agree && "not_eligible") ||
    (jev.p === null ? "jev_" + (jev.rejection || "unknown").toLowerCase() : late ? "jev_late" : null);

  return [
    { v: VARIANTS[0], enter: !!agree, side: agree, reason: !mom ? "no_mom" : !vote.side ? ("vote_" + vote.reason) : (agree ? null : "disagree") },
    { v: VARIANTS[1], enter: !!bPass, side: agree, reason: !agree ? "not_eligible" : (jevWhy || (jevDir === agree ? null : "jev_oppose")) },
    { v: VARIANTS[2], enter: !!cPass, side: agree, reason: !agree ? "not_eligible" : (jevWhy || (((agree === "UP" && jev.p >= CONVICT_UP) || (agree === "DOWN" && jev.p <= CONVICT_DOWN)) ? null : "no_conviction")) },
    { v: VARIANTS[3], enter: !!dPass, side: mom, reason: !mom ? "no_mom" : (jev.p === null ? "jev_" + (jev.rejection || "unknown").toLowerCase() : late ? "jev_late" : (jevDir === mom ? null : "jev_oppose")) },
    { v: VARIANTS[4], enter: !!mom, side: mom, reason: !mom ? "no_mom" : null },
    { v: VARIANTS[5], enter: !!eEnter, side: eSide, reason: eReason },
    { v: VARIANTS[6], enter: !!fArb, side: fArb ? jevDir : null, reason: fReason },
    { v: VARIANTS[7], enter: !!gEnter, side: gEnter ? agree : null, reason: gReason },
    { v: VARIANTS[8], enter: !!hEnter, side: hEnter ? agree : null, reason: hReason },
    { v: VARIANTS[9], enter: !!iEnter, side: iEnter ? agree : null, reason: iReason },
  ];
}

async function placeAll(R, cfg, { dryRun = false } = {}) {
  const nowSec = Math.floor(nowMs() / 1000);
  const dbn = (v) => v.db + cfg.suffix;
  const seen = {};
  for (const v of VARIANTS) {
    seen[dbn(v)] = new Set();
    for (const l of readLines(LEDGER(dbn(v)))) {
      try { const r = JSON.parse(l); if (r.round_id) seen[dbn(v)].add(r.round_id); } catch {}
    }
  }
  const candidates = R
    .filter((r) => (r.closeTs - r.openTs) === 60)
    .map((r) => ({ r, D: r.openTs - DECISION_LEAD_S }))
    .filter((x) => x.D > nowSec)
    .sort((a, b) => a.D - b.D);
  // One action per round per variant, ever; skip rounds already covered by all.
  const target = candidates.find((x) => VARIANTS.some((v) => !seen[dbn(v)].has(x.r.id)));
  if (!target) return { err: "no_target" };
  const { r: T, D } = target;

  // Bounded sleep: if the decision is more than 50s out, exit now and let a
  // later tick own this round with a short sleep. Unbounded sleeps overrun the
  // 60s tick and coverage gaps cascade.
  if ((D - 3) * 1000 - nowMs() > 50000) return { err: "too_early" };
  const warmWait = (D - 3) * 1000 - nowMs();
  if (warmWait > 0) await new Promise((x) => setTimeout(x, warmWait));
  const warmTs = D - 4;
  const fetchBatch = async () => {
    const [p, r, ...ss] = await Promise.all([
      priceAt(cfg.price, warmTs),
      priceAt(cfg.price, warmTs - REF_BACK_S),
      ...[10, 9, 8, 7, 6, 5, 4].map((k) => priceAt(cfg.price, D - k)),
    ]);
    const cut = ss.findIndex((x) => !x);
    return { px: p, rf: r, series: cut === -1 ? ss : ss.slice(0, cut) };
  };
  let px = null, rf = null, series = [], attempts = 0;
  const fetchStart = nowMs();
  for (let a = 0; a < 2 && (!px || !rf || series.length !== 7); a++) {
    attempts = a + 1;
    ({ px, rf, series } = await fetchBatch());
    if ((!px || !rf || series.length !== 7) && a === 0) await new Promise((x) => setTimeout(x, 3000));
  }
  const fetchMs = nowMs() - fetchStart;
  const seriesOk = series.length === 7;
  const cutoffReached = nowMs() > (T.openTs - BET_CUTOFF_S) * 1000;
  const mom = (px && rf && !cutoffReached) ? decideContinuation(px.value, rf.value) : null;
  const vote = seriesOk ? vote5(series) : { side: null, reason: "missing_price", ticks: [] };
  const agree = (mom && vote.side && mom === vote.side) ? mom : null;
  // Trailing volatility: fully-closed 1-minute candle before this round
  // (point-in-time legal -- never the forming candle). One attempt, no retry.
  let tvol = null, tdir = null;
  try {
    const r = await fetch(`${cfg.price}/candles?from=${T.openTs - 180}&to=${T.openTs}`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const cs = ((await r.json()).candles || [])
        .filter((c) => Math.floor(c.timestamp / 1000) <= T.openTs - 60)
        .sort((a, b) => a.timestamp - b.timestamp);
      const c = cs[cs.length - 1];
      if (c && c.open) {
        tvol = (c.high - c.low) / c.open;
        tdir = c.close > c.open ? "UP" : c.close < c.open ? "DOWN" : null;
      }
    }
  } catch {}
  const snapshotAt = nowMs();

  const m10 = seriesOk ? micro10(series) : null;
  const snapshot = {
    asset: cfg.asset, secondsToCutoff: Math.max(0, Math.round((T.openTs - BET_CUTOFF_S) * 1000 - snapshotAt) / 1000),
    currentPrice: px ? px.value : null,
    referencePrice: rf ? rf.value : null,
    gapFromPrevClose: px && rf ? px.value - rf.value : null,
    openPrice: null, priceHistorySeconds: REF_BACK_S + 6,
    returns: { r60s: { value: px && rf && rf.value ? (px.value - rf.value) / rf.value : null },
      r10s: { value: m10 ? m10.r10s : null } },
    volatility: { v10s: m10 ? m10.vol10s : null },
    range: { r10s: { rangeFraction: m10 ? m10.range10 : null } },
    acceleration: m10 ? { recent3s: m10.recent3s, prior3s: m10.prior3s, delta: m10.delta } : null,
    tradeCount: null, largeTrades: [],
    sourceHealth: { priceFeed: !!px },
    momSide: mom, voteSide: vote.side, voteValue: vote.vote ?? null, agreeSide: agree,
    roundId: T.id, openTs: T.openTs,
  };
  const payloadHash = sha(JSON.stringify(snapshot));
  // Gap hardening: cap the Jev wait at 8s so one slow call cannot orphan the
  // round. In dry-run the Jev call is skipped entirely (no writes, no inference
  // spend): every Jev-gated variant reports jev_dry_run.
  const JEV_SOFT_MS = 8000;
  let jev = null;
  if (dryRun) {
    jev = { p: null, latencyMs: 0, rejection: "DRY_RUN" };
  } else {
    try {
      jev = await Promise.race([
        askJevOnce(snapshot),
        new Promise((resolve) => setTimeout(() => resolve({ p: null, latencyMs: JEV_SOFT_MS, rejection: "SLOW", slow: true }), JEV_SOFT_MS)),
      ]);
    } catch {
      jev = { p: null, latencyMs: JEV_SOFT_MS, rejection: "UNAVAILABLE" };
    }
  }
  const late = dryRun ? false : (nowMs() - snapshotAt) > JEV_DEADLINE_MS;
  if (!dryRun) {
    ensureDir();
    appendFileSync(CALLS_LOG(), JSON.stringify({
      round_id: T.id, openTs: T.openTs, snapshot_at: iso(snapshotAt),
      snapshot_hash: payloadHash.slice(0, 32), model: JEV_MODEL,
      p: jev.p, latency_ms: jev.latencyMs, rejection: jev.rejection,
      late_by_deadline: late, question_key: jev.questionKey ?? null,
    }) + "\n");
  }


  const only = new Set((process.env.PAPER_JEV_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean));
  const plans = buildPlans({ mom, vote, agree, jev, late, tvol }).filter((pl) => !only.size || only.has(pl.v.db));
  const out = { asset: cfg.asset, round: T.id, jev_p: jev.p, jev_ms: jev.latencyMs, jev_rej: jev.rejection, late,
    tvol, tdir, fetch_ms: fetchMs, attempts, decide_T: +(((snapshotAt / 1000) - T.openTs + 6).toFixed(1)) };
  if (dryRun) {
    out.dry_run = true;
    for (const pl of plans) out[pl.v.db] = pl.enter ? ("bet:" + pl.side) : ("skip:" + (pl.reason || "?"));
    return out;
  }
  ensureDir();
  for (const pl of plans) {
    const db = dbn(pl.v);
    if (seen[db].has(T.id)) { out[db] = "dup_skip"; continue; }
    const row = pl.enter ? {
      type: "bet", openTs: T.openTs, closeTs: T.closeTs, round_id: T.id, asset: cfg.asset,
      round_address: T.address, side: pl.side, stake: STAKE_MICRO,
      variant: pl.v.id, momSide: mom, voteSide: vote.side, voteValue: vote.vote ?? null,
      jev_p: jev.p, jev_ms: jev.latencyMs, tvol, tdir, snapshot_hash: payloadHash.slice(0, 32),
      price: px ? px.value : null, ref: rf ? rf.value : null,
      bet_at: iso(nowMs()),
    } : {
      type: "skip", openTs: T.openTs, round_id: T.id, asset: cfg.asset, variant: pl.v.id,
      reason: pl.reason || "unknown", momSide: mom, voteSide: vote.side, voteValue: vote.vote ?? null,
      jev_p: jev.p, jev_ms: jev.latencyMs, tvol, tdir, skipped_at: iso(nowMs()),
    };
    appendFileSync(LEDGER(db), JSON.stringify(row) + "\n");
    out[db] = pl.enter ? ("bet:" + pl.side) : ("skip:" + (pl.reason || "?"));
    // No DB mirror here by design: openDb() backfills ledger->DB on every open
    // (the board reopens every second), so a synchronous sqlite write on this
    // hot path only risks blocking behind the settler's write lock.
  }
  // Orphan telemetry: the last 3 closed rounds must each own an A row.
  try {
    const nowS = Math.floor(nowMs() / 1000);
    const closed = R.filter((r) => (r.closeTs - r.openTs) === 60 && r.closeTs < nowS)
      .sort((a, b) => b.openTs - a.openTs).slice(0, 3);
    if (closed.length) {
      const have = new Set();
      for (const l of readLines(LEDGER(dbn(VARIANTS[0])))) {
        try { const r = JSON.parse(l); if (r.round_id) have.add(r.round_id); } catch {}
      }
      for (const c of closed) {
        if (!have.has(c.id)) log("orphan", { round: c.id, openTs: c.openTs });
      }
    }
  } catch {}
  return out;
}

function report() {
  const rows = {};
  for (const cfg of ASSETS) {
    for (const v of VARIANTS) {
      const db = v.db + cfg.suffix;
      const rs = readLines(LEDGER(db)).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      rows[db] = { bets: rs.filter((r) => r.type === "bet").length, skips: rs.filter((r) => r.type === "skip").length };
    }
  }
  console.log(JSON.stringify(rows));
}

export async function runOnce({ dryRun = false } = {}) {
  const results = [];
  for (const cfg of ASSETS) {
    let R = [];
    try {
      R = await rounds(cfg.asset);
    } catch {
      if (dryRun) return { offline: true, reason: "rounds_fetch_failed", asset: cfg.asset };
      log("rounds_fetch_failed", { asset: cfg.asset });
      continue;
    }
    if (!R.length) {
      if (dryRun) return { offline: true, reason: "rounds_empty", asset: cfg.asset };
      log("rounds_fetch_failed", { asset: cfg.asset });
      continue;
    }
    const res = await placeAll(R, cfg, { dryRun });
    if (!dryRun) log("cycle", res);
    results.push(res);
  }
  if (!dryRun) report();
  return dryRun ? results[0] : results;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await runOnce({ dryRun: false });
}
