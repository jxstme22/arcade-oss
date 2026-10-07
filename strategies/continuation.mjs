/**
 * CONTINUATION strategy — FROZEN NEGATIVE EXAMPLE. DO NOT TRADE.
 *
 * This is the R9-H1-era preregistered reversion rule's inverse: compare the
 * current price to the round's own open price and follow it. It measured
 * ~93.5% on settled history, but the comparison is STRUCTURALLY UNTRADEABLE:
 * betting closes before the round opens, so the round's own strike does not
 * exist at decision time. Shipped here as documentation of a dead end, so
 * nobody re-derives it. Nothing in paper/ or live/ imports this module.
 */

export const FROZEN = true;
export const STRATEGY_NAME = "continuation";
export const STRATEGY_VERSION = "r9con-v1-frozen";

/**
 * @param {number} price       current price, in dollars
 * @param {number} openPrice   the round's open price, in dollars
 * @returns {"UP"|"DOWN"|null} the side to take, or null to pass
 */
export function decide(price, openPrice) {
  if (FROZEN) return null; // frozen: never emits a side
  if (!Number.isFinite(price) || !Number.isFinite(openPrice)) return null;
  if (price === openPrice) return null;
  return price < openPrice ? "DOWN" : "UP";
}
