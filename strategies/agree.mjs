/**
 * AGREE strategy — pure Mo/Vo consensus rule.
 *
 * Parameterized port of the paper-trade-agree logic: no I/O, no clock reads,
 * no ledger writes. The paper engine (paper/engine.mjs) and the live mirror
 * (live/aagree.mjs) both decide through THESE functions so paper-vs-live
 * cannot silently diverge.
 *
 * THE RULE
 *   MOM  := sign(price(D) - price(D-60)),      D = openTs - 6
 *   VOTE := VOTE5B 5-tick vote at D (any flat tick poisons the vote -> no vote)
 *   side := MOM if VOTE == MOM else SKIP.
 */

const TICK_COUNT = 5;
const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

/* VOTE5B core, verbatim: any flat tick poisons the vote. */
export function vote5b(series) {
  const ticks = [];
  for (let i = series.length - TICK_COUNT; i < series.length; i++) {
    const cur = series[i], prev = series[i - 1];
    if (!cur || !prev) return { side: null, reason: "missing_price", ticks };
    const w = i - (series.length - TICK_COUNT) + 1;
    const dir = sgn(cur.value - prev.value);
    ticks.push({ ts: cur.ts, value: cur.value, prev: prev.value, weight: w, dir });
  }
  if (ticks.some((t) => t.dir === 0)) {
    return { side: null, reason: "has-flat-tick", ticks, vote: ticks.reduce((a, t) => a + t.weight * t.dir, 0) };
  }
  const total = ticks.reduce((a, t) => a + t.weight * t.dir, 0);
  if (total === 0) return { side: null, reason: "tie", ticks, vote: 0 };
  return { side: total > 0 ? "UP" : "DOWN", vote: total, ticks };
}

/** MOM60 leg: 60s drift continuation. Equal prices -> no signal. */
export function decideMom(price, ref) {
  if (!Number.isFinite(price) || !Number.isFinite(ref)) return null;
  if (price === ref) return null;
  return price < ref ? "DOWN" : "UP";
}

/** Agreement gate: both legs spoke and match -> bet; else skip with reason. */
export function decideAgree(mom, vote) {
  if (!mom) return { side: null, reason: "no_mom" };
  if (!vote || !vote.side) return { side: null, reason: vote && vote.reason ? "vote_" + vote.reason : "vote_missing" };
  if (vote.side !== mom) return { side: null, reason: "disagree" };
  return { side: mom, reason: null };
}
