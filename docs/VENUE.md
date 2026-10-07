# Venue

Measured against the live Jupiter Arcade prediction market. Docs describe the
intent; this file describes reality. Re-probe before trusting any of it.

## Rounds

- 60-second BTC markets. Round id is `btc-{openTs}`, `closeTs = openTs + 60`.
- Each round has a strike (`openPrice`) and settles UP if `close > strike`,
  DOWN otherwise (exact flat is a void/refund in paper accounting).
- Status flows `betting` → `live` → `settled` with an `outcome` field used
  only as a cross-check (paper decides off next-open; mismatches are flagged,
  never silently resolved).

## The two hard constraints

1. **Betting locks ~4-5s before the round opens** (measured; advertised as
   `openTs - 3`). Decide at `openTs - 6` and fire immediately. A POST that
   lands after the lock is refused (`betting_closed` is final — never retry).
2. **The strike doesn't exist at decision time.** The round's `openPrice` is
   null on every future round. Any rule comparing against it is untradeable —
   including the famous ~93% continuation rule, kept frozen in
   `strategies/continuation.mjs` as a warning.

## Endpoints (as probed)

| Endpoint | Behavior |
|----------|----------|
| `GET rounds?asset=BTC` | Only working rounds endpoint. Returns the last ~11 rounds. Paging/filter params ignored. |
| No single-round lookup, bet history, or stats endpoints | Persist everything yourself. |
| Per-second price bars | ~14 days of lookback; intermittent 400s during feed hiccups (walk back, fetch parallel, retry batch once, then skip). |
| 1-minute OHLC candles | 1-minute resolution only, max 1-day range per call. Feeds variant G/H trailing-volatility gates (fully-closed candle only). |

## Money

- Stakes in USDC, $1 minimum (sub-$1 builds are refused).
- Wins pay roughly 1.1x-1.99x gross depending on pool depth at fill time —
  there is no fixed quote. Paper models 1.99x gross minus a 1% venue fee on
  stake; treat paper PNL as modeled, never as cash.
- True live PNL = sum of on-chain USDC deltas per round (stake out + claim
  in), linked by round address. A win whose claim hasn't landed contributes
  its stake only.
