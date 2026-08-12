// State-aware wrappers around the pure domain functions. These read the global
// `state` and hand explicit arguments to the (testable, state-free) domain layer.
import { lastDraftRound } from './data';
import { exactPickForRoster } from './domain/draftOrder';
import {
  getRosterKeeperCosts,
  isInflatedForRoster,
  potentialKeeperCost,
} from './domain/keeperCost';
import { positionCaps } from './domain/mockDraft';
import { keeperSurplusValue } from './domain/value';
import { keeperListFor, ownerIdOfRoster, state, teamNameForRoster } from './state';
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

/**
 * playerId -> the team keeping them, for every keeper that actually resolved.
 *
 * Lives here rather than in state.ts because "is this player really kept" is a
 * question only the domain layer can answer: a selection whose cost resolution
 * failed (`cannotBeKept` — no capacity left at its round or any cheaper one)
 * never occupies a pick and will be in the real draft pool, so labelling it
 * KEPT on the Draft List contradicts the Draft Board, which excludes it from
 * the grid and calls it out as unkeepable.
 */
export function allKeeperIdsWithTeam(): Map<string, string> {
  const map = new Map<string, string>();
  for (const roster of state.rosters) {
    const teamName = teamNameForRoster(roster.roster_id);
    for (const c of getRosterKeeperCostsFor(roster.roster_id)) {
      if (!c.cannotBeKept) map.set(c.playerId, teamName);
    }
  }
  return map;
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

/**
 * How many players of each position this roster already has "on the books"
 * for the mock draft's position-cap AI heuristic: real (resolved) keepers
 * plus whatever it's picked in the simulation so far. A `cannotBeKept`
 * keeper never actually rosters the player, so it's excluded the same way
 * mockDraftAvailablePlayerIds excludes it from `taken`.
 */
export function rosterPositionCountsFor(rosterId: number): Record<string, number> {
  const playersMap = state.playersMap || {};
  const counts: Record<string, number> = {};
  const bump = (playerId: string) => {
    const pos = playersMap[playerId]?.pos;
    if (pos) counts[pos] = (counts[pos] || 0) + 1;
  };
  for (const c of getRosterKeeperCostsFor(rosterId)) {
    if (!c.cannotBeKept) bump(c.playerId);
  }
  if (state.mockDraft) {
    const { slots, picks } = state.mockDraft;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].rosterId === rosterId && picks[i]) bump(picks[i]!);
    }
  }
  return counts;
}

/** This league's per-position mock-draft AI caps, derived from Sleeper's own roster_positions. */
export function mockDraftPositionCaps(): Record<string, number> {
  return positionCaps(state.league?.roster_positions);
}

/**
 * This league's per-position *starting*-slot counts (no bench buffer) —
 * what filterByStarterPriority treats as "starting QB"/"starting TE" for
 * its prerequisite rules, so a 2-QB league's second QB reads as a starter,
 * not a bench player.
 */
export function mockDraftStartingSlots(): Record<string, number> {
  return positionCaps(state.league?.roster_positions, 0);
}
