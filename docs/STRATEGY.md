# Strategy

## The rule

For a round opening at `openTs`:

| Symbol | Time | Purpose |
|--------|------|---------|
| D | `openTs - 6` | Decision time. Read prices, compute the rule. |
| R | `D - 60` | Momentum reference (one minute before decision). |
| Window | ends `D - 1` | Last price sample used. Nothing after D enters. |
| Cutoff | `openTs - 3` (aim `openTs - 5`) | Venue stops accepting bets. Fire at/after D. |

**Mo (MOM60 leg):** `price(D)` vs `price(D - 60)` → DOWN if lower, UP if
higher, no signal on exact equality. Walk back a few seconds per sample on
feed hiccups; fetch in parallel.

**Vo (VOTE5B leg):** 7 consecutive 1-second samples ending at `D - 1` give 5
ticks with weights 1..5 (oldest → newest). `dir = sign(price_i -
price_{i-1})`; any flat tick poisons the vote (no signal); weighted total > 0
→ UP, < 0 → DOWN, exactly 0 → tie, no signal.

**Entry:** Mo and Vo both spoke and match → bet that side. Else skip with one
of: `no_mom`, `vote_has-flat-tick`, `vote_tie`, `disagree`, `missing_price`.

One position per round, ever. Never average down, never double-bet a round.

## Stake sizing (tiered by bankroll)

Below $10 → $1 · $10-20 → $2 · $20-30 → $3 · $30-100 → $5 · $100+ → $7.50.
Hard halt below $1. Per-order cap in the kill file wins over the tier.
Encoded in `config/strategy.json` (`tiers`, cap-style: first `belowMicro`
above the bankroll picks the stake).

## Circuit breaker

Halt new entries at or below 48% over the trailing 20 settled (`breaker` in
`config/strategy.json`). Losing streaks are normal at 60% true win rate — use
the breaker, not feelings.

## Live mirror discipline

The live loop never decides: it mirrors paper A's row for the round verbatim
(same side, same skip reason) with a dynamic deadline 1.5s before cutoff. No
paper row by deadline → skip `paper_pending`. Every live action traces to a
paper row; paper-vs-live divergence is structurally zero.

## What this is not

Not a model, not a signal service, not compounding advice. The measured edge
is selection (skipping coin-flip minutes), and most of continuation's raw
accuracy is the short horizon, not predictive skill. Size stakes for ~1.5x
realized multiples and celebrate anything above.
