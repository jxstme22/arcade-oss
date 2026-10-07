/**
 * VENDORED Jev contract — copied from research/arcade/shadow/lib/jev.mjs.
 *
 * Only the bundling changed: the two research-tree imports (versions.mjs,
 * economics.mjs) are inlined below as frozen constants + the exact `ratio`
 * helper, so this standalone package has no machine-global path dependency.
 * Contract semantics are untouched: Jev stays blind to pools/crowd side
 * (assertJevBlind enforces), and validation stays fail-closed.
 */

const DIRECTION_BASELINE_VERSIONS = Object.freeze({
  B0: "ARCADE-DIR-B0-UNIFORM-V1",
  B1: "ARCADE-DIR-B1-PREVMINUTE-V1",
  B2: "ARCADE-DIR-B2-MOMENTUM-V1",
  B3: "ARCADE-DIR-B3-MEANREVERSION-V1",
});
const JEV_STATE_VERSION = "ARCADE-JEV-STATE-V3";
const JEV_QUESTION_SET_VERSION = "ARCADE-JEV-Q1-V1";
const JEV_MODEL = "jev-1.13.0";

/** Reduce num/den to lowest terms with a positive denominator. */
function ratio(num, den) {
  if (den === 0n) return null;
  let n = BigInt(num);
  let d = BigInt(den);
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n;
  let b = d;
  while (b !== 0n) { const t = a % b; a = b; b = t; }
  const g = a === 0n ? 1n : a;
  return { num: n / g, den: d / g };
}

/* ── baselines ──────────────────────────────────────────────────────────── */

/** B0: no information. The number every real forecast must beat. */
export function baselineB0() {
  return { version: DIRECTION_BASELINE_VERSIONS.B0, name: "B0", pUp: ratio(1n, 2n) };
}

/**
 * B1: direction of the previous completed 1-minute window.
 *
 * Uses the previous round's own close vs open, which is settled history and
 * therefore known before this round's cutoff. A tie is UNRESOLVED, so pUp
 * falls back to 1/2 rather than guessing.
 */
export function baselineB1({ previousRound }) {
  if (!previousRound?.open_price || !previousRound?.close_price) {
    return { version: DIRECTION_BASELINE_VERSIONS.B1, name: "B1", pUp: ratio(1n, 2n), tieOrMissing: true };
  }
  const o = BigInt(previousRound.open_price);
  const c = BigInt(previousRound.close_price);
  if (o === c) return { version: DIRECTION_BASELINE_VERSIONS.B1, name: "B1", pUp: ratio(1n, 2n), tieOrMissing: true };
  return { version: DIRECTION_BASELINE_VERSIONS.B1, name: "B1", pUp: c > o ? ratio(1n, 1n) : ratio(0n, 1n) };
}

/**
 * B2: short momentum. Frozen rule: sign of the 10s return, mapped to a fixed
 * probability. The mapping is deliberately blunt — a momentum tilt, not a fit.
 */
export function baselineB2({ snapshot, tiltNum = 3n, tiltDen = 4n }) {
  const r = snapshot?.returns?.r10s?.value;
  if (r === null || r === undefined || !Number.isFinite(r)) {
    return { version: DIRECTION_BASELINE_VERSIONS.B2, name: "B2", pUp: ratio(1n, 2n), undefined: true };
  }
  if (r === 0) return { version: DIRECTION_BASELINE_VERSIONS.B2, name: "B2", pUp: ratio(1n, 2n), flat: true };
  const up = ratio(tiltNum, tiltDen);
  const dn = ratio(tiltDen - tiltNum, tiltDen);
  return { version: DIRECTION_BASELINE_VERSIONS.B2, name: "B2", pUp: r > 0 ? up : dn, ret10s: r };
}

/**
 * B3: short mean reversion. Frozen rule: opposite sign of the 30s return.
 *
 * Rationale is a hypothesis to be TESTED, not an assumption: if the 60s round
 * is driven by microstructure noise, a stretched 30s move tends to revert.
 */
export function baselineB3({ snapshot, tiltNum = 3n, tiltDen = 4n }) {
  const r = snapshot?.returns?.r30s?.value;
  if (r === null || r === undefined || !Number.isFinite(r)) {
    return { version: DIRECTION_BASELINE_VERSIONS.B3, name: "B3", pUp: ratio(1n, 2n), undefined: true };
  }
  if (r === 0) return { version: DIRECTION_BASELINE_VERSIONS.B3, name: "B3", pUp: ratio(1n, 2n), flat: true };
  const up = ratio(tiltNum, tiltDen);
  const dn = ratio(tiltDen - tiltNum, tiltDen);
  return { version: DIRECTION_BASELINE_VERSIONS.B3, name: "B3", pUp: r < 0 ? up : dn, ret30s: r };
}

export function allBaselines({ snapshot, previousRound }) {
  return {
    B0: baselineB0(),
    B1: baselineB1({ previousRound }),
    B2: baselineB2({ snapshot }),
    B3: baselineB3({ snapshot }),
  };
}

/* ── Arcade Jev battery ─────────────────────────────────────────────────── */

/**
 * ARCADE-JEV-Q1-V1. Small and bounded on purpose.
 *
 * The primary question is the only one that feeds a direction. Supporting
 * questions are diagnostics: they are recorded and evaluated, but they never
 * silently become a second probability.
 */
export const ARCADE_JEV_QUESTIONS = Object.freeze({
  up_next_minute: Object.freeze({
    key: "up_next_minute",
    type: "noul",
    instructions:
      "Based only on the supplied market evidence available before the next Arcade round begins, " +
      "will that round's official closing price be strictly greater than its official opening price? " +
      "Output P(yes) only.",
    criteria: {
      true: "Official close strictly greater than official open (UP wins).",
      false: "Official close less than or equal to official open (DOWN wins).",
    },
    semantics: "strict close > open, on the official Chainlink-settled prices",
  }),
  directional_evidence_quality: Object.freeze({
    key: "directional_evidence_quality",
    type: "score",
    instructions: "Rate the directional usefulness of the supplied short-horizon market evidence taken as a whole.",
    criteria: [
      "Evidence is missing or contradictory enough that a directional judgment is not useful.",
      "Weak evidence, mostly noise.",
      "Mixed but interpretable evidence.",
      "Clear evidence with limited contradiction.",
      "Unusually coherent evidence for this horizon.",
    ],
  }),
  micro_momentum_persistence: Object.freeze({
    key: "micro_momentum_persistence",
    type: "score",
    instructions: "Rate whether the supplied short-horizon price changes show persistent movement rather than a single isolated impulse.",
    criteria: [
      "No persistent movement; isolated impulse or pure noise.",
      "Slight persistence, dominated by noise.",
      "Moderate persistence with visible pullbacks.",
      "Clear persistence across the supplied windows.",
      "Exceptionally steady directional movement for this horizon.",
    ],
  }),
  short_horizon_instability: Object.freeze({
    key: "short_horizon_instability",
    type: "noul",
    instructions: "Does the supplied evidence indicate an unstable or mean-reverting state over the next minute, where recent directional evidence is unusually unreliable?",
  }),
  reversal_risk: Object.freeze({
    key: "reversal_risk",
    type: "noul",
    instructions: "Is there meaningful risk that the current short-term direction reverses before the next round closes?",
  }),
});

export const JEV_PRIMARY_KEY = "up_next_minute";

/**
 * Build the Jev state.
 *
 * DELIBERATELY EXCLUDED: upPool, downPool, any share, multiplier, break-even,
 * crowd side, pool forecast, and anything derived from them. If any of those
 * appear here, Jev is no longer an independent forecaster and the whole
 * comparison is void. `assertJevBlind` enforces it.
 */
export function buildJevState(snapshot) {
  const returns = {};
  for (const [k, v] of Object.entries(snapshot.returns ?? {})) {
    returns[k] = v && Number.isFinite(v.value) ? v.value : null;
  }
  const state = {
    stateVersion: JEV_STATE_VERSION,
    questionSetVersion: JEV_QUESTION_SET_VERSION,
    model: JEV_MODEL,
    asset: snapshot.asset,
    secondsToCutoff: snapshot.secondsToCutoff,
    currentPrice: snapshot.currentPrice,
    // The question compares the round's CLOSE against its OPEN, and the bet
    // cutoff is 3s BEFORE the round opens, so the open level does not exist yet
    // at decision time. referencePrice is the last settled level -- the previous
    // round's close -- and gapFromPrevClose is the drift since then. Giving the
    // model a level it can reason about beats leaving it to infer one.
    //
    // openPrice stays in the state because it is non-null for settled rounds and
    // makes retrospective scoring exact; it is null during betting, which is
    // precisely when it is unavailable.
    referencePrice: snapshot.referencePrice ?? null,
    gapFromPrevClose: snapshot.gapFromPrevClose ?? null,
    openPrice: snapshot.openPrice ?? null,
    referenceBasis: snapshot.referencePrice === null || snapshot.referencePrice === undefined
      ? "UNAVAILABLE" : "PREV_ROUND_CLOSE",
    priceHistorySeconds: snapshot.priceHistorySeconds,
    returns,
    volatility: Object.fromEntries(Object.entries(snapshot.volatility ?? {})
      .map(([k, v]) => [k, Number.isFinite(v) ? v : null])),
    range: Object.fromEntries(Object.entries(snapshot.range ?? {})
      .map(([k, v]) => [k, v && Number.isFinite(v.rangeFraction) ? v.rangeFraction : null])),
    acceleration: snapshot.acceleration
      ? { recent3s: snapshot.acceleration.recent3s, prior3s: snapshot.acceleration.prior3s, delta: snapshot.acceleration.delta }
      : null,
    tradeCount: snapshot.tradeCount,
    largeTradeCount: (snapshot.largeTrades ?? []).length,
    // poolFeed is deliberately dropped: telling Jev that a pool feed exists
    // leaks the existence of the crowd side, which it must not see.
    sourceHealth: {
      priceFeed: snapshot.sourceHealth?.priceFeed ?? false,
      tradeFeed: snapshot.sourceHealth?.tradeFeed ?? false,
    },
    captureGaps: snapshot.captureGaps,
  };
  assertJevBlind(state);
  return state;
}

const FORBIDDEN_STATE_KEYS = [
  "upPool", "downPool", "totalPool", "upShare", "downShare",
  "netMultiplier", "breakEven", "multiplier", "odds", "pool",
  "poolShare", "predictedFinalUpShare", "crowd", "side",
];

/**
 * The V1 state, kept for a same-round A/B against the current one.
 *
 * The reference level was added because the question compares CLOSE against OPEN
 * and the bet cutoff is 3s before the round opens, so the round's own open price
 * cannot exist at decision time. V1 is the state as it was before any reference
 * was supplied, and it is still a useful CONTROL: run both against the same
 * round and the only difference is the reference, so any change in the decision
 * is attributable to it.
 *
 * Kept as a real historical state rather than reconstructed by deleting fields
 * from the current one, so the comparison does not depend on the current builder
 * staying compatible with the old shape.
 */
export const JEV_STATE_VERSION_NOREF = "ARCADE-JEV-STATE-V1";
export const JEV_STATE_VERSION_OPENPRICE = "ARCADE-JEV-STATE-V2";

/**
 * The V2 state: the round's own open price, and nothing else.
 *
 * Kept as a live arm rather than a historical curiosity because V2 and V3 are
 * DIFFERENT STRATEGIES, and which is better is the open question. During betting
 * the venue publishes no open price, so V2 sends openPrice: null and
 * distanceFromOpen: null -- which is precisely why V2 was abandoned, and running
 * it side by side with V3 is what turns that story into a measurement.
 */
/**
 * The V2 strategy: an EXTRAPOLATED reference, framed in units of noise.
 *
 * V2 used to send the round's own open price, which the venue does not publish
 * while a round accepts bets, so it sent null -- carrying exactly the information
 * V1 did. Measured, the two arms still disagreed on 89% of forecasts with a mean
 * p_up gap of 0.11, because the model treats a present-but-null field as
 * different from an absent one. That is an interesting fact about the model and
 * a useless strategy, so V2 now carries a real hypothesis instead.
 *
 * The two live arms now differ in WHAT THEY BELIEVE THE REFERENCE IS:
 *
 *   V3  the reference is the previous round's close -- a settled print
 *   V2  the reference is the price the round will most likely OPEN at, which is
 *       the current price carried forward over the few seconds to the open
 *
 * V2 also gives the standardised move: the drift it expects from the open to the
 * close, divided by recent volatility. An absolute gap means different things in
 * a quiet tape and a violent one, and dividing by the noise level is the
 * difference between "20 points away" and "20 points away, which is nothing".
 */
export function buildJevStateOpenPrice(snapshot) {
  const state = buildJevState(snapshot);
  delete state.referencePrice;
  delete state.gapFromPrevClose;
  delete state.referenceBasis;

  const now = Number(snapshot.currentPrice);
  const secondsToOpen = Number.isFinite(snapshot.secondsToOpen) ? Number(snapshot.secondsToOpen) : null;
  const ret5 = snapshot.returns?.r5s;
  const r5 = ret5 && Number.isFinite(ret5.value) ? Number(ret5.value) : null;
  const vol30 = snapshot.volatility?.vol30s;
  const sigma = vol30 && Number.isFinite(vol30.value) ? Number(vol30.value) : null;

  // Reference: the price the round is expected to open at. Linear carry from the
  // current print over the seconds remaining to the open.
  let expectedOpen = now;
  if (Number.isFinite(now) && r5 !== null && secondsToOpen !== null && secondsToOpen > 0) {
    // r5 is a fractional return over 5s, so the per-second drift is r5/5.
    expectedOpen = now * (1 + (r5 / 5) * secondsToOpen);
  }

  // How far the reference sits from the print we can see, and how large that is
  // against the recent noise. Null when the inputs are missing -- never a zero,
  // which would read as "level, no edge".
  state.referencePrice = Number.isFinite(expectedOpen) ? expectedOpen : null;
  state.referenceBasis = Number.isFinite(expectedOpen) ? "EXTRAPOLATED_OPEN" : "UNAVAILABLE";
  state.gapFromReference = Number.isFinite(expectedOpen) && Number.isFinite(now) ? now - expectedOpen : null;

  // Standardised expected move from the open to the close, which is the quantity
  // the round's outcome actually depends on.
  const secondsToClose = Number.isFinite(snapshot.secondsToCutoff) ? Number(snapshot.secondsToCutoff) + 60 : null;
  state.moveToCloseZ = (sigma !== null && sigma > 0 && r5 !== null && secondsToClose !== null && secondsToClose > 0)
    ? (r5 * (secondsToClose / 5)) / (sigma * Math.sqrt(secondsToClose / 30))
    : null;
  state.secondsToOpen = secondsToOpen;
  state.stateVersion = JEV_STATE_VERSION_OPENPRICE;
  return state;
}

export function buildJevStateNoRef(snapshot) {
  const state = buildJevState(snapshot);
  delete state.referencePrice;
  delete state.gapFromPrevClose;
  delete state.referenceBasis;
  delete state.openPrice;
  // The control arm must declare the version it ACTUALLY sent. Leaving it as the
  // current constant made both arms report ARCADE-JEV-STATE-V3, so anything
  // grouping by state version merged the two arms into one and the A/B could not
  // be read at all.
  state.stateVersion = JEV_STATE_VERSION_NOREF;
  return state;
}

export function assertJevBlind(state) {
  const walk = (obj, path = "") => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      const p = path ? `${path}.${k}` : k;
      for (const bad of FORBIDDEN_STATE_KEYS) {
        if (k.toLowerCase() === bad.toLowerCase()) {
          throw new Error(`Jev state leak: forbidden field "${p}"`);
        }
      }
      if (v && typeof v === "object" && !Array.isArray(v)) walk(v, p);
    }
  };
  walk(state);
  return true;
}

/** Shape the request into the Jev client's expected questions record. */
export function buildJevQuestions() {
  const q = ARCADE_JEV_QUESTIONS;
  const out = {};
  for (const def of Object.values(q)) {
    out[def.key] = def.type === "score"
      ? { type: "score", instructions: def.instructions, criteria: def.criteria }
      : { type: "noul", instructions: def.instructions, criteria: def.criteria };
  }
  return out;
}

/**
 * Fail-closed response validation.
 *
 * A response is REJECTED — never partially trusted — when the model is not the
 * pinned one, the primary question is absent, or P(yes) is not a finite number
 * in [0,1]. Rejection means the primary policy abstains; it must never be
 * downgraded to pUp = 1/2 or to a baseline.
 */
export function validateJevResponse(response, { expectedModel = JEV_MODEL } = {}) {
  const reject = (reason) => ({ ok: false, reason });
  if (!response || typeof response !== "object") return reject("NO_RESPONSE");
  if (response.model !== expectedModel) {
    return reject(`WRONG_MODEL: got ${response.model ?? "none"}, expected ${expectedModel}`);
  }
  const ans = response.answers?.[JEV_PRIMARY_KEY];
  if (!ans) return reject("PRIMARY_QUESTION_ABSENT");
  if (ans.type !== "noul") return reject(`PRIMARY_NOT_NOUL: ${ans.type}`);
  const v = ans.noul;
  if (typeof v !== "number" || !Number.isFinite(v)) return reject("NOUL_NOT_FINITE");
  if (v < 0 || v > 1) return reject("NOUL_OUT_OF_RANGE");
  return { ok: true, model: response.model, rawJevP: v };
}

/**
 * Extract RAW_JEV_P from a response.
 *
 * RAW_JEV_P is explicitly UNCALIBRATED. It is clamped to [0,1] and nothing
 * else; no Platt scaling, no isotonic fit, no temperature. Calibration is an
 * evaluation output, never an input.
 */
/** Canonical exported name used by the engine and the contract check. */
export const validateJevP = validateJevResponse;

export function extractRawJevP(response) {
  const v = validateJevResponse(response);
  if (!v.ok) return null;
  return { rawJevP: v.rawJevP, uncalibrated: true, key: JEV_PRIMARY_KEY, model: v.model };
}
