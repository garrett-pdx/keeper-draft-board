// State-aware wrappers around the pure domain functions. These read the global
// `state` and hand explicit arguments to the (testable, state-free) domain layer.
import { lastDraftRound } from './data';
import { getRosterKeeperCosts, isInflatedForRoster, potentialKeeperCost } from './domain/keeperCost';
import { keeperSurplusValue } from './domain/value';
import { keeperListFor, ownerIdOfRoster, state } from './state';
import type { KeeperCostItem, SurplusValue } from './types';

export function potentialKeeperCostFor(playerId: string, rosterId: number): number {
  const prev = state.prevDraftMap ? state.prevDraftMap[playerId] : null;
  return potentialKeeperCost(prev, ownerIdOfRoster(rosterId), rosterId, lastDraftRound());
}

export function keeperSurplusValueFor(playerId: string, costRound: number): SurplusValue {
  return keeperSurplusValue(playerId, costRound, state.adpMap || {}, state.rosters.length || 10);
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
  });
}
