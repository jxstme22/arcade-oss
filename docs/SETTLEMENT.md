# Settlement

The shared paper convention. Identical for every variant, enforced by the
single unified settler (`paper/settle.mjs --strategy <db>` or all in scope).

## The rule

Next round's open vs this round's open decides:

- next open > round open → UP wins; < → DOWN wins; exactly equal → FLAT/VOID.
- `won = (direction == FLAT) ? null : (side == direction)`.
- Venue `outcome` is recorded as a cross-check; a mismatch sets
  `venueMismatch: true` and is flagged, never silently resolved.

## The money

- Gross on win: `round(stake * 1.99)`. Loss: 0 (stake forfeited). Void: stake
  returned (`gross = stake`, `won = null`).
- Fee: `round(stake * 100 / 10000)` — uniform 1% of settled stake, computed in
  the query layer so fee-free history and fee-carrying rows agree.
- `pnl = gross - stake - fee`. Bankroll = start + Σ pnl over ALL settled.

## Mechanics

- Pending bets derive from the ledger (bets minus settlements) every run —
  no shared state file, no race.
- The sqlite mirror (`paper/db.mjs`, one DB per strategy) backfills
  ledger → DB on every open with INSERT OR IGNORE, so replays are harmless.
  Totals (rounds, settled, win rate, ROI, bank) are queries over all history
  and can never be reset by a restart.
- Skips are ledger-only and never become pending. A round the feed aged out
  of unsettled stays pending — unrecoverable by design (11-minute venue
  window), reported, never guessed.
- Settlement config: `config/strategy.json` → `settlement: { grossMult:
  1.99, feeBps: 100 }`.
