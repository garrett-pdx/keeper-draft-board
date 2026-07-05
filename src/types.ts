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
  base: number; // cost before same-round collision bump
  cost: number; // resolved cost round
  bumped: boolean; // true if bumped by a same-round collision
  hasData: boolean; // had real prior-season draft data
  value: number;
  hasAdp: boolean;
}

// --- Loosely-typed Sleeper payloads (tightened later) ---
export interface SleeperUser {
  user_id: string;
  display_name?: string;
  avatar?: string | null;
  metadata?: { team_name?: string } | null;
}
export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players?: string[] | null;
}
export interface SleeperLeague {
  league_id: string;
  name?: string;
  season?: string;
  draft_id?: string | null;
  previous_league_id?: string | null;
  roster_positions?: string[];
}
