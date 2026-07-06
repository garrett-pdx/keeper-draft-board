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
  const exactCostPick = exactPickForRoster(state.draft, rosterId, costRound, teamCount);
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
  });
}
