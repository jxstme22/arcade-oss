# Results

> Historical reference points, NOT promises. Every figure below is AS OF its
> date, on the samples and rules of that date. Regimes change, feeds degrade,
> and agreement of everything is worse than agreement of two (crowded/late
> entries measured ~48%). Run your own forward sample before risking anything.

## Paper lifetimes (as of 2026-10-03, fee-adjusted, modeled 1.99x minus 1%)

| Strategy | Settled | Win | ROI | Bank (from $50) |
|----------|---------|-----|-----|-----------------|
| MOM60 | 2,185 | 53.6% | +5.0% | $599.85 |
| VOTE5B | 1,328 | 52.5% | +2.5% | $215.15 |
| VOTE5A | 1,862 | 51.9% | +1.5% | $187.45 |
| VOTE5 | 1,993 | 51.6% | +1.0% | $148.70 |
| AGREE | 204 | 55.9% | +9.2% | $143.90 |

## AGREE consensus (as of 2026-10-06)

- Paper win rate 64.6% (82W-45L, 127 settled). Live-traded at the time, reported
  profitable after fees at the time of writing.
- Replay + live-paper validation behind the shipped rule: 3-day tick replay
  (n=2255) agree 52.73% ROI +4.9% coverage 52%; live ledgers (n=609) agree
  53.4% ROI +6.2%; combined ~52.9% ROI ~+5.7%.
- The narrower agree+unanimous slice (replay 55.8% ROI +11%) FAILED live
  validation (50.8%, n=59) and is NOT part of the rule. Shipped rule is
  agreement alone.
- Mo alone ~53-54% (~2,000 settled); Vo alone ~52-53% (~1,300 settled).

## Jev-gated variants (as of 2026-10-06)

- G sniper: ~3 bets/day by construction (selection → validation split held on
  1,365 rounds).
- H trendsniper: G v2 + with-trend, split-half on 3,071 rounds: 61/89 = 68.5%
  combined, worst streak L3. Anti-trend entries measured 45% and were cut.
- I pure-price ablation: 62/91 = 68% across both halves at ~2x H coverage.
- E router / F arbiter: forward validation only (E fitted post-hoc on the A
  era; F had no backtest by construction). No win-rate claims ship with them.

## Venue baselines worth remembering

- UP bias ~51% across 20k+ rounds; ALWAYS-UP alone ≈ +0.9%.
- Flat ticks lose (~45-46% both eras) — the VOTE5B poison rule.
- Lag-1 continuation is real (52.15%, z=6.1, 20k rounds) and unexploitable at
  decision time; lag-2 is noise (50.8%).
- Volatility flattens every edge; calm minutes run 60%+.
- Fees flip 51% strategies negative — breakeven is ~50.75% before fees.
