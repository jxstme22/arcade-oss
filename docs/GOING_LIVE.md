# Going live (checklist — there is no button)

Live means real money on 60-second rounds. The package makes arming a
deliberate multi-step act; this file is the order of operations. Do not skip
steps. Do not arm remotely. Do not arm tired.

## 1. Forward sample first

Paper must agree with your expectations for at least 100 settled rounds on
YOUR box, YOUR feed, YOUR clock. Backtests in `docs/RESULTS.md` are other
people's history. If the forward sample disagrees with the backtest, the
forward sample wins (see the unanimous-slice rejection in `HISTORY.md`).

## 2. Dedicated wallet, floor, tiers

- Fund a wallet used ONLY by one loop. Record: floor (halt below it),
  tier stakes (defaults in `config/strategy.json`), per-order cap.
- Check the floor and the cap with `node scripts/bank.mjs` (read-only)
  before every session. It never signs.

## 3. Kill file

Copy `config/live.conf.example` to a root-only path and point
`ARCADE_KILL_FILE` at it. Keep the shipped posture (disarmed) until step 5.
Know the three flags by heart: the loop broadcasts ONLY when the file sets
trading armed AND dry-run cleared AND kill cleared. Anything else — missing
file, unreadable file, any flag otherwise — is dry-build-and-exit.

## 4. Disarmed rehearsal

With the kill file disarmed (or absent) and no signer configured:

```sh
./scripts/live.sh          # must print dry_build ... INERT, exit 0
npm run audit              # must print AUDIT PASS
```

If either fails, stop. Fix the package, don't work around it.

## 5. Arm deliberately

Set the kill file flags to armed, point `ARCADE_SIGNER_KEYFILE` at the live
key (off-repo, never logged, never committed), and watch the first fills by
hand on the console board. Confirm: one decision row per round, paper rows
mirrored verbatim, `paper_pending` skips (never guesses), cross-loop
exclusion if both loops run.

## 6. Operating rules

- One live position per round across loops, ever. The ledgers enforce it;
  your deploy must not run two copies of one loop (flock + daemon, one
  supervisor per box).
- Cooldown after a loss is one round, matched by round clock — never by
  "latest settlement", which wedges silent while skipping.
- Drawdown brake: two consecutive live losses halve the tier, floored at the
  venue $1 minimum. Any win resets.
- Pause file stops both loops without ledger spam; resume rejoins next round.

## 7. Never

- Never set armed flags in this repo (config ships disarmed; `.env` and
  `config/live.conf` are gitignored for a reason).
- Never share a wallet between loops, never reuse a research key, never
  commit a keyfile path that exists.
- Never "fix" a `paper_pending` skip by guessing. The skip IS the system
  working.
