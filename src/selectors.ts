// State-aware wrappers around the pure domain functions. These read the global
// `state` and hand explicit arguments to the (testable, state-free) domain layer.
import { lastDraftRound } from './data';
import { ROLL_DOUBLE_UP, seededRoll } from './domain/draftAi';
import {
  MUDD_MANAGERS,
  MUDD_QBTE_PROFILES,
  MUDD_ROUND_BANDS,
  hasTendencyQuorum,
  positionWeightsForRound,
  qbTeDoubleUpOdds,
} from './domain/draftTendencies';
import { exactPickForRoster } from './domain/draftOrder';
import {
  getRosterKeeperCosts,
  isInflatedForRoster,
  potentialKeeperCost,
} from './domain/keeperCost';
import { startablePositions } from './domain/leagueSettings';
import { lockedKeeperCosts } from './domain/lockedKeepers';
import { dedicatedStarterCounts, mockDraftCaps } from './domain/mockDraft';
import { keeperSurplusValue } from './domain/value';
import {
  keeperListFor,
  keepersLockedInSleeper,
  ownerIdOfRoster,
  state,
  teamNameForRoster,
  userForRoster,
} from './state';
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
  // Past the keeper deadline Sleeper's draft room is authoritative, and it
  // states each keeper's round outright — so there is nothing to resolve and
  // the whole collision/capacity path below is skipped. This is the single
  // chokepoint every tab reads keepers through, which is why switching it here
  // is enough to switch the board, the draft list and the mock draft together.
  if (keepersLockedInSleeper()) {
    return lockedKeeperCosts({
      locked: state.lockedKeepers?.[String(rosterId)] || [],
      prevDraftMap: state.prevDraftMap || {},
      playersMap: state.playersMap || {},
      adpMap: state.adpMap || {},
      ownerId: ownerIdOfRoster(rosterId),
      rosterId,
      lastRound: lastDraftRound(),
      teamCount: state.rosters.length || 10,
      inflationRounds: state.rules.inflationRounds,
      noKeeperCost: state.rules.noKeeperCost,
    });
  }
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
  // A position this league has no slot for can never be started, so it's out
  // of the pool for the AI and the manager alike. That isn't a strategy
  // heuristic (the manager's picker is never filtered by one) — it's a
  // statement of fact about the lineup, and it keeps the picker agreeing with
  // the Draft List. An unknown lineup filters nothing.
  const startable = startablePositions(state.league?.roster_positions);
  return Object.keys(playersMap).filter((pid) => {
    const p = playersMap[pid];
    if (!p.pos || p.pos === '—' || taken.has(pid)) return false;
    return !startable.length || startable.includes(p.pos);
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
  return mockDraftCaps(state.league?.roster_positions);
}

/**
 * How many QBs/TEs this league genuinely starts — the starter/bench line for
 * the mock draft's bench gate. Credits no FLEX slot; see
 * dedicatedStarterCounts for why.
 */
export function mockDraftDedicatedStarters(): Record<string, number> {
  return dedicatedStarterCounts(state.league?.roster_positions);
}

/**
 * How many picks this roster has left in the running mock draft, counting the
 * one about to be made. Read off the frozen slot list rather than derived from
 * the round number, so it stays right for a team whose trades left it holding
 * more or fewer picks than its neighbours.
 */
export function mockDraftRemainingPicksFor(rosterId: number): number {
  const md = state.mockDraft;
  if (!md) return 0;
  let remaining = 0;
  for (let i = 0; i < md.slots.length; i++) {
    if (md.slots[i].rosterId === rosterId && md.picks[i] === null) remaining += 1;
  }
  return remaining;
}

/**
 * Whether enough of the CURRENTLY loaded league's managers are known Mudd
 * league managers for its draft-tendency tables to plausibly be about THIS
 * league — the only thing standing between Mudd's hardcoded tendencies and
 * leaking into an unrelated league. There is no league-id check anywhere in
 * this codebase; see draftTendencies.ts's hasTendencyQuorum doc comment for
 * why keying on manager handles instead is the right call.
 *
 * Evaluated live rather than frozen at Start: a commissioner replacing a
 * manager mid-simulation (same roster_id, new owner_id) could in principle
 * flip this, but state.adpMap already changes future picks mid-simulation the
 * same way on its own refresh cycle, and this has never come up in practice.
 */
function tendencyQuorumMet(): boolean {
  return hasTendencyQuorum(
    state.rosters.map((r) => userForRoster(r.roster_id)?.display_name),
    MUDD_MANAGERS,
  );
}

/**
 * This round's positional lean for the mock draft's AI sampler: Mudd's
 * observed round-band weights under quorum, or flat (equal) weights for any
 * other league. Never null and never zero-weighted either way, so
 * samplePlayer always has something to work with — sampling itself (the fix
 * for every mock draft being byte-identical) applies to every league; only
 * the Mudd-specific DATA is gated.
 */
export function mockDraftRoundWeights(round: number): Record<string, number> {
  if (tendencyQuorumMet()) return positionWeightsForRound(MUDD_ROUND_BANDS, round);
  return { RB: 1, WR: 1, QB: 1, TE: 1 };
}

/**
 * A per-roster, per-position predicate for filterBenchQbTe's doubleUpAllowed
 * parameter: does THIS manager draft a second QB/TE more (or less) readily
 * than the league norm.
 *
 * Without quorum, always returns false — filterBenchQbTe's hard league-wide
 * gate, unchanged from before this existed. The per-manager profiles are
 * gated behind the SAME tendencyQuorumMet() as the round weights, not
 * evaluated independently — easy to miss because they feel individually
 * keyed on a display_name, but without the same gate a same-named manager in
 * an unrelated league would inherit a Mudd manager's tendency.
 *
 * One coin flip per (roster, position) per simulation, not per pick: "does
 * this manager double up" is a season-level trait, not a per-pick one — a
 * per-pick flip at the observed p=.6 would double up almost certainly across
 * a whole draft. Keying the roll on rosterId (never on the pick index) is
 * what keeps the realized frequency close to the modeled one, and keeps it
 * reload-safe the same way the pick sampler's per-pick roll is.
 */
export function mockDraftDoubleUpAllowedFor(rosterId: number): (position: string) => boolean {
  if (!tendencyQuorumMet() || !state.mockDraft) return () => false;
  const displayName = userForRoster(rosterId)?.display_name;
  const odds = qbTeDoubleUpOdds(MUDD_QBTE_PROFILES, displayName);
  if (!odds) return () => false;
  const seed = state.mockDraft.seed;
  return (position: string) => {
    if (!(position in odds)) return false;
    const key = position === 'QB' ? 0 : 1;
    return seededRoll(seed, ROLL_DOUBLE_UP, rosterId, key) < odds[position as 'QB' | 'TE'];
  };
}
