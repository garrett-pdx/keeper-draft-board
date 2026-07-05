import type { AdpMap, KeeperCostItem, PlayersMap, PrevDraftEntry, PrevDraftMap } from '../types';
import { keeperSurplusValue } from './value';

// Keeper cost rules for this league (see README "Domain rules"):
// - Cost = the round the player was drafted last year.
// - Same manager keeping the same player two years running: cost climbs one
//   round (floored at 1). Matched on stable owner user_id, NOT roster_id.
// - Undrafted last year: cost = the final round of the draft.
// - Same-round collision between a team's two keepers: the better-ranked player
//   bumps up one round (tie-break chosen by us, not specified by the league).

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
): number {
  if (!prev) return lastRound;
  let cost = prev.round;
  if (sameManagerLastYear(prev, currentOwnerId, currentRosterId) && prev.wasKeeper && cost > 1) {
    cost = cost - 1;
  }
  return cost;
}

/**
 * True if THIS roster kept THIS player last year, so keeping again inflates the
 * cost by one round. Floored at round 1 — a round-1 keeper can't inflate further.
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
}

/**
 * Final costs for a roster's *selected* keepers, with same-round collision
 * resolved, then surplus value attached at each resolved cost round.
 */
export function getRosterKeeperCosts(ctx: RosterKeeperContext): KeeperCostItem[] {
  const { keeperIds, prevDraftMap, playersMap, adpMap, ownerId, rosterId, lastRound, teamCount } =
    ctx;

  const items: KeeperCostItem[] = keeperIds.map((pid) => {
    const prev = prevDraftMap ? prevDraftMap[pid] : null;
    const base = prev ? prev.round : lastRound;
    const cost = potentialKeeperCost(prev, ownerId, rosterId, lastRound);
    return { playerId: pid, base, cost, bumped: false, hasData: !!prev, value: 0, hasAdp: false };
  });

  // Same-round collision: two keepers landing on the same cost round. The
  // better-ranked one bumps up a round. (Tie-break not defined by the league.)
  if (items.length === 2 && items[0].cost === items[1].cost) {
    const rankOf = (pid: string) => (playersMap[pid] ? playersMap[pid].rank : 9999);
    const bumpIdx = rankOf(items[0].playerId) <= rankOf(items[1].playerId) ? 0 : 1;
    if (items[bumpIdx].cost > 1) {
      items[bumpIdx].cost -= 1;
      items[bumpIdx].bumped = true;
    }
  }

  // Attach surplus value using each item's resolved cost round.
  items.forEach((it) => {
    const sv = keeperSurplusValue(it.playerId, it.cost, adpMap, teamCount);
    it.value = sv.value;
    it.hasAdp = sv.hasAdp;
  });
  return items;
}
