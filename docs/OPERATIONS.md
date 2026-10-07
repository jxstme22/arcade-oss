# Operations

## Layout

All runtime state lives under `ARCADE_DATA_DIR` (default `./data`):
per-variant `*-ledger.jsonl` (append-only truth), `*.db` sqlite mirrors,
`jev-calls.jsonl` (shared snapshot I/O with payload hash, model, latency,
deadline verdict), `*.log`, `board-state.json`, `daemon-health.json`.

## Daily loop

```sh
./scripts/paper.sh     # evaluate the next round (cron: every 60s)
node paper/settle.mjs  # resolve pending bets (cron: every 60s, offset :30)
./scripts/board.sh     # board tick (or run persistent)
```

Or supervise all three: `node scripts/daemon.mjs` (systemd example in
`scripts/systemd/arcade.service.example`). The daemon skips overlapping runs
instead of lock-failing them, restarts the board on exit, and writes
`daemon-health.json` every 5s. Each script keeps its own ledger dedup, so a
daemon restart can neither double-bet nor lose a round.

## Launchers

All `scripts/*.sh` launchers: `set -u`, `cd` to the package root, source
`.env` if present, `mkdir -p` the data dir, take a `flock` under it, then
exec node with relative paths. No absolute paths, no secrets on argv.

## Scoping

`PAPER_JEV_ONLY` (default `agree-jev-a,agree-i-pure`) scopes both the engine
and the settler; other ledgers freeze. `paper/settle.mjs --strategy <db>`
settles one variant. Paper stake/bankroll come from `PAPER_STAKE_MICRO` /
`PAPER_BANKROLL_MICRO` (defaults in `.env.example`).

## Gaps and orphans

- The engine logs `orphan` telemetry when any of the last 3 closed rounds
  lacks an A row — a tick died mid-cycle. Investigate gaps; paper gaps strand
  the live mirror via `paper_pending`.
- If a whole tick's lock is held across the boundary, the next tick exits
  `too_early`/clean instead of cascading. Coverage gaps are visible in the
  ledger, not silent.

## Board

`ARCADE_BOARD_MODE=console` (default) prints to stdout; `once` prints one
snapshot and exits; `telegram` sends via the bot (creds from env, no
defaults). Console/once never import the telegram module. Board state
(telegram dedup) persists in the data dir; paper banks are simulated,
live bank is on-chain only.
