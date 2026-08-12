import type { AdpMap } from '../types';

// A mock draft simulates at the same round×roster CELL granularity the Draft
// Board already renders — never a flat 1..N pick list. Resolving exactly
// which of a roster's multiple held picks in one round (via trade) interleaves
// at which literal overall pick number is a problem this codebase has never
// needed to solve (the board only ever shows stacked cards in one cell, not
// separately-numbered picks — see KeeperCostItem.consumedPick's narrower
// "which pick did THIS keeper consume" scope). So each cell simply gets
// `capacityFor - keepersInCellFor` slots, simulated back-to-back for that
// roster when it's more than one — an explicit, documented simplification.
export interface MockDraftSlot {
  round: number;
  rosterId: number;
}

/**
 * Flattens the whole draft into one ordered slot list, built once (at Start,
 * never recomputed per turn) so an in-progress simulation is immune to the
 * league's live data changing underneath it. `slotOrderRosterIds` is the
 * frozen snake seed order (real draft slot order when known, else roster_id
 * order — see domain/draftOrder.ts's orderRosterIdsBySlot), snake-reversed on
 * even rounds using the same odd/even convention as exactPickNumber.
 *
 * `capacityFor`/`keepersInCellFor` are injected closures rather than raw
 * TradedPicksList/KeeperCostItem[] — matching keeperCost.ts's
 * assignKeeperCosts, which takes a capacityFor callback rather than reaching
 * into tradedPicks.ts itself — so this stays a pure function of primitives.
 * The difference is provably always >= 0 (assignKeeperCosts guarantees a
 * resolved cell never holds more keepers than its capacity); a negative
 * value would mean a real upstream bug, so it's never clamped here.
 */
export function buildMockDraftSlots(
  rounds: number,
  slotOrderRosterIds: number[],
  capacityFor: (round: number, rosterId: number) => number,
  keepersInCellFor: (round: number, rosterId: number) => number,
): MockDraftSlot[] {
  const slots: MockDraftSlot[] = [];
  if (rounds <= 0 || !slotOrderRosterIds.length) return slots;
  for (let round = 1; round <= rounds; round++) {
    const order = round % 2 === 1 ? slotOrderRosterIds : slotOrderRosterIds.slice().reverse();
    for (const rosterId of order) {
      const needed = capacityFor(round, rosterId) - keepersInCellFor(round, rosterId);
      for (let i = 0; i < needed; i++) slots.push({ round, rosterId });
    }
  }
  return slots;
}

/**
 * The "rudimentary AI" — pure best-player-available by ascending ADP/value
 * rank, nothing else. No positional need weighting, no roster construction
 * logic. Intentionally simple, per the feature's explicit scope. Missing-ADP
 * players use the same 9999 sentinel src/ui/draft.ts's own sort already
 * uses, so they're deprioritized rather than excluded.
 */
export function bestAvailablePlayer(availablePlayerIds: string[], adpMap: AdpMap): string | null {
  if (!availablePlayerIds.length) return null;
  let best = availablePlayerIds[0];
  let bestAdp = best in adpMap ? adpMap[best] : 9999;
  for (let i = 1; i < availablePlayerIds.length; i++) {
    const pid = availablePlayerIds[i];
    const adp = pid in adpMap ? adpMap[pid] : 9999;
    if (adp < bestAdp) {
      best = pid;
      bestAdp = adp;
    }
  }
  return best;
}
