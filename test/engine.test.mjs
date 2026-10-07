#!/usr/bin/env node
/**
 * Unit tests: Jev-variant decision core (golden — pins the verbatim core).
 *
 * Imports ONLY the pure functions -- module import fires nothing (verified by
 * the isMain guard; this file would hang forever on network if it did).
 * No network, no ledger writes, no clock reads. Exit non-zero on any failure.
 */
import { buildPlans, vote5, decideContinuation, micro10, dataDir, CONVICT_UP, CONVICT_DOWN, ROUTER_STRONG, TRAIL_CALM_MAX, JEV_WEAK_MAX, G_VOTE_MIN, VARIANTS } from "../paper/engine.mjs";

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("FAIL:", name); } };
const P = (mom, vote, agree, jev, late, tvol = null, tdir = null) => {
  const out = {};
  for (const pl of buildPlans({ mom, vote, agree, jev, late, tvol, tdir })) out[pl.v.id] = pl;
  return out;
};
const CALM = 0.0001, CHOP = 0.0005;
const J = (p, rej = null) => ({ p, latencyMs: 350, rejection: rej });
const V = (side, reason = null, voteVal = null) => ({ side, reason, vote: voteVal ?? (side ? 1 : 0) });

// frozen conviction gates, as preregistered
t("conviction gates frozen", CONVICT_UP === 0.70 && CONVICT_DOWN === 0.30);
// router gate frozen (post-hoc fit, see module header)
t("router gate frozen", ROUTER_STRONG === 0.20);
// 10 variant IDs exact
t("variant ids", VARIANTS.map((v) => v.id).join(",") ===
  "AGREE_JEV_A_CONTROL,AGREE_JEV_B_VETO,AGREE_JEV_C_CONFIRM,MOM60_JEV_D_VETO,MOM60_D_MATCHED_CONTROL,AGREE_JEV_E_ROUTER,AGREE_JEV_F_ARBITER,AGREE_JEV_G_SNIPER,AGREE_JEV_H_TRENDSNIPER,AGREE_I_PUREPRICE");

// A: disagree -> no entry; flat -> no entry
t("A disagree skips", P("UP", V(null, "tie"), null, J(0.9), false)["AGREE_JEV_A_CONTROL"].enter === false);
t("A flat skips", P("UP", V(null, "flat"), null, J(0.9), false)["AGREE_JEV_A_CONTROL"].enter === false);
t("A agree enters", P("UP", V("UP"), "UP", J(0.9), false)["AGREE_JEV_A_CONTROL"].enter === true);
// B: match enters, oppose skips, timeout/error/late/neutral skip
t("B match enters", P("UP", V("UP"), "UP", J(0.8), false)["AGREE_JEV_B_VETO"].enter === true);
t("B oppose skips", P("UP", V("UP"), "UP", J(0.2), false)["AGREE_JEV_B_VETO"].enter === false);
t("B p=0.5 skips", P("UP", V("UP"), "UP", J(0.5), false)["AGREE_JEV_B_VETO"].enter === false);
t("B timeout skips", P("UP", V("UP"), "UP", J(null, "TIMEOUT"), false)["AGREE_JEV_B_VETO"].enter === false);
t("B error skips", P("UP", V("UP"), "UP", J(null, "UNAVAILABLE"), false)["AGREE_JEV_B_VETO"].enter === false);
t("B late skips", P("UP", V("UP"), "UP", J(0.9), true)["AGREE_JEV_B_VETO"].enter === false);
// C: conviction only
t("C conviction enters", P("UP", V("UP"), "UP", J(0.71), false)["AGREE_JEV_C_CONFIRM"].enter === true);
t("C weak-agree skips", P("UP", V("UP"), "UP", J(0.69), false)["AGREE_JEV_C_CONFIRM"].enter === false);
t("C down conviction", P("DOWN", V("DOWN"), "DOWN", J(0.29), false)["AGREE_JEV_C_CONFIRM"].enter === true);
t("C down weak skips", P("DOWN", V("DOWN"), "DOWN", J(0.31), false)["AGREE_JEV_C_CONFIRM"].enter === false);
// B vs C differ exactly on weak agreement (preregistered distinction)
t("B keeps weak, C drops",
  P("UP", V("UP"), "UP", J(0.6), false)["AGREE_JEV_B_VETO"].enter === true &&
  P("UP", V("UP"), "UP", J(0.6), false)["AGREE_JEV_C_CONFIRM"].enter === false);
// D: match enters, oppose skips (never reverses), flat MOM skips
t("D match enters", P("DOWN", V("DOWN"), "DOWN", J(0.2), false)["MOM60_JEV_D_VETO"].enter === true);
t("D oppose skips, keeps side", (() => {
  const p = P("DOWN", V("DOWN"), "DOWN", J(0.8), false)["MOM60_JEV_D_VETO"];
  return p.enter === false && p.side === "DOWN";
})());
t("D flat MOM skips", P(null, V("UP"), null, J(0.2), false)["MOM60_JEV_D_VETO"].enter === false);
t("D timeout skips", P("UP", V("UP"), "UP", J(null, "TIMEOUT"), false)["MOM60_JEV_D_VETO"].enter === false);
// D-control mirrors MOM without Jev
t("D-control enters on MOM", P("UP", V("DOWN"), null, J(null, "TIMEOUT"), false)["MOM60_D_MATCHED_CONTROL"].enter === true);
// E router: strong Jev leads even against consensus; weak Jev + consensus bets
// consensus; weak Jev without consensus skips; Jev fail/late vetoes.
t("E strong leads vs consensus", (() => {
  const p = P("DOWN", V("DOWN"), "DOWN", J(0.85), false)["AGREE_JEV_E_ROUTER"];
  return p.enter === true && p.side === "UP";
})());
t("E strong down leads", (() => {
  const p = P("UP", V("UP"), "UP", J(0.10), false)["AGREE_JEV_E_ROUTER"];
  return p.enter === true && p.side === "DOWN";
})());
t("E weak + consensus bets consensus", (() => {
  const p = P("UP", V("UP"), "UP", J(0.55), false)["AGREE_JEV_E_ROUTER"];
  return p.enter === true && p.side === "UP";
})());
t("E weak disagree skips", P("UP", V("DOWN"), null, J(0.55), false)["AGREE_JEV_E_ROUTER"].enter === false);
t("E jev fail vetoes", P("UP", V("UP"), "UP", J(null, "TIMEOUT"), false)["AGREE_JEV_E_ROUTER"].enter === false);
t("E late vetoes", P("UP", V("UP"), "UP", J(0.9), true)["AGREE_JEV_E_ROUTER"].enter === false);
// F arbiter: bets the Jev-favored friend on disagree; skips agree rounds,
// missing signals, Jev fail/late/neutral.
t("F bets mom on disagree", (() => {
  const p = P("UP", V("DOWN"), null, J(0.8), false)["AGREE_JEV_F_ARBITER"];
  return p.enter === true && p.side === "UP";
})());
t("F bets vote on disagree", (() => {
  const p = P("UP", V("DOWN"), null, J(0.2), false)["AGREE_JEV_F_ARBITER"];
  return p.enter === true && p.side === "DOWN";
})());
t("F skips agree", P("UP", V("UP"), "UP", J(0.8), false)["AGREE_JEV_F_ARBITER"].enter === false);
t("F skips no mom", P(null, V("UP"), null, J(0.8), false)["AGREE_JEV_F_ARBITER"].enter === false);
t("F skips flat vote", P("UP", V(null, "tie"), null, J(0.8), false)["AGREE_JEV_F_ARBITER"].enter === false);
t("F jev fail vetoes", P("UP", V("DOWN"), null, J(null, "TIMEOUT"), false)["AGREE_JEV_F_ARBITER"].enter === false);
t("F late vetoes", P("UP", V("DOWN"), null, J(0.8), true)["AGREE_JEV_F_ARBITER"].enter === false);
t("F neutral vetoes", P("UP", V("DOWN"), null, J(0.5), false)["AGREE_JEV_F_ARBITER"].enter === false);
// micro10: 10s tape shape from the 7-sample window
t("micro10 numbers", (() => {
  const m = micro10([100, 101, 102, 103, 104, 105, 106].map((v, i) => ({ ts: i, value: v })));
  return m && Math.abs(m.r10s - 0.06) < 1e-9 && Math.abs(m.delta - ((106 - 103) / 103 - (103 - 100) / 100)) < 1e-9
    && m.vol10s > 0 && m.range10 > 0;
})());
t("micro10 gappy null", micro10([{ value: 1 }, { value: 2 }]) === null);
// G sniper: agree + trailing calm + weak Jev enters on consensus side;
// choppy / missing vol / non-weak Jev / disagree / Jev fail all skip.
t("G gates frozen", TRAIL_CALM_MAX === 0.000147 && JEV_WEAK_MAX === 0.10 && G_VOTE_MIN === 5);
t("G triple enters", (() => {
  const p = P("UP", V("UP", null, 9), "UP", J(0.55), false, CALM)["AGREE_JEV_G_SNIPER"];
  return p.enter === true && p.side === "UP";
})());
t("G choppy skips", P("UP", V("UP", null, 9), "UP", J(0.55), false, CHOP)["AGREE_JEV_G_SNIPER"].enter === false);
t("G no vol skips", P("UP", V("UP", null, 9), "UP", J(0.55), false, null)["AGREE_JEV_G_SNIPER"].enter === false);
t("G strong jev skips", P("UP", V("UP", null, 9), "UP", J(0.8), false, CALM)["AGREE_JEV_G_SNIPER"].enter === false);
t("G weak vote skips", P("UP", V("UP", null, 3), "UP", J(0.55), false, CALM)["AGREE_JEV_G_SNIPER"].enter === false);
t("G disagree skips", P("UP", V("DOWN", null, -9), null, J(0.55), false, CALM)["AGREE_JEV_G_SNIPER"].enter === false);
t("G jev fail skips", P("UP", V("UP", null, 9), "UP", J(null, "TIMEOUT"), false, CALM)["AGREE_JEV_G_SNIPER"].enter === false);
t("G late skips", P("UP", V("UP", null, 9), "UP", J(0.55), true, CALM)["AGREE_JEV_G_SNIPER"].enter === false);
// E/F/A/B/C/D unaffected by tvol (default null path still decides as before)
t("A ignores tvol", P("UP", V("UP"), "UP", J(0.9), false, CALM)["AGREE_JEV_A_CONTROL"].enter === true);
// H trendsniper: G v2 gates + agree side == prior-minute candle direction.
t("H withtrend enters", (() => {
  const p = P("UP", V("UP", null, 9), "UP", J(0.55), false, CALM, "UP")["AGREE_JEV_H_TRENDSNIPER"];
  return p.enter === true && p.side === "UP";
})());
t("H antitrend skips", P("UP", V("UP", null, 9), "UP", J(0.55), false, CALM, "DOWN")["AGREE_JEV_H_TRENDSNIPER"].enter === false);
t("H flat dir skips", P("UP", V("UP", null, 9), "UP", J(0.55), false, CALM, null)["AGREE_JEV_H_TRENDSNIPER"].enter === false);
t("H choppy skips", P("UP", V("UP", null, 9), "UP", J(0.55), false, CHOP, "UP")["AGREE_JEV_H_TRENDSNIPER"].enter === false);
t("H weak vote skips", P("UP", V("UP", null, 3), "UP", J(0.55), false, CALM, "UP")["AGREE_JEV_H_TRENDSNIPER"].enter === false);
// G unaffected by tdir (G ignores the trend gate)
t("G ignores tdir", P("UP", V("UP", null, 9), "UP", J(0.55), false, CALM, "DOWN")["AGREE_JEV_G_SNIPER"].enter === true);
// I pureprice: H gates minus Jev. Jev fail/strong never vetoes.
t("I enters without jev", (() => {
  const p = P("UP", V("UP", null, 9), "UP", J(null, "TIMEOUT"), false, CALM, "UP")["AGREE_I_PUREPRICE"];
  return p.enter === true && p.side === "UP";
})());
t("I strong jev irrelevant", P("UP", V("UP", null, 9), "UP", J(0.95), false, CALM, "UP")["AGREE_I_PUREPRICE"].enter === true);
t("I antitrend skips", P("UP", V("UP", null, 9), "UP", J(0.55), false, CALM, "DOWN")["AGREE_I_PUREPRICE"].enter === false);
t("I weak vote skips", P("UP", V("UP", null, 3), "UP", J(0.55), false, CALM, "UP")["AGREE_I_PUREPRICE"].enter === false);
t("I choppy skips", P("UP", V("UP", null, 9), "UP", J(0.55), false, CHOP, "UP")["AGREE_I_PUREPRICE"].enter === false);
t("I disagree skips", P("UP", V("DOWN", null, -9), null, J(0.55), false, CALM, "UP")["AGREE_I_PUREPRICE"].enter === false);
// vote5 core sanity (mirrors paper, drift-checked by hand on fixtures)
const S = (vals) => vals.map((v, i) => ({ ts: i, value: v }));
t("vote5 UP", vote5(S([100, 101, 102, 103, 104, 105, 106])).side === "UP");
t("vote5 tie", vote5(S([99, 100, 101, 102, 101, 101, 101])).side === null); // dirs +1,+1,-1,0,0 -> 1+2-3+0+0=0
t("continuation", decideContinuation(1, 2) === "DOWN" && decideContinuation(3, 2) === "UP" && decideContinuation(2, 2) === null);
// OSS parameterization: data dir defaults to ./data, never machine-global
t("data dir default relative", (() => {
  const saved = process.env.ARCADE_DATA_DIR;
  delete process.env.ARCADE_DATA_DIR;
  const d = dataDir();
  if (saved !== undefined) process.env.ARCADE_DATA_DIR = saved;
  return d === "./data" && !d.startsWith("/");
})());
t("data dir honors env", (() => {
  const saved = process.env.ARCADE_DATA_DIR;
  process.env.ARCADE_DATA_DIR = "./custom-data";
  const d = dataDir();
  if (saved === undefined) delete process.env.ARCADE_DATA_DIR;
  else process.env.ARCADE_DATA_DIR = saved;
  return d === "./custom-data";
})());

console.log(`tests: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
