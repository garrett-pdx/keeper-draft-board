import type { SleeperDraft } from './api/schemas';
import type { TradedPicksList } from './domain/tradedPicks';
import type {
  AdpMap,
  AdpSource,
  LeagueRules,
  PlayersMap,
  PrevDraftMap,
  SleeperLeague,
  SleeperRoster,
  SleeperUser,
} from './types';
import { DEFAULT_LEAGUE_RULES } from './types';
import { displayNameFor } from './util';

// ---- localStorage keys ----
export const LS_LEAGUE_ID = 'kdb_league_id';
export const LS_SEASON = 'kdb_season';
export const LS_USERNAME = 'kdb_username';
export const LS_KEEPERS_PREFIX = 'kdb_keepers_';
export const LS_BOARD_ORDER_PREFIX = 'kdb_board_order_';
export const LS_RULES_PREFIX = 'kdb_rules_';
export const LS_PLAYERS_CACHE = 'kdb_players_cache_v1';
export const LS_ADP_CACHE_PREFIX = 'kdb_adp_cache_v1_';
export const PLAYERS_MAX_AGE_MS = 20 * 60 * 60 * 1000; // ~20h, Sleeper says at most once/day

export const POSITION_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };

interface AppState {
  leagueId: string | null;
  season: string | null;
  league: SleeperLeague | null;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  playersMap: PlayersMap | null;
  adpMap: AdpMap | null;
  adpSource: AdpSource;
  keepers: Record<string, string[]>;
  prevDraftMap: PrevDraftMap | null;
  prevDraftLoaded: boolean;
  boardRounds: number | null;
  boardOrder: string[] | null;
  rules: LeagueRules;
  draft: SleeperDraft | null;
  tradedPicks: TradedPicksList | null;
  rostersLoadedAt: Date | null;
  draftLoadedAt: Date | null;
  boardLoadedAt: Date | null;
}

// The single source of truth. No other module-level mutable globals.
export const state: AppState = {
  leagueId: null,
  season: null,
  league: null,
  users: [],
  rosters: [],
  playersMap: null,
  adpMap: null,
  adpSource: null,
  keepers: {},
  prevDraftMap: null,
  prevDraftLoaded: false,
  boardRounds: null,
  boardOrder: null,
  rules: { ...DEFAULT_LEAGUE_RULES },
  draft: null,
  tradedPicks: null,
  rostersLoadedAt: null,
  draftLoadedAt: null,
  boardLoadedAt: null,
};

// ---------- keepers persistence ----------
function keepersKey(): string {
  return LS_KEEPERS_PREFIX + state.leagueId;
}
export function loadKeepersFromStorage(): void {
  try {
    const raw = localStorage.getItem(keepersKey());
    state.keepers = raw ? JSON.parse(raw) : {};
  } catch {
    state.keepers = {};
  }
}
function saveKeepers(): void {
  localStorage.setItem(keepersKey(), JSON.stringify(state.keepers));
}
export function keeperListFor(rosterId: number): string[] {
  return state.keepers[rosterId] || [];
}
export function isKeeper(rosterId: number, playerId: string): boolean {
  return keeperListFor(rosterId).includes(playerId);
}
export function toggleKeeper(rosterId: number, playerId: string): boolean {
  const list = keeperListFor(rosterId).slice();
  const idx = list.indexOf(playerId);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    if (list.length >= state.rules.maxKeepers) return false;
    list.push(playerId);
  }
  state.keepers[rosterId] = list;
  saveKeepers();
  return true;
}
export function allKeeperIdsWithTeam(): Map<string, string> {
  const map = new Map<string, string>();
  for (const roster of state.rosters) {
    const list = keeperListFor(roster.roster_id);
    const teamName = teamNameForRoster(roster.roster_id);
    list.forEach((pid) => map.set(pid, teamName));
  }
  return map;
}

// ---------- board column order persistence ----------
function boardOrderKey(): string {
  return LS_BOARD_ORDER_PREFIX + state.leagueId;
}
export function saveBoardOrder(): void {
  localStorage.setItem(boardOrderKey(), JSON.stringify(state.boardOrder));
}
export function ensureBoardOrder(): void {
  const currentIds = state.rosters.map((r) => String(r.roster_id));
  let order: unknown = null;
  try {
    order = JSON.parse(localStorage.getItem(boardOrderKey()) || 'null');
  } catch {
    order = null;
  }
  if (!Array.isArray(order)) order = [];
  // keep any known ids in their saved order, then append new ones, drop stale ones
  const saved = order as string[];
  const kept = saved.filter((id) => currentIds.includes(id));
  const missing = currentIds.filter((id) => !kept.includes(id));
  state.boardOrder = kept.concat(missing);
  saveBoardOrder();
}

// Current roster's owner user_id, for cross-season "same team" keeper matching.
export function ownerIdOfRoster(rosterId: number): string | null {
  const r = state.rosters.find((x) => x.roster_id === rosterId);
  return r ? r.owner_id : null;
}

// The Sleeper user who owns a roster, or null (unclaimed team / unknown roster).
export function userForRoster(rosterId: number): SleeperUser | null {
  const ownerId = ownerIdOfRoster(rosterId);
  return (ownerId && state.users.find((u) => u.user_id === ownerId)) || null;
}

export function teamNameForRoster(rosterId: number): string {
  return displayNameFor(userForRoster(rosterId));
}

// ---------- league rules persistence ----------
function rulesKey(): string {
  return LS_RULES_PREFIX + state.leagueId;
}
export function loadRulesFromStorage(): void {
  try {
    const raw = localStorage.getItem(rulesKey());
    state.rules = raw
      ? { ...DEFAULT_LEAGUE_RULES, ...JSON.parse(raw) }
      : { ...DEFAULT_LEAGUE_RULES };
  } catch {
    state.rules = { ...DEFAULT_LEAGUE_RULES };
  }
}
export function saveRules(): void {
  localStorage.setItem(rulesKey(), JSON.stringify(state.rules));
}
export function updateRules(patch: Partial<LeagueRules>): void {
  state.rules = { ...state.rules, ...patch };
  saveRules();
}
