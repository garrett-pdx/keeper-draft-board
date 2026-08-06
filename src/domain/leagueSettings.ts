// Reading a Sleeper league's own configuration and turning it into this app's
// settings. Pure and state-free like the rest of src/domain.
//
// Deliberately conservative: only rules Sleeper actually models are derived
// here. Guessing at the ones it doesn't (see suggestedRulesFromLeague) would
// silently put words in the commissioner's mouth about how keepers are priced,
// which is worse than asking.
import { DEFAULT_LEAGUE_RULES, type LeagueRules } from '../types';

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
