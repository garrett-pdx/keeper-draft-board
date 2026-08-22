import type { AdpMap } from '../types';
import { SLOT_ELIGIBILITY, startablePositions } from './leagueSettings';

// A mock draft runs at SEAT granularity: one entry per literal pick in the
// draft, ordered by the seat that pick belongs to, not by the roster holding
// it. That distinction only shows up around trades, and it is the whole point
// — a roster holding two picks in a round holds them at two different seats
// (its own and the one it bought), so they are separated by everyone drafting
// in between, exactly as the board already draws it ("+N incoming from
// {team}" sits in the *seller's* round cell).
//
// An earlier revision simulated at round×roster CELL granularity instead,
// giving such a roster its picks back-to-back as an explicit simplification.
// It was wrong in a way managers notice immediately: in a real draft you pick,
// four other teams pick, then you pick again, and practising against
// consecutive picks teaches the wrong thing about who will still be on the
// board. Don't reintroduce it.
export interface MockDraftSlot {
  round: number;
  rosterId: number;
}

/**
 * Flattens the whole draft into one ordered pick list, built once (at Start,
 * never recomputed per turn) so an in-progress simulation is immune to the
 * league's live data changing underneath it. `slotOrderRosterIds` is the
 * frozen seed order (the board's own column order — see src/mockDraft.ts's
 * frozenSlotOrder), snake-reversed on even rounds using the same odd/even
 * convention as exactPickNumber.
 *
 * Each roster id in that seed order is a SEAT, and a seat is really "this
 * roster's original pick in this round". `holderOfPick` says who actually
 * drafts it — the seat's own roster, or whoever bought that pick. So a
 * traded pick is simulated where the seller would have picked.
 *
 * `holderOfPick`/`keepersInCellFor` are injected closures rather than raw
 * TradedPicksList/KeeperCostItem[] — matching keeperCost.ts's
 * assignKeeperCosts, which takes a capacityFor callback rather than reaching
 * into tradedPicks.ts itself — so this stays a pure function of primitives.
 *
 * Keepers consume a holder's LATEST seats in the round, leaving its earlier
 * (more valuable) picks open — the same rule attachConsumedPicks applies when
 * it decides which literal pick a keeper spent, so the board and the
 * simulation can't disagree about which of two held picks is still live.
 * A holder is never assigned more keepers than it has seats (assignKeeperCosts
 * guarantees it), so no clamping is needed; a shortfall would be a real
 * upstream bug.
 */
export function buildMockDraftSlots(
  rounds: number,
  slotOrderRosterIds: number[],
  holderOfPick: (round: number, seatRosterId: number) => number,
  keepersInCellFor: (round: number, rosterId: number) => number,
): MockDraftSlot[] {
  const slots: MockDraftSlot[] = [];
  if (rounds <= 0 || !slotOrderRosterIds.length) return slots;
  const seatExists = new Set(slotOrderRosterIds);
  for (let round = 1; round <= rounds; round++) {
    const seats = round % 2 === 1 ? slotOrderRosterIds : slotOrderRosterIds.slice().reverse();
    // Resolve every seat's holder first, so "which of this holder's seats do
    // its keepers consume" can be answered against the whole round.
    const holders = seats.map((seat) => {
      const holder = holderOfPick(round, seat);
      // A trade pointing at a roster that no longer exists would otherwise
      // inject an un-draftable seat; fall back to the seat's own roster.
      return seatExists.has(holder) ? holder : seat;
    });
    const seenByHolder = new Map<number, number>();
    const totalByHolder = new Map<number, number>();
    for (const holder of holders) {
      totalByHolder.set(holder, (totalByHolder.get(holder) || 0) + 1);
    }
    holders.forEach((holder) => {
      const index = seenByHolder.get(holder) || 0;
      seenByHolder.set(holder, index + 1);
      const open = (totalByHolder.get(holder) as number) - keepersInCellFor(round, holder);
      if (index < open) slots.push({ round, rosterId: holder });
    });
  }
  return slots;
}

/**
 * Best-player-available by ascending ADP/value rank, nothing else. Missing-ADP
 * players use the same 9999 sentinel src/ui/draft.ts's own sort already uses,
 * so they're deprioritized rather than excluded.
 *
 * Every bit of roster-shape realism lives in the filters below, which narrow
 * the pool before this runs — deliberately, so "who is best" and "who is this
 * team allowed to take" stay separate questions. An earlier revision let a
 * caller bias the ranking with a soft price penalty; it was removed once the
 * pool filters covered the same ground, since two mechanisms aiming at the
 * same behavior is exactly the double-work this AI keeps accumulating.
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

/** The positions treated as having a fixed number of starts — see dedicatedStarterCounts. */
const DEDICATED_STARTER_POSITIONS = ['QB', 'TE'] as const;

/**
 * Which roster_positions slots count as a *dedicated* start for QB/TE.
 *
 * Deliberately NOT the same eligibility SLOT_ELIGIBILITY uses: a generic FLEX
 * is a TE-eligible slot on paper, but in practice it goes to an RB or WR, so
 * counting it would make a 2nd TE look like a starter and exempt exactly the
 * pick the bench gate exists to hold back. SUPER_FLEX is the opposite case —
 * it is a real QB start, so it counts.
 */
const DEDICATED_SLOT_ELIGIBILITY: Record<string, readonly string[]> = {
  QB: ['QB'],
  SUPER_FLEX: ['QB'],
  TE: ['TE'],
};

/**
 * How many QBs/TEs this league genuinely starts — the line between a starter
 * and a bench player at those two positions.
 *
 * Unknown `roster_positions` returns `{}`, which makes the gate below a no-op
 * rather than a guess, the same graceful-degradation convention as
 * positionCaps. A league with no dedicated slot for a position reports 0,
 * which is meaningful rather than missing: if nothing starts a TE, every TE
 * really is competing for a FLEX spot against RB/WR.
 */
export function dedicatedStarterCounts(
  rosterPositions: string[] | null | undefined,
): Record<string, number> {
  if (!rosterPositions || !rosterPositions.length) return {};
  const counts: Record<string, number> = {};
  for (const pos of DEDICATED_STARTER_POSITIONS) counts[pos] = 0;
  for (const slot of rosterPositions) {
    for (const pos of DEDICATED_SLOT_ELIGIBILITY[slot] ?? []) counts[pos] += 1;
  }
  return counts;
}

/** Slots nobody drafts for until the very end, handled by filterByEndgameSlots instead. */
const ENDGAME_POSITIONS = ['DEF', 'K'] as const;

/** Slots that hold no starter at all and so never need filling. */
const NON_STARTING_SLOTS = new Set(['BN', 'IR', 'TAXI']);

/**
 * The starting slots a team is expected to fill before it starts adding bench
 * QBs/TEs — i.e. the lineup minus DEF/K (deliberately excluded; those are
 * drafted last, see filterByEndgameSlots) and minus bench/IR slots.
 *
 * Returned in fill order: dedicated slots first, then FLEX-type slots
 * most-restrictive-first, which is what makes the greedy assignment in
 * unfilledStartingSlots correct without a real bipartite matching.
 */
function startingSlotsToFill(rosterPositions: string[] | null | undefined): string[] {
  if (!rosterPositions || !rosterPositions.length) return [];
  const slots = rosterPositions.filter(
    (slot) =>
      !NON_STARTING_SLOTS.has(slot) &&
      !(ENDGAME_POSITIONS as readonly string[]).includes(slot) &&
      SLOT_ELIGIBILITY[slot],
  );
  // Fewer eligible positions = harder to fill = must claim its player first.
  return slots.sort((a, b) => SLOT_ELIGIBILITY[a].length - SLOT_ELIGIBILITY[b].length);
}

/**
 * How many of this league's starting slots the roster still can't field.
 *
 * **Uses SLOT_ELIGIBILITY, where a generic FLEX *is* TE-eligible**, unlike
 * dedicatedStarterCounts above. That is not an inconsistency: this function
 * asks the factual question "could this roster put a legal lineup on the
 * field", where a TE genuinely may start at FLEX. dedicatedStarterCounts
 * answers a different, judgement-laden question — "is this particular pick a
 * backup" — where the realistic answer is that a FLEX goes to an RB or WR.
 * Keep the two apart.
 *
 * Unknown `roster_positions` yields 0 (nothing left to fill), so every caller
 * degrades to no restriction.
 */
export function unfilledStartingSlots(
  rosterPositions: string[] | null | undefined,
  positionCounts: Record<string, number>,
): number {
  const remaining: Record<string, number> = { ...positionCounts };
  let unfilled = 0;
  for (const slot of startingSlotsToFill(rosterPositions)) {
    const filler = SLOT_ELIGIBILITY[slot].find((pos) => (remaining[pos] || 0) > 0);
    if (filler) remaining[filler] -= 1;
    else unfilled += 1;
  }
  return unfilled;
}

/**
 * Holds back a *bench* QB or TE until every starting slot (DEF/K aside) is
 * filled — the one rule that replaced both a list of bench-depth
 * prerequisites and a soft price penalty, which between them were two
 * mechanisms chasing the same behavior.
 *
 * "Bench" means beyond `dedicatedStarters`, so a team's first QB and first TE
 * are always draftable, and a 2QB league's second QB still counts as a
 * starter. RB/WR are deliberately never gated: while starting slots remain,
 * an extra RB/WR is filling a FLEX, and once they're full this rule is a
 * no-op anyway.
 *
 * Callers must fall back to the unfiltered list when this returns empty, the
 * same never-get-stuck convention as filterByPositionCaps.
 *
 * `doubleUpAllowed` is a per-manager escape hatch: some managers genuinely
 * draft a second QB or TE more (or less) readily than the league norm this
 * gate otherwise enforces uniformly. It defaults to "nobody does", which
 * reproduces the old hard league-wide gate exactly — a parameter rather than
 * a second function, since a parallel filterBenchQbTeProbabilistic would be
 * exactly the two-mechanisms-chasing-one-behavior pattern this AI has already
 * been reworked once to remove. The exemption only lifts the gate; it never
 * bypasses mockDraftCaps, which is what actually bounds how many a roster can
 * draft.
 */
export function filterBenchQbTe(
  availablePlayerIds: string[],
  positionOf: (playerId: string) => string | undefined,
  positionCounts: Record<string, number>,
  rosterPositions: string[] | null | undefined,
  dedicatedStarters: Record<string, number>,
  doubleUpAllowed: (position: string) => boolean = () => false,
): string[] {
  if (unfilledStartingSlots(rosterPositions, positionCounts) === 0) return availablePlayerIds;
  return availablePlayerIds.filter((pid) => {
    const pos = positionOf(pid);
    if (!pos || !(pos in dedicatedStarters)) return true;
    return (positionCounts[pos] || 0) < dedicatedStarters[pos] || doubleUpAllowed(pos);
  });
}

/**
 * Positions that would actually fill one of this roster's open starting slots.
 *
 * Derived by probing — add one of each position and see whether
 * unfilledStartingSlots drops — rather than reimplementing the slot-matching
 * logic. It costs a handful of tiny passes and makes it impossible for the two
 * to drift apart, which is the property that matters.
 */
function positionsThatFillASlot(
  rosterPositions: string[] | null | undefined,
  positionCounts: Record<string, number>,
): Set<string> {
  const out = new Set<string>();
  const before = unfilledStartingSlots(rosterPositions, positionCounts);
  if (before === 0) return out;
  for (const pos of startablePositions(rosterPositions)) {
    if ((ENDGAME_POSITIONS as readonly string[]).includes(pos)) continue;
    const probe = { ...positionCounts, [pos]: (positionCounts[pos] || 0) + 1 };
    if (unfilledStartingSlots(rosterPositions, probe) < before) out.add(pos);
  }
  return out;
}

/**
 * Reserves a roster's last picks for what it still has to have, in two tiers.
 *
 * The outer tier is the DEF/K rule: a defense or kicker taken in the middle
 * rounds is a wasted pick (the position is near-interchangeable and its pool
 * barely thins), so they're held out until they are all that's left to take.
 *
 * The inner tier is the starter safety net. The bench-QB/TE gate holds back a
 * team's *second* QB/TE but nothing compels the first, so a team that keeps
 * winning best-available on RB/WR could finish with no tight end at all —
 * measured, one team in ten did exactly that. Once a team's remaining picks
 * are down to what it needs to complete its lineup, it may only take players
 * who fill a still-open slot. Middle rounds are untouched, which is the whole
 * point: bench RB/WR stay unrestricted right up until the roster genuinely
 * can't afford them.
 *
 * DEF/K is checked first so "defense and kicker go last" survives even when a
 * team is short a starter at the same time.
 *
 * `remainingPicks` counts this roster's own remaining slots including the one
 * being made now, so it stays correct in a draft where trades gave a team more
 * or fewer picks than its neighbours. Unknown `roster_positions` returns the
 * list untouched.
 */
export function filterByRemainingNeeds(
  availablePlayerIds: string[],
  positionOf: (playerId: string) => string | undefined,
  positionCounts: Record<string, number>,
  rosterPositions: string[] | null | undefined,
  remainingPicks: number,
): string[] {
  if (!rosterPositions || !rosterPositions.length) return availablePlayerIds;
  const isEndgamePos = (pid: string) =>
    (ENDGAME_POSITIONS as readonly string[]).includes(positionOf(pid) || '');

  const stillNeeded: Record<string, number> = {};
  let defKNeeded = 0;
  for (const pos of ENDGAME_POSITIONS) {
    const slots = rosterPositions.filter((slot) => slot === pos).length;
    const need = Math.max(0, slots - (positionCounts[pos] || 0));
    stillNeeded[pos] = need;
    defKNeeded += need;
  }

  // Out of room for anything but the defense/kicker still owed.
  if (defKNeeded > 0 && remainingPicks <= defKNeeded) {
    return availablePlayerIds.filter((pid) => (stillNeeded[positionOf(pid) || ''] || 0) > 0);
  }

  // Everything from here on excludes DEF/K — they have their own reserved picks.
  const withoutEndgame = availablePlayerIds.filter((pid) => !isEndgamePos(pid));

  const unfilled = unfilledStartingSlots(rosterPositions, positionCounts);
  if (unfilled > 0 && remainingPicks - defKNeeded <= unfilled) {
    const fillers = positionsThatFillASlot(rosterPositions, positionCounts);
    return withoutEndgame.filter((pid) => fillers.has(positionOf(pid) || ''));
  }
  return withoutEndgame;
}

/**
 * The caps the mock draft actually runs on: `positionCaps`, with QB and TE
 * overridden to twice what the league genuinely starts there.
 *
 * `positionCaps` credits every FLEX slot to TE, which is right for "could a TE
 * start here" but far too loose as a draft limit — it puts the TE cap at 6 in
 * a 1-TE/3-FLEX league, enough for a team to finish with five backups. Twice
 * the dedicated starts (2 in that league, 4 QBs in a 2QB league) matches how
 * deep a real roster goes at a position it can only start a fixed number of.
 * This isn't a guess: across 30 real manager-seasons of Mudd league draft
 * history (see draftTendencies.ts), no manager has ever drafted a THIRD QB or
 * TE in one draft — every observed count is 0, 1, or 2. `2 x dedicated` is the
 * empirically observed ceiling, not just a plausible one.
 *
 * Applied only where the league has a dedicated slot: with none, a TE is a
 * pure FLEX asset like any RB/WR and keeps the normal cap, since `2 × 0` would
 * make the position undraftable.
 */
export function mockDraftCaps(
  rosterPositions: string[] | null | undefined,
): Record<string, number> {
  const caps = positionCaps(rosterPositions);
  const dedicated = dedicatedStarterCounts(rosterPositions);
  for (const pos of DEDICATED_STARTER_POSITIONS) {
    if ((dedicated[pos] || 0) > 0) caps[pos] = 2 * dedicated[pos];
  }
  return caps;
}
