// State-aware wrappers around the pure domain functions. These read the global
// `state` and hand explicit arguments to the (testable, state-free) domain layer.
import { lastDraftRound } from './data';
import { exactPickForRoster } from './domain/draftOrder';
import {
  getRosterKeeperCosts,
  isInflatedForRoster,
  potentialKeeperCost,
} from './domain/keeperCost';
import { keeperSurplusValue } from './domain/value';
import { keeperListFor, ownerIdOfRoster, state } from './state';
import type { KeeperCostItem, SurplusValue } from './types';

export function potentialKeeperCostFor(playerId: string, rosterId: number): number {
  const prev = state.prevDraftMap ? state.prevDraftMap[playerId] : null;
  return potentialKeeperCost(
    prev,
    ownerIdOfRoster(rosterId),
    rosterId,
    lastDraftRound(),
    state.rules.inflationRounds,
  );
}

export function keeperSurplusValueFor(
  playerId: string,
  costRound: number,
  rosterId: number,
): SurplusValue {
  const teamCount = state.rosters.length || 10;
  // Taxi squad mode: no round is ever spent, so value is against an infinite
  // cost pick (full market value) rather than this roster's actual pick.
  const exactCostPick = state.rules.noKeeperCost
    ? Infinity
    : exactPickForRoster(state.draft, rosterId, costRound, teamCount);
  return keeperSurplusValue(playerId, costRound, state.adpMap || {}, teamCount, exactCostPick);
}

export function isInflatedFor(playerId: string, rosterId: number): boolean {
  const prev = state.prevDraftMap ? state.prevDraftMap[playerId] : null;
  return isInflatedForRoster(prev, ownerIdOfRoster(rosterId), rosterId);
}

export function getRosterKeeperCostsFor(rosterId: number): KeeperCostItem[] {
  return getRosterKeeperCosts({
    keeperIds: keeperListFor(rosterId),
    prevDraftMap: state.prevDraftMap || {},
    playersMap: state.playersMap || {},
    adpMap: state.adpMap || {},
    ownerId: ownerIdOfRoster(rosterId),
    rosterId,
    lastRound: lastDraftRound(),
    teamCount: state.rosters.length || 10,
    inflationRounds: state.rules.inflationRounds,
    draft: state.draft,
    tradedPicks: state.tradedPicks || [],
    noKeeperCost: state.rules.noKeeperCost,
  });
}

// ---------- mock draft ----------

/** How many keepers already occupy this exact (round, roster) board cell. */
export function keepersInCellFor(round: number, rosterId: number): number {
  return getRosterKeeperCostsFor(rosterId).filter(
    (c) => c.cost === round && !c.cannotBeKept && !c.taxiSquad,
  ).length;
}

/**
 * Every draftable player not already spoken for — kept by any roster (the
 * real thing, not a mock pick) or already mock-drafted so far in this
 * simulation. Filtered to real fantasy positions, matching src/ui/draft.ts's
 * existing `pos && pos !== '—'` filter.
 *
 * Excludes a player from a raw `keeperListFor` selection only when that
 * selection actually resolved — a `cannotBeKept` keeper frees its capacity
 * for a mock slot (keepersInCellFor above already excludes it) but was never
 * really kept, so it must stay in the pool too, or it'd be permanently
 * undraftable by anyone once its owner's capacity ran out.
 */
export function mockDraftAvailablePlayerIds(): string[] {
  const playersMap = state.playersMap || {};
  const taken = new Set<string>();
  for (const roster of state.rosters) {
    for (const c of getRosterKeeperCostsFor(roster.roster_id)) {
      if (!c.cannotBeKept) taken.add(c.playerId);
    }
  }
  if (state.mockDraft) {
    for (const pid of state.mockDraft.picks) {
      if (pid) taken.add(pid);
    }
  }
  return Object.keys(playersMap).filter((pid) => {
    const p = playersMap[pid];
    return p.pos && p.pos !== '—' && !taken.has(pid);
  });
}
