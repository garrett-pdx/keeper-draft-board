// Shared data shapes. Sleeper API responses are typed loosely here (Phase 1);
// they get tightened with real schemas at the fetch boundary in a later phase.

export interface SlimPlayer {
  id: string;
  first: string;
  last: string;
  pos: string;
  team: string;
  rank: number;
  birthDate: string | null;
  espnId: number | null;
}
export type PlayersMap = Record<string, SlimPlayer>;

/** player_id -> ADP pick number (or a rank proxy when ADP is unavailable). */
export type AdpMap = Record<string, number>;
// Where the market price shown in the UI actually came from. 'adp' is real
// average draft position from Fantasy Football Calculator's mock drafts,
// 'adp-real' is average draft position from real (non-mock) redraft leagues on
// MyFantasyLeague, 'value' is a trade-value ranking used as an implied pick
// (FantasyCalc), 'rank' is the last-resort Sleeper search_rank proxy. The UI
// must distinguish these — presenting a value rank as "ADP" would misdescribe
// the data, and so would presenting mock-draft ADP as real-league ADP.
// 'blend' is the mean of whichever of the three priced a given player.
export type AdpSource = 'adp' | 'adp-real' | 'value' | 'blend' | 'rank' | null;

/** Which market-price source a league prefers. */
export type MarketSource = 'value' | 'adp' | 'adp-real' | 'blend';

/**
 * player_id -> the earliest/latest pick this player was actually taken across
 * the real drafts behind their matched ADP entry — display only, never fed
 * into the value metric. Absent for a player matched via the rank-proxy
 * fallback (no real ADP entry to pull a range from).
 */
export type AdpRangeMap = Record<string, { high: number | null; low: number | null }>;

/** espn_id (as a string key) -> season outlook paragraph. See domain/outlook.ts. */
export type OutlookMap = Record<string, string>;

/** One player's prior-season draft record, used to derive keeper cost. */
export interface PrevDraftEntry {
  round: number;
  rosterId: number; // raw prev-season roster_id (fallback matching only)
  ownerId: string | null; // stable manager user_id (preferred matching)
  wasKeeper: boolean;
}
export type PrevDraftMap = Record<string, PrevDraftEntry>;

export interface SurplusValue {
  value: number;
  hasAdp: boolean;
}

/** A resolved keeper cost for one selected player, after collision handling. */
export interface KeeperCostItem {
  playerId: string;
  base: number; // cost before same-round collision/capacity resolution
  cost: number; // resolved cost round; not meaningful for display when cannotBeKept or taxiSquad is true
  bumped: boolean; // true if displaced to a more expensive round by collision/capacity
  cannotBeKept: boolean; // no available pick at this round or any cheaper-round alternative
  hasData: boolean; // had real prior-season draft data
  value: number;
  hasAdp: boolean;
  consumedPick: number | null; // exact pick number spent, when disambiguating multiple held picks
  taxiSquad: boolean; // true when rules.noKeeperCost is on — kept for free, no round/pick spent
  // True when this keeper came from Sleeper's own locked draft-room keepers
  // rather than an in-app selection — see domain/lockedKeepers.ts. Then `cost`
  // is Sleeper's stated round, not something this app resolved.
  fromSleeper: boolean;
  // What this app's rules WOULD have charged, set only when that disagrees with
  // the locked round. Sleeper wins either way; this exists so the disagreement
  // is surfaced instead of silently discarded.
  expectedCost: number | null;
}

/** Per-league configurable rules. Persisted per-league; see state.ts LS_RULES_PREFIX. */
export interface LeagueRules {
  maxKeepers: number; // default 2, UI-capped 1-4
  // Defaults to FantasyCalc's value ranking: it's steadier than crowd ADP,
  // which can run hard on a week of news (see CLAUDE.md's "Market value
  // sources"). Switchable per league.
  marketSource: MarketSource;
  inflationRounds: number; // default 1 — round bump for a same-manager repeat keep
  noKeeperCost: boolean; // default false — "taxi squad" mode: keepers cost no draft pick at all
}
// The Mudd Keeper League's actual rules, and this app's original calibration —
// used both as the initial state and as the Settings tab's explicit reset target.
export const DEFAULT_LEAGUE_RULES: LeagueRules = {
  maxKeepers: 2,
  marketSource: 'value',
  inflationRounds: 1,
  noKeeperCost: false,
};

// Sleeper payload types are inferred from the zod schemas that validate them at
// the fetch boundary, so the runtime check and the compile-time type can't drift.
export type { SleeperLeague, SleeperRoster, SleeperUser } from './api/schemas';
