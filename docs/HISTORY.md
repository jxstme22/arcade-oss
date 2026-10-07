# History (retired — why this package excludes them)

The research tree tried these. They are documented here so nobody re-derives
them, and deliberately NOT ported: each exclusion below was paid for.

## Retired live/paper loops

- **E/F agree live loops:** earlier AGREE variants promoted to live before
  their forward sample existed. Cut over to the A-mirror discipline (paper
  decides, live mirrors) — any loop that guesses instead of mirroring is cut.
- **SOL paper + SOL live:** thin, gappy per-second feed plus universal walk-back
  skips made it cost without signal. The per-asset structure stays (add one
  asset entry to resume); the package ships BTC-only.
- **VOTE5A live on SOL:** decisions landed at T-2 and missed 100% of fills
  (venue lock is earlier than advertised). Converted to MOM60 timing, then
  retired with the SOL loops.

## Dead strategies

- **STREAK5:** bet the previous round's outcome confirmed by the vote. Killed:
  lag-1 continuation is unknowable at decision time (round i-1 settles after
  betting on round i closes); tradable lag-2 reads 47-50% noise.
- **R9-H1 reversion:** preregistered reversion rule, falsified decisively
  (continuation ~93.5% vs reversion ~6.5%). Never tradeable live regardless —
  kept frozen in `strategies/continuation.mjs` as the canonical dead end.
- **Agree + unanimous vote slice:** replay 55.8% ROI +11%, live 50.8% (n=59).
  Rejected: the forward sample overrules the backtest, always.

## Retired tooling (not ported)

- **Forensics one-shots:** gap scans, ablation scripts, pool/flow auditors.
  Research instruments, not operations — they stay in the research tree.
- **Python watchdog / notifier babysitters:** replaced by the single
  supervisor (`scripts/daemon.mjs`), which owns scheduling, exclusion,
  restarts, and health in memory.
- **Duplicate paper traders/settlers per strategy:** one engine + one
  unified settler with `--strategy` scoping replaces the per-strategy
  cron blocks. Fewer moving parts, one settlement truth.
- **R9-era notifiers and board variants:** superseded by `notify/board.mjs`
  (console/once/telegram modes, read-only).
- **Live-side payout linker and manual-fire commands:** real-money
  conveniences of the original deployment. Out of scope for a paper-first
  package — see `GOING_LIVE.md` before rebuilding them.
