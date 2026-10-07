# Variants

One snapshot per round is shared by all variants (same prices, one Jev call),
so evidence is matched: differences in outcomes are the rules, not the data.
`buildPlans` in `paper/engine.mjs` is the verbatim decision core; the golden
tests pin every gate below — edit the tests first if you think a gate moved.

## A — AGREE_JEV_A_CONTROL (the control)

AGREE entries, no Jev. Everything else is measured against A.

## B — AGREE_JEV_B_VETO

A-eligible; Jev vetoes on ANY opposition (a directionless p of exactly 0.5
counts as a veto). B keeps weak-agreement entries.

## C — AGREE_JEV_C_CONFIRM

A-eligible; enter only on Jev conviction: UP needs p ≥ 0.70, DOWN needs
p ≤ 0.30. Frozen V4.5 thresholds, preregistered — NOT fitted. B and C differ
a priori: B keeps weak-agreement entries, C drops them.

## D / D0 — MOM60_JEV_D_VETO / MOM60_D_MATCHED_CONTROL

MOM60 direction with Jev veto (D) vs without (D0), same rounds. Veto never
reverses — opposition skips, keeping the MOM side labeled.

## E — AGREE_JEV_E_ROUTER (post-hoc, frozen)

Regime router fitted in-sample on the A era, frozen for forward validation:
Jev strong (|p - 0.5| ≥ 0.20) leads with Jev's side (consensus ignored); Jev
weak + consensus bets consensus; else skip. Jev fail/late always vetoes.
The forward sample is the verdict on this threshold, not the backtest.

## F — AGREE_JEV_F_ARBITER (forward validation only)

Disagreement rounds only: when MOM and VOTE differ, bet the side Jev's valid
timely p favors. Agree rounds, missing signals, and Jev fail/late/neutral all
skip. Measures exactly one question.

## G — AGREE_JEV_G_SNIPER (split-half validated)

Selective triple gate: MOM/VOTE agree + trailing-minute range fraction below
0.0147% + weak Jev (|p - 0.5| < 0.10) + decisive vote (|vote| ≥ 5). ~3
bets/day. Everything else skips, including Jev fail/late and missing trailing
data. Frozen after a selection → validation split held.

## H — AGREE_JEV_H_TRENDSNIPER

G plus with-trend: the agree side must equal the fully-closed prior-minute
candle direction. Anti-trend entries measured ~45% and were cut. Rarest
variant by design.

## I — AGREE_I_PUREPRICE (the ablation answer)

H minus the Jev-weak gate: consensus + calm + decisive vote + with-trend, Jev
never consulted. The ablation says the weak-Jev gate buys ~2pp at half the
coverage. Pure price action, zero model risk — the default paper scope
alongside A (`PAPER_JEV_ONLY=agree-jev-a,agree-i-pure`).

## Jev contract (measured, not assumed)

Single uncalibrated P(UP) in [0,1] under the primary key, pinned model. No
skip/direction/confidence fields — anything else is a rejection. A
failed/late/invalid call is always a veto (never approval), with a reason
code (`TIMEOUT`, `UNAUTHORIZED`, `RATE_LIMITED`, `UNAVAILABLE`, `SLOW`,
`NO_CREDENTIAL`, `WRONG_MODEL`, `PRIMARY_ABSENT`, `INVALID_P`). Jev never sees
pools, multipliers, or crowd side (`assertJevBlind` enforces). Vendored
contract: `strategies/jev-contract.mjs`.
