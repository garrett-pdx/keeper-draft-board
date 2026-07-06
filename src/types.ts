// Shared data shapes. Sleeper API responses are typed loosely here (Phase 1);
// they get tightened with real schemas at the fetch boundary in a later phase.

export interface SlimPlayer {
  id: string;
  first: string;
  last: string;
  pos: string;
  team: string;
  rank: number;
}
export type PlayersMap = Record<string, SlimPlayer>;

/** player_id -> ADP pick number (or a rank proxy when ADP is unavailable). */
export type AdpMap = Record<string, number>;
export type AdpSource = 'adp' | 'rank' | null;

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
  cost: number; // resolved cost round; not meaningful for display when cannotBeKept is true
  bumped: boolean; // true if displaced to a more expensive round by collision/capacity
  cannotBeKept: boolean; // no available pick at this round or any cheaper-round alternative
  hasData: boolean; // had real prior-season draft data
  value: number;
  hasAdp: boolean;
  consumedPick: number | null; // exact pick number spent, when disambiguating multiple held picks
}

/** Per-league configurable rules. Persisted per-league; see state.ts LS_RULES_PREFIX. */
export interface LeagueRules {
  maxKeepers: number; // default 2, UI-capped 1-4
  inflationRounds: number; // default 1 — round bump for a same-manager repeat keep
}
// The Mudd Keeper League's actual rules, and this app's original calibration —
// used both as the initial state and as the Settings tab's explicit reset target.
export const DEFAULT_LEAGUE_RULES: LeagueRules = { maxKeepers: 2, inflationRounds: 1 };

// Sleeper payload types are inferred from the zod schemas that validate them at
// the fetch boundary, so the runtime check and the compile-time type can't drift.
export type { SleeperLeague, SleeperRoster, SleeperUser } from './api/schemas';
