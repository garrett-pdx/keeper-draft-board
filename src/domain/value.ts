import type { AdpMap, SurplusValue } from '../types';

// ---- Keeper value metric ----
// Surplus value = pickValue(marketPick) - pickValue(costPick), where
// pickValue(pick) = 100 * VALUE_DECAY^(pick-1). Tune VALUE_DECAY in one place.
// ~0.965 keeps a strong early-round premium while leaving late rounds non-zero.
export const VALUE_DECAY = 0.965;
export const NO_ADP_VALUE = -99; // players not being drafted this year get an absurd score

export function pickValue(pick: number): number {
  return 100 * Math.pow(VALUE_DECAY, pick - 1);
}

/** Market pick number from current ADP. null if the player isn't being drafted this year. */
export function marketPickFor(playerId: string, adpMap: AdpMap): number | null {
  if (!(playerId in adpMap)) return null;
  const v = adpMap[playerId];
  if (!(v > 0) || v >= 9999) return null;
  return v;
}

/**
 * Surplus value for keeping `playerId` at a given resolved cost round.
 * No current ADP => absurdly low value so it never gets recommended.
 *
 * `exactCostPick`, when known (this season's real draft order has been set),
 * is the roster's actual overall pick number in `costRound` — more accurate
 * than the round-midpoint approximation used otherwise. Omit/pass null when
 * the order isn't known; this always degrades to the approximation, never a
 * wrong number.
 */
export function keeperSurplusValue(
  playerId: string,
  costRound: number,
  adpMap: AdpMap,
  teamCount: number,
  exactCostPick?: number | null,
): SurplusValue {
  const marketPick = marketPickFor(playerId, adpMap);
  if (marketPick === null) {
    return { value: NO_ADP_VALUE, hasAdp: false };
  }
  const teams = teamCount || 10;
  const costPick = exactCostPick != null ? exactCostPick : Math.round(costRound * teams - teams / 2);
  const val = pickValue(marketPick) - pickValue(costPick);
  return { value: +val.toFixed(1), hasAdp: true };
}
