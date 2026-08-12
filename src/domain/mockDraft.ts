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

/** The positions this heuristic ever caps. Anything else (IDP slots, etc.) is left uncapped. */
const CAPPED_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

/** Which capped positions a given Sleeper roster_positions slot can start. */
const SLOT_ELIGIBILITY: Record<string, readonly string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
};

/**
 * How many players of each position an AI team should ever draft: every
 * starting slot that position is eligible for (exact slots plus whichever
 * FLEX-type slots include it) plus a small bench buffer. Positions with no
 * FLEX home (QB in a 1QB league, TE) end up with a tight cap; RB/WR pick up
 * extra headroom from FLEX/SUPER_FLEX/WRRB_FLEX/REC_FLEX slots, exactly
 * mirroring the structural asymmetry a real draft has to respect. Unknown
 * roster_positions entries (IDP slots, BN, IR) grant no eligibility and are
 * otherwise ignored.
 *
 * With no roster_positions known at all, returns `{}` (no caps) rather than
 * guessing — degrades to the old uncapped BPA behavior instead of silently
 * producing a wrong number, same convention as the rest of this codebase's
 * "must always degrade gracefully" fallbacks.
 */
export function positionCaps(
  rosterPositions: string[] | null | undefined,
  benchBuffer = 2,
): Record<string, number> {
  if (!rosterPositions || !rosterPositions.length) return {};
  const caps: Record<string, number> = {};
  for (const pos of CAPPED_POSITIONS) caps[pos] = benchBuffer;
  for (const slot of rosterPositions) {
    const eligible = SLOT_ELIGIBILITY[slot];
    if (!eligible) continue;
    for (const pos of eligible) caps[pos] += 1;
  }
  return caps;
}

/**
 * Drops players whose position has already reached its cap for this roster —
 * the AI-only heuristic that keeps opponents from hoarding a 6th QB or 3rd TE
 * the way plain best-player-available otherwise would. A position absent from
 * `caps` (or a player with no known position) is never restricted. Callers
 * must fall back to the unfiltered list when this returns empty — every
 * remaining player being at an over-drafted position is a real possibility
 * late in a draft, and picking nothing is worse than picking off-cap.
 */
export function filterByPositionCaps(
  availablePlayerIds: string[],
  positionOf: (playerId: string) => string | undefined,
  positionCounts: Record<string, number>,
  caps: Record<string, number>,
): string[] {
  return availablePlayerIds.filter((pid) => {
    const pos = positionOf(pid);
    if (!pos || !(pos in caps)) return true;
    return (positionCounts[pos] || 0) < caps[pos];
  });
}

interface StarterPrerequisite {
  /** The position this rule can block. */
  position: string;
  /** Triggers on the pick that would be this position's Nth *bench* player (beyond its own starting-slot count). */
  benchDepth: number;
  /** Only allowed once this other position has filled all of ITS starting slots. */
  requires: string;
}

/**
 * "Fill your starters before your backups" — real drafters get their
 * starting QB and TE seated before piling up bench depth elsewhere, and
 * don't stack a bench QB/TE ahead of their starting TE/QB. Expressed
 * relative to each league's own starting-slot counts (via `startingSlots`,
 * see `positionCaps`'s 0-buffer case below) rather than fixed numbers, so
 * the same four rules read correctly whether a league starts 1 QB or 2:
 * a team's starting QB(s) come before their 2nd bench RB/WR, their starting
 * TE before their 3rd bench RB/WR, their starting QB(s) before their 1st
 * bench TE, and their starting TE before their 1st bench QB. A fixed,
 * explicit rule set rather than a general roster-construction model,
 * matching the "rudimentary AI" scope everywhere else in this file.
 */
const STARTER_PREREQUISITES: StarterPrerequisite[] = [
  { position: 'WR', benchDepth: 2, requires: 'QB' },
  { position: 'RB', benchDepth: 2, requires: 'QB' },
  { position: 'WR', benchDepth: 3, requires: 'TE' },
  { position: 'RB', benchDepth: 3, requires: 'TE' },
  { position: 'TE', benchDepth: 1, requires: 'QB' },
  { position: 'QB', benchDepth: 1, requires: 'TE' },
];

/**
 * Drops players who'd violate a starter prerequisite for this roster right
 * now — e.g. a 2nd bench WR before the team's starting QB(s) are filled, or
 * a 1st bench TE before its starting QB(s). Players with no known position
 * are never restricted. `startingSlots` should be `positionCaps(rosterPositions, 0)`
 * — the same starting-slot-plus-FLEX-eligibility count `filterByPositionCaps`
 * uses, just without its bench buffer — so both heuristics agree on what
 * "starting" means for this league; an empty `startingSlots` (unknown
 * roster_positions) makes every rule's `requires` trivially satisfied,
 * degrading to no restriction, same convention as the cap. Like
 * filterByPositionCaps, callers must fall back to the unfiltered list when
 * this returns empty: satisfying every prerequisite simultaneously can
 * become impossible late in a draft, and picking nothing is worse than
 * picking out of sequence.
 */
export function filterByStarterPriority(
  availablePlayerIds: string[],
  positionOf: (playerId: string) => string | undefined,
  positionCounts: Record<string, number>,
  startingSlots: Record<string, number>,
): string[] {
  return availablePlayerIds.filter((pid) => {
    const pos = positionOf(pid);
    if (!pos) return true;
    const nextCount = (positionCounts[pos] || 0) + 1;
    return STARTER_PREREQUISITES.every((rule) => {
      if (pos !== rule.position) return true;
      const threshold = (startingSlots[pos] || 0) + rule.benchDepth;
      if (nextCount < threshold) return true;
      return (positionCounts[rule.requires] || 0) >= (startingSlots[rule.requires] || 0);
    });
  });
}
