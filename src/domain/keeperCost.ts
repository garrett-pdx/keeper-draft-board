import type { SleeperDraft } from '../api/schemas';
import type { AdpMap, KeeperCostItem, PlayersMap, PrevDraftEntry, PrevDraftMap } from '../types';
import { exactPickForRoster } from './draftOrder';
import { keeperSurplusValue } from './value';

// Keeper cost rules for this league (see README "Domain rules"):
// - Cost = the round the player was drafted last year.
// - Same manager keeping the same player two years running: cost climbs a
//   configurable number of rounds (floored at 1). Matched on stable owner
//   user_id, NOT roster_id.
// - Undrafted last year: cost = the final round of the draft.
// - Same-round collision between a team's keepers: the better-ranked player(s)
//   bump up a round, cascading if that creates a new collision one round up
//   (tie-break chosen by us, not specified by the league).

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
 * Cost if this roster keeps a player, from last year's draft alone (no same-team
 * collision logic yet). Undrafted-last-year players cost the final round.
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
}

/**
 * Resolve same-round collisions among a roster's selected keepers. Exactly one
 * item in each colliding group keeps its round; the rest bump up a round each,
 * best-ranked first, worst-ranked left holding the round. Re-checks after every
 * bump since it may create a new collision one round up. Items that hit the
 * round-1 floor while still colliding are marked `unresolvedCollision`.
 */
function resolveCollisions(items: KeeperCostItem[], playersMap: PlayersMap): void {
  const rankOf = (pid: string) => (playersMap[pid] ? playersMap[pid].rank : 9999);
  let changed = true;
  while (changed) {
    changed = false;
    const buckets = new Map<number, KeeperCostItem[]>();
    for (const item of items) {
      const bucket = buckets.get(item.cost);
      if (bucket) bucket.push(item);
      else buckets.set(item.cost, [item]);
    }
    for (const group of buckets.values()) {
      if (group.length <= 1) continue;
      const ordered = group.slice().sort((a, b) => rankOf(a.playerId) - rankOf(b.playerId));
      // every item but the worst-ranked (last) must move up a round
      for (let i = 0; i < ordered.length - 1; i++) {
        const item = ordered[i];
        if (item.cost > 1) {
          item.cost -= 1;
          item.bumped = true;
          changed = true;
        } else {
          item.unresolvedCollision = true;
        }
      }
    }
  }
}

/**
 * Final costs for a roster's *selected* keepers, with same-round collisions
 * resolved, then surplus value attached at each resolved cost round.
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
  } = ctx;

  const items: KeeperCostItem[] = keeperIds.map((pid) => {
    const prev = prevDraftMap ? prevDraftMap[pid] : null;
    const base = prev ? prev.round : lastRound;
    const cost = potentialKeeperCost(prev, ownerId, rosterId, lastRound, inflationRounds);
    return {
      playerId: pid,
      base,
      cost,
      bumped: false,
      unresolvedCollision: false,
      hasData: !!prev,
      value: 0,
      hasAdp: false,
    };
  });

  resolveCollisions(items, playersMap);

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
