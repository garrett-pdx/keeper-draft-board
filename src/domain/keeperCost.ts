import type { SleeperDraft } from '../api/schemas';
import type { AdpMap, KeeperCostItem, PlayersMap, PrevDraftEntry, PrevDraftMap } from '../types';
import { exactPickForRoster } from './draftOrder';
import { heldPickOriginalOwners, pickCapacity, type TradedPicksList } from './tradedPicks';
import { keeperSurplusValue } from './value';

// Keeper cost rules for this league (see README "Domain rules"):
// - Cost = the round the player was drafted last year.
// - Same manager keeping the same player two years running: cost climbs a
//   configurable number of rounds (floored at 1). Matched on stable owner
//   user_id, NOT roster_id.
// - Undrafted last year: cost = the final round of the draft.
// - Each round has a "capacity" of picks a roster actually holds that round
//   (normally 1, adjusted by trades — see domain/tradedPicks.ts). If more
//   keepers want a round than the roster has capacity for (including capacity
//   0, i.e. their own pick was traded away with nothing acquired), the
//   better-ranked keeper(s) are displaced to the next round toward round 1
//   (more expensive), cascading if that round is also over capacity. A keeper
//   displaced all the way past round 1 with nowhere left to go cannot be kept
//   at all (tie-break chosen by us, not specified by the league).

/**
 * Did the manager now holding `currentRosterId` (owner `currentOwnerId`) also
 * hold this player last year? Prefer stable user_id matching; fall back to raw
 * roster_id only when owner ids are unavailable.
 */
export function sameManagerLastYear(
  prev: PrevDraftEntry | null | undefined,
  currentOwnerId: string | null,
  currentRosterId: number,
): boolean {
  if (!prev) return false;
  if (prev.ownerId && currentOwnerId) return prev.ownerId === currentOwnerId;
  return prev.rosterId === currentRosterId; // fallback
}

/**
 * Cost if this roster keeps a player, from last year's draft alone (no
 * capacity/collision resolution yet). Undrafted-last-year players cost the
 * final round.
 */
export function potentialKeeperCost(
  prev: PrevDraftEntry | null | undefined,
  currentOwnerId: string | null,
  currentRosterId: number,
  lastRound: number,
  inflationRounds: number,
): number {
  if (!prev) return lastRound;
  let cost = prev.round;
  if (sameManagerLastYear(prev, currentOwnerId, currentRosterId) && prev.wasKeeper && cost > 1) {
    cost = Math.max(1, cost - inflationRounds);
  }
  return cost;
}

/**
 * True if THIS roster kept THIS player last year, so keeping again inflates the
 * cost. Floored at round 1 — a round-1 keeper can't inflate further.
 */
export function isInflatedForRoster(
  prev: PrevDraftEntry | null | undefined,
  currentOwnerId: string | null,
  currentRosterId: number,
): boolean {
  return !!(
    prev &&
    sameManagerLastYear(prev, currentOwnerId, currentRosterId) &&
    prev.wasKeeper &&
    prev.round > 1
  );
}

export interface RosterKeeperContext {
  keeperIds: string[];
  prevDraftMap: PrevDraftMap;
  playersMap: PlayersMap;
  adpMap: AdpMap;
  ownerId: string | null;
  rosterId: number;
  lastRound: number;
  teamCount: number;
  inflationRounds: number;
  draft?: SleeperDraft | null;
  tradedPicks?: TradedPicksList;
}

/**
 * Assign each keeper a cost round given how many actual picks the roster
 * holds per round (`capacityFor`, normally 1 but adjusted by trades). If a
 * round holds more keepers than its capacity, the better-ranked keeper(s) are
 * displaced toward round 1 (more expensive), cascading through rounds that are
 * themselves over capacity. A keeper displaced past round 1 with no capacity
 * left anywhere cannot be kept. Reduces to the original same-round collision
 * behavior when capacity is 1 everywhere (the no-trades default).
 */
function assignKeeperCosts(
  items: KeeperCostItem[],
  playersMap: PlayersMap,
  capacityFor: (round: number) => number,
): void {
  const rankOf = (pid: string) => (playersMap[pid] ? playersMap[pid].rank : 9999);
  let active = items.slice();
  let changed = true;
  while (changed) {
    changed = false;
    const buckets = new Map<number, KeeperCostItem[]>();
    for (const item of active) {
      const bucket = buckets.get(item.cost);
      if (bucket) bucket.push(item);
      else buckets.set(item.cost, [item]);
    }
    for (const [round, group] of buckets) {
      const capacity = capacityFor(round);
      if (group.length <= capacity) continue; // fits — nothing to do
      const sorted = group.slice().sort((a, b) => rankOf(a.playerId) - rankOf(b.playerId));
      const keepCount = capacity; // may be 0
      const excess = sorted.slice(0, sorted.length - keepCount); // best-ranked, displaced
      for (const item of excess) {
        if (item.cost > 1) {
          item.cost -= 1;
          item.bumped = true;
        } else {
          item.cannotBeKept = true;
        }
        changed = true;
      }
    }
    if (changed) active = active.filter((item) => !item.cannotBeKept);
  }
}

/**
 * When a roster holds more than one pick in a round (via trade), decide which
 * literal pick each occupying keeper consumes: the worst (highest-numbered)
 * of the held picks, best-ranked keeper getting the best of those. Only
 * resolvable once this season's real draft order is known; a no-op otherwise.
 * Never affects `cost` — purely which specific pick is "spent" vs. left open.
 */
function attachConsumedPicks(
  items: KeeperCostItem[],
  tradedPicks: TradedPicksList,
  rosterId: number,
  draft: SleeperDraft | null | undefined,
  teamCount: number,
  playersMap: PlayersMap,
): void {
  const rankOf = (pid: string) => (playersMap[pid] ? playersMap[pid].rank : 9999);
  const buckets = new Map<number, KeeperCostItem[]>();
  for (const item of items) {
    if (item.cannotBeKept) continue;
    const bucket = buckets.get(item.cost);
    if (bucket) bucket.push(item);
    else buckets.set(item.cost, [item]);
  }
  for (const [round, group] of buckets) {
    const owners = heldPickOriginalOwners(tradedPicks, round, rosterId);
    if (owners.length <= 1) continue; // only one pick held — nothing to disambiguate
    const pickNumbers = owners
      .map((ownerRid) => exactPickForRoster(draft, ownerRid, round, teamCount))
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
    if (pickNumbers.length < group.length) continue; // order not known yet
    const worstN = pickNumbers.slice(pickNumbers.length - group.length);
    const ordered = group.slice().sort((a, b) => rankOf(a.playerId) - rankOf(b.playerId));
    ordered.forEach((item, i) => {
      item.consumedPick = worstN[i];
    });
  }
}

/**
 * Final costs for a roster's *selected* keepers, with capacity-aware
 * collisions resolved, then surplus value attached at each resolved cost round.
 */
export function getRosterKeeperCosts(ctx: RosterKeeperContext): KeeperCostItem[] {
  const {
    keeperIds,
    prevDraftMap,
    playersMap,
    adpMap,
    ownerId,
    rosterId,
    lastRound,
    teamCount,
    inflationRounds,
    draft,
    tradedPicks,
  } = ctx;
  const trades = tradedPicks || [];

  const items: KeeperCostItem[] = keeperIds.map((pid) => {
    const prev = prevDraftMap ? prevDraftMap[pid] : null;
    const base = prev ? prev.round : lastRound;
    const cost = potentialKeeperCost(prev, ownerId, rosterId, lastRound, inflationRounds);
    return {
      playerId: pid,
      base,
      cost,
      bumped: false,
      cannotBeKept: false,
      hasData: !!prev,
      value: 0,
      hasAdp: false,
      consumedPick: null,
    };
  });

  assignKeeperCosts(items, playersMap, (round) => pickCapacity(trades, round, rosterId));
  attachConsumedPicks(items, trades, rosterId, draft, teamCount, playersMap);

  // Attach surplus value using each item's resolved cost round, preferring the
  // roster's exact pick number when this season's draft order is known.
  items.forEach((it) => {
    const exactCostPick = exactPickForRoster(draft, rosterId, it.cost, teamCount);
    const sv = keeperSurplusValue(it.playerId, it.cost, adpMap, teamCount, exactCostPick);
    it.value = sv.value;
    it.hasAdp = sv.hasAdp;
  });
  return items;
}
