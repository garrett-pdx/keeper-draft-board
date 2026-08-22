// Reading a Sleeper league's own configuration and turning it into this app's
// settings. Pure and state-free like the rest of src/domain.
//
// Deliberately conservative: only rules Sleeper actually models are derived
// here. Guessing at the ones it doesn't (see suggestedRulesFromLeague) would
// silently put words in the commissioner's mouth about how keepers are priced,
// which is worse than asking.
import { DEFAULT_LEAGUE_RULES, type LeagueRules } from '../types';

/**
 * Which fantasy positions each Sleeper `roster_positions` slot can start.
 *
 * Lives here rather than beside its first consumer (the mock draft's position
 * caps) because it is a fact about how a Sleeper league is configured, not
 * about drafting — the Draft List's position filter reads it too, and having
 * that tab import from `domain/mockDraft.ts` would misdescribe both.
 *
 * Note the single-position slots map to a one-entry list rather than a bare
 * string. That's what lets a caller treat `QB` and `FLEX` identically: one
 * lookup answers "can this slot start this position" for exact slots and flex
 * slots alike, which is exactly what the position filters do.
 *
 * Slots absent from this map (`BN`, `IR`, IDP slots) start none of the
 * positions this app models and are simply skipped by every consumer.
 */
export const SLOT_ELIGIBILITY: Record<string, readonly string[]> = {
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
 * Every position some slot in this lineup can actually start.
 *
 * Used to keep players nobody could ever start — kickers in a league with no
 * `K` slot, most commonly — off the Draft List and out of the mock draft pool.
 * Returns `[]` for an unknown lineup, which callers read as "filter nothing"
 * rather than "show nothing", the same graceful degradation the rest of the
 * domain layer uses.
 */
export function startablePositions(rosterPositions: string[] | null | undefined): string[] {
  if (!rosterPositions || !rosterPositions.length) return [];
  const out = new Set<string>();
  for (const slot of rosterPositions) {
    for (const pos of SLOT_ELIGIBILITY[slot] ?? []) out.add(pos);
  }
  return [...out];
}

/**
 * The league's own distinct starting slots, in lineup order — the option list
 * for a position filter.
 *
 * Deduping `roster_positions` rather than listing positions is what gives the
 * filter a FLEX entry for free: the slot name *is* the filter value, and
 * SLOT_ELIGIBILITY turns it back into the set of positions to match. A
 * conventional 1QB/1TE/3FLEX/DEF lineup yields `QB, RB, WR, TE, FLEX, DEF` —
 * natural order, a FLEX option, and no `K`, with no special-casing anywhere.
 * (Mudd itself starts neither DEF nor K, so its own filter list is even
 * shorter — see src/domain/draftTendencies.ts.)
 *
 * `[]` for an unknown lineup, so the UI can keep its default option list.
 */
export function positionFilterSlots(rosterPositions: string[] | null | undefined): string[] {
  if (!rosterPositions || !rosterPositions.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slot of rosterPositions) {
    if (!SLOT_ELIGIBILITY[slot] || seen.has(slot)) continue;
    seen.add(slot);
    out.push(slot);
  }
  return out;
}

/** Does `slot` (a filter value) start `pos`? An empty slot means "all positions". */
export function slotStartsPosition(pos: string, slot: string): boolean {
  if (!slot) return true;
  return (SLOT_ELIGIBILITY[slot] ?? []).includes(pos);
}

/**
 * Does this league start more than one quarterback?
 *
 * Two shapes mean the same thing on Sleeper and both must be handled: an
 * explicit `SUPER_FLEX` slot, or a plain 2QB lineup listing `QB` twice
 * (confirmed live — one of this user's own leagues starts `QB,QB,...` with no
 * SUPER_FLEX slot anywhere, so checking only for SUPER_FLEX would miss it).
 * Either way QBs are scarce and priced completely differently.
 */
export function isSuperflexLeague(rosterPositions: string[] | null | undefined): boolean {
  if (!rosterPositions || !rosterPositions.length) return false;
  if (rosterPositions.includes('SUPER_FLEX')) return true;
  return rosterPositions.filter((slot) => slot === 'QB').length >= 2;
}

/** Sleeper's own keeper allowance, clamped to what this app's UI supports. */
export function maxKeepersFromLeague(maxKeepers: number | null | undefined): number | null {
  if (typeof maxKeepers !== 'number' || !Number.isFinite(maxKeepers)) return null;
  const rounded = Math.round(maxKeepers);
  if (rounded < 1) return null; // 0 means "keepers off" — not a cap this app can express
  return Math.min(4, rounded);
}

export interface LeagueLike {
  settings?: { max_keepers?: number | null } | null;
}

/**
 * The subset of league rules Sleeper can actually tell us.
 *
 * `max_keepers` is the only one with a real equivalent. `inflationRounds` is
 * this league's own house rule with no Sleeper field at all, and `noKeeperCost`
 * must NOT be inferred from `settings.taxi_slots` — Sleeper's taxi squad is a
 * dynasty rookie-stash concept, unrelated to our "keepers cost no pick" rule
 * despite the shared nickname. Both stay manual.
 */
export function suggestedRulesFromLeague(league: LeagueLike | null): Partial<LeagueRules> {
  const max = maxKeepersFromLeague(league?.settings?.max_keepers);
  return max === null ? {} : { maxKeepers: max };
}

/** Full rules for a league seen for the first time: defaults + what Sleeper knows. */
export function initialRulesForLeague(league: LeagueLike | null): LeagueRules {
  return { ...DEFAULT_LEAGUE_RULES, ...suggestedRulesFromLeague(league) };
}
