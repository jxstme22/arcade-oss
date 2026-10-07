# AGENTS.md — guidance for AI assistants working in `arcade-oss/`

You are operating in a **paper-first trading package with live-money code paths**.
Read this whole file before touching anything. It overrides generic instincts:
when in doubt, the conservative action wins.

## 1. Map (read these first, in order)

| Path | What it is | Touch rules |
|---|---|---|
| `README.md`, `docs/STRATEGY.md` | What the system does and why | Update when behavior changes; never promise results |
| `strategies/agree.mjs` | Pure Mo/Vo consensus rule (no I/O) | Pure functions only; golden tests pin outputs |
| `strategies/continuation.mjs` | Frozen negative example (`FROZEN=true`) | NEVER wire into a runner; document-only |
| `strategies/jev-contract.mjs` | Vendored Jev state/validator | Vendored — do not hand-edit; note upstream instead |
| `paper/engine.mjs` | Paper engine, variants A–I, `buildPlans` | Byte-identical rule cores; see §4 |
| `paper/db.mjs`, `paper/settle.mjs` | sqlite mirror + unified settler | Keep `--strategy` matrix green |
| `live/aagree.mjs`, `live/mom60.mjs`, `live/gate.mjs` | Live loops + gate | §5 safety rules are absolute |
| `notify/board.mjs`, `notify/telegram.mjs` | Board + Telegram transport | Board is display-only; see reliability note in README |
| `scripts/` | daemon, launchers, doctor, checks | Keep `set -u`, relative paths, `DATA_DIR` discipline |
| `config/strategy.json` | All tuned constants (`frozen:true` = research-grade) | Changing a frozen gate = new experiment, not a tweak |
| `test/` | Golden + inert tests | Must stay green; extend, never weaken |

## 2. Installation (do this before any other work)

```sh
cd arcade-oss
cp -n .env.example .env   # never commit .env (gitignored)
npm install
node scripts/doctor.mjs   # must exit 0 (warnings OK, hards fail on node<22)
npm test                  # must be green before AND after your change
```

Never set real credentials in dev: no bot tokens, no API keys, no wallet keys,
no real chat IDs. Console/`--once` board modes cover all verification needs.

## 3. Running things (dev only — paper and dry paths)

```sh
./scripts/paper.sh --once --dry-run   # one paper evaluation, writes nothing
node paper/agree-runner.mjs --once    # paper against live feeds (reads only)
node notify/board.mjs --once         # board snapshot to stdout, exit 0
node scripts/daemon.mjs              # foreground supervisor (replaces cron)
npm run audit                         # guardrail scripts (must print AUDIT PASS)
```

- Paper needs network (venue + price feeds) but zero credentials. Offline or
  feed failure must degrade to a logged skip, never a crash — if you see an
  uncaught throw on a dead feed, that's a bug; fix it.
- Live loops without key/conf must print `dry_build`/`OFF` and exit 0.
  If a live path can broadcast without `TRADING=1` + `DRY_RUN=0` + present
  signer + kill file, stop everything and fix that first.

## 4. Editing rules

1. **Golden rule cores are frozen.** `buildPlans` A–I in `paper/engine.mjs`
   must stay byte-identical unless you are deliberately defining a new
   variant (new id, new ledger, new frozen constants, new tests). Threshold
   changes require a forward-sample plan, not an edit.
2. **Tests before behavior.** Add/extend `test/` for any rule change; `npm test`
   green on every commit. Split-half discipline for new gates: fit on old
   rounds, validate on newer rounds, report both (and the dead ends).
3. **Point-in-time legality.** Decision inputs may only use data available at
   decision time (trailing candles, never the forming candle/round). Any use
   of a round's own outcome in its decision is a launch-blocking bug.
4. **No new runtime deps** without justification; `node:sqlite` covers storage.
5. **No absolute paths.** `/opt`, `/etc`, `/root`, `/tmp` literals are banned
   (CI greps for them). Everything lives under `ARCADE_DATA_DIR` (default
   `./data`). New lockfiles go under `$DATA_DIR` with package-unique names.
6. **Docs follow code.** Behavior change without README/docs update = incomplete.
   Results are always dated and labeled reference-not-promise.

## 5. Live-money safety (absolute, no exceptions)

- NEVER set `TRADING=1` / `DRY_RUN=0`, never add a `--live` auto-path, never
  remove the `dry_build` gate to make a test pass.
- NEVER handle real private keys, keyfiles, or mnemonics. Test the gate with
  *absent* credentials (asserts inert), never with real ones.
- NEVER write to or read from a real wallet, real ledger, or production path
  during development. Fixture data only (`test/fixtures/`, fake round ids).
- The kill-switch file is read, never written, by loops. `KILL=1`,
  `TRADING=0`, missing key, or missing file must all fail closed.
- One decision per round per variant, ever — dedup is a safety property, not
  a nice-to-have. Restarts must not double-bet (test this explicitly if you
  touch scheduling or persistence).

## 6. Debugging playbook

| Symptom | Check first |
|---|---|
| Paper row missing for a round | `data/paper-jev.log` tail for `orphan`/`too_early`/fetch errors; feed had ~11 rounds only — aged-out rounds are unrecoverable |
| `paper_pending` on live | Paper tick died or overran (Jev stall → 8s cap vetoes; check `jev_calls` latencies); NOT a live bug |
| `betting_closed` / `build_refused` climbs | Decide earlier (T-6 discipline); never raise stake to compensate |
| Board shows `?` / stale table | `data/` mirrors vs ledger freshness; dedup state corruption → delete state file (regenerates; history re-seeds silently) |
| Telegram alerts missing/duplicated | Known weak spot (see README note): check bot token/chat id, dedup state, network; console mode is the ground truth |
| `below_floor` / `insufficient_stake` | Funding, not strategy — check wallet balance on-chain, not the ledger |
| Test failure on thresholds | You (or someone) changed a frozen constant — revert or declare a new experiment |
| `transient` retry crash (historical) | Retry classifier must be allow-list; unknown errors = single attempt, never throw |

Useful reads: `data/*.jsonl` tails (decisions/orders/settlements with reasons),
`data/paper-jev.log` (cycles, orphans, Jev latencies), kill file flags,
`DAEMON` health if supervised. Correlate by `round_id` (`btc-<openTs>`)
across paper ledger → live ledger → settlement → chain delta.

## 7. Auditing (run before every PR/push)

```sh
npm test
npm run audit
bash scripts/check-no-signer.sh
bash scripts/check-no-hardcoded-paths.sh
git status --porcelain   # only arcade-oss/ paths may appear
```

Refuse to ship if: any check fails; a live path can broadcast in dev config;
a new secret-shaped string appears anywhere; docs contradict code.

## 8. Working agreements

- Small diffs, one concern per commit, `npm test` green each commit.
- Report dead ends: list every gate/variant you tested and killed, one line
  each. Negative results are the product.
- Numbers or it didn't happen: win rates always with sample size, selection
  AND validation halves, coverage/day, worst streak. No 90%-WR fairy tales —
  breakeven is ~50.8% at modeled economics and the attainable game is 60–70%
  selective.
- Ask before: new dependencies, new variants, threshold changes, anything that
  touches live broadcast preconditions, publishing or extracting the package.
