# arcade-oss

Paper-first Arcade 60s prediction package. Simulates momentum-consensus
strategies against public feeds, settles them against venue history, and shows
a board. Live loops ship **inert**: no kill file, no signer, no broadcast.

## 5-command quickstart

```sh
cp .env.example .env
npm install
node scripts/doctor.mjs
node paper/agree-runner.mjs --once --dry-run
node notify/board.mjs --once
```

1. `cp .env.example .env` — local config (gitignored, stays empty of secrets).
2. `npm install` — installs the two runtime deps (`@probz/jupiter`,
   `@probz/jev` resolve via the monorepo; check out the full repo, not this
   directory alone, or `npm install` has nothing to link against).
3. `node scripts/doctor.mjs` — node >= 22? data dir writable? feeds reachable?
   Offline degrades to warnings, never a hard fail.
4. `node paper/agree-runner.mjs --once --dry-run` — one paper evaluation,
   prints the verdict, writes nothing. No network? Clean offline skip, exit 0.
5. `node notify/board.mjs --once` — one board snapshot, exit 0.

`npm test` runs the golden engine tests (65 assertions) plus the live-inert
gate tests. `npm run audit` re-verifies the shipped-inert posture.

## The strategy in 30 seconds

Two dumb friends vote on direction. Bet only when they agree.

- **Mo (momentum):** is the price now higher or lower than 60 seconds ago?
- **Vo (vote):** last 5 price ticks, weights 1-2-3-4-5 (newest counts most),
  majority wins. Flat ticks poison the vote; ties mean no vote.
- **Agreement:** Mo == Vo → bet that side. Anything else → skip with a reason.

Either leg alone is ~52-54%. Together on calm minutes: ~60-65% in the
measured samples. See `docs/STRATEGY.md`. Historical numbers are reference
points, not promises — see `docs/RESULTS.md`.

## Variants (paper engine)

| ID | Rule | Cost of being wrong |
|----|------|---------------------|
| A | AGREE entries, no Jev (control) | — |
| B | A + Jev veto on opposition | skips weak agreement Jev dislikes |
| C | A + Jev conviction only (p≥0.70 / ≤0.30, frozen) | lowest coverage |
| D | MOM60 + Jev veto | — |
| D0 | MOM60, no Jev (matched control) | — |
| E | Router: strong Jev leads, weak + consensus bets consensus | fitted post-hoc, forward validation only |
| F | Disagree rounds only: bet the Jev-favored side | forward validation only |
| G | Sniper: agree + calm trailing minute + weak Jev + decisive vote | ~3 bets/day |
| H | G + with-trend (side == prior-minute candle direction) | rarest |
| I | H minus Jev: pure price action, zero model risk | — |

Full gates in `docs/VARIANTS.md`. Jev thresholds are frozen (`"frozen": true`
in `config/strategy.json`); changing one requires a new variant, not an edit.

## Venue realities (measured, not documented)

- 60-second BTC rounds; betting locks **~4-5s before open** (earlier than
  advertised). Decide at open minus 6, fire immediately.
- The round's own strike doesn't exist at decision time — any rule of the form
  "price vs this round's open" is structurally untradeable (see the frozen
  negative example in `strategies/continuation.mjs`).
- The rounds feed returns only the ~11 latest rounds. Persist everything
  locally or old results are unrecoverable.
- Wins pay roughly 1.1x-1.99x gross depending on pool depth. Paper models
  1.99x minus 1% fee; live PNL must be linked on-chain per round, never modeled.
- Details: `docs/VENUE.md`. Settlement rule: `docs/SETTLEMENT.md`.

## Paper ops

```sh
./scripts/paper.sh --once --dry-run   # evaluate once, write nothing
./scripts/paper.sh                    # full tick (writes ledger rows)
node paper/settle.mjs                 # settle pending bets (all variants)
node paper/settle.mjs --strategy agree-jev-a
PAPER_JEV_ONLY=agree-jev-a,agree-i-pure ./scripts/paper.sh
```

Cron or the daemon (`node scripts/daemon.mjs`, see
`scripts/systemd/arcade.service.example`) runs paper + settle every 60s.
One action per round per variant, ever — restarts can't double-write.

## Console board

```sh
./scripts/board.sh --once            # single snapshot, stdout, exit 0
ARCADE_BOARD_MODE=telegram ./scripts/board.sh --once   # send once via bot
```

Console/once modes never load Telegram credentials. The board is read-only:
it parses ledgers + sqlite mirrors and writes nothing (except telegram-mode
dedup state). See `docs/OPERATIONS.md`.

> **Note — notifier reliability.** The Telegram notifier path (rich
> tables, event fan-out, multi-chat delivery, dedup state) is the least
> battle-tested part of this package: expect missed or duplicated alerts on
> flaky networks, stale dedup state after unclean kills, and formatting
> quirks on some clients. Treat the board as a convenience display, never as
> the source of truth — ledgers + sqlite mirrors are. Console/`--once` mode
> is the reliable path; Telegram mode is best-effort until hardened. Bugs
> welcome as issues with the `notify` label and the relevant log lines.

## Going live (checklist, not a button)

1. Read `docs/GOING_LIVE.md` end to end.
2. Fund a dedicated wallet; record its floor, tier stakes, and kill conditions.
3. Create the kill file from `config/live.conf.example` on a root-only path;
   keep TRADING disarmed until the forward sample matches paper.
4. Run the live loop disarmed first: it must print `dry_build` and exit 0.
5. `npm run audit` must print AUDIT PASS.
6. Arm only deliberately, with a human watching the first fills.

## Security

- No secrets in this repo: `.env` is gitignored, `.env.example` ships empty
  values, `config/live.conf` is gitignored. `npm run audit` fails the build on
  PEM blocks, signer misuse, embedded credentials, or machine-global paths.
- Live loops: two-key gate (kill file + signer both required), guard mode is
  the only broadcast authority, one decision per round ever, cross-loop
  exclusion so two loops never take the same round.
- Paper and live never share a ledger, a DB, or a state file.

## License

MIT — see `LICENSE`. Historical research notes (retired loops, dead ends) are
in `docs/HISTORY.md` so nobody re-derives them.
