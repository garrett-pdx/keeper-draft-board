import type { SharedKeepers, SharedKeeperTeam, SleeperDraft } from './api/schemas';
import type { TradedPicksList } from './domain/tradedPicks';
import type {
  AdpMap,
  AdpRangeMap,
  AdpSource,
  LeagueRules,
  OutlookMap,
  PlayersMap,
  PrevDraftMap,
  SleeperLeague,
  SleeperRoster,
  SleeperUser,
} from './types';
import { canReadShared } from './api/gist';
import { lockedTeamsFor } from './domain/keeperShare';
import { DEFAULT_LEAGUE_RULES } from './types';
import { displayNameFor } from './util';

// ---- localStorage keys ----
export const LS_LEAGUE_ID = 'kdb_league_id';
export const LS_SEASON = 'kdb_season';
export const LS_USERNAME = 'kdb_username';
export const LS_USER_ID = 'kdb_user_id'; // the signed-in manager's Sleeper user_id
export const LS_KEEPERS_PREFIX = 'kdb_keepers_';
export const LS_BOARD_ORDER_PREFIX = 'kdb_board_order_';
export const LS_RULES_PREFIX = 'kdb_rules_';
export const LS_PLAYERS_CACHE = 'kdb_players_cache_v3'; // v3: added espnId
export const LS_ADP_CACHE_PREFIX = 'kdb_adp_cache_v2_'; // v2: added high/low range
export const LS_OUTLOOK_CACHE_PREFIX = 'kdb_outlook_cache_v1_';
export const LS_SHARED_KEEPERS_PREFIX = 'kdb_shared_keepers_';
export const PLAYERS_MAX_AGE_MS = 20 * 60 * 60 * 1000; // ~20h, Sleeper says at most once/day
// ADP moves daily and is the number people second-guess the app over ("he is
// not the 4th pick"), so it gets a much shorter leash than the player
// dictionary. The snapshot is a small static asset — refetching it is cheap.
export const ADP_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4h

export const POSITION_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };

/** How the shared-keeper sync last went, for the header badge. */
export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error';

interface AppState {
  leagueId: string | null;
  season: string | null;
  league: SleeperLeague | null;
  /** Signed-in manager's Sleeper user_id — decides which roster they may edit. */
  currentUserId: string | null;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  playersMap: PlayersMap | null;
  adpMap: AdpMap | null;
  adpRangeMap: AdpRangeMap;
  adpSource: AdpSource;
  outlookMap: OutlookMap;
  keepers: Record<string, string[]>;
  /** Last-known shared doc, kept so an edit can be cancelled back to it. */
  sharedKeepers: SharedKeepers | null;
  /** rosterId -> who locked that team in, for every team that has saved. */
  keeperLocks: Record<string, SharedKeeperTeam>;
  /** Roster being edited in this browser right now; session-only. */
  editingRosterId: number | null;
  syncStatus: SyncStatus;
  syncedAt: Date | null;
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
  currentUserId: null,
  users: [],
  rosters: [],
  playersMap: null,
  adpMap: null,
  adpRangeMap: {},
  adpSource: null,
  outlookMap: {},
  keepers: {},
  sharedKeepers: null,
  keeperLocks: {},
  editingRosterId: null,
  syncStatus: 'off',
  syncedAt: null,
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
export function saveKeepers(): void {
  localStorage.setItem(keepersKey(), JSON.stringify(state.keepers));
}
export function keeperListFor(rosterId: number): string[] {
  return state.keepers[rosterId] || [];
}
export function isKeeper(rosterId: number, playerId: string): boolean {
  return keeperListFor(rosterId).includes(playerId);
}
export function toggleKeeper(rosterId: number, playerId: string): boolean {
  // Defense in depth: the UI only ever renders an interactive star when
  // canEditRoster(rosterId) is true, but this is exported and callable
  // directly, so the same rule is enforced here too.
  if (!canEditRoster(rosterId)) return false;
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
// ---------- shared-keepers cache ----------
// Mirrors the last-fetched shared doc so a failed sync (offline, gist down)
// still shows the true lock state instead of silently forgetting it — losing
// track of a lock would let someone edit a team that's actually already
// committed for the league. sync.ts's refreshSharedKeepers populates this on
// every successful fetch/save; see domain/keeperShare.ts for the derivation of
// keeperLocks from the cached doc.
function sharedKeepersKey(): string {
  return LS_SHARED_KEEPERS_PREFIX + state.leagueId;
}
export function loadSharedKeepersCacheFromStorage(): void {
  // With no gist configured the app is purely local and has no lock concept at
  // all, so a cache left over from a build that DID have one must not surface
  // stale 🔒 badges on teams nobody can even sync with.
  if (!canReadShared()) {
    state.sharedKeepers = null;
    state.keeperLocks = {};
    return;
  }
  try {
    const raw = localStorage.getItem(sharedKeepersKey());
    state.sharedKeepers = raw ? (JSON.parse(raw) as SharedKeepers) : null;
  } catch {
    state.sharedKeepers = null;
  }
  state.keeperLocks = lockedTeamsFor(state.sharedKeepers, state.leagueId);
}
export function cacheSharedKeepersLocally(doc: SharedKeepers | null): void {
  state.sharedKeepers = doc;
  if (doc) localStorage.setItem(sharedKeepersKey(), JSON.stringify(doc));
  else localStorage.removeItem(sharedKeepersKey());
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

// ---------- signed-in manager ----------
// Which Sleeper account this browser is acting as. Set from the setup screen's
// username lookup, or picked by hand in Settings (the manual league-ID path
// never learns a username). This is an honor-system identity, not authentication
// — Sleeper has no OAuth for third-party apps, and this is a private tool for a
// 10-person league where the failure mode is a friend editing the wrong team.
export function loadCurrentUserId(): void {
  state.currentUserId = localStorage.getItem(LS_USER_ID);
}
export function setCurrentUserId(userId: string | null): void {
  state.currentUserId = userId;
  if (userId) localStorage.setItem(LS_USER_ID, userId);
  else localStorage.removeItem(LS_USER_ID);
}

/** The roster the signed-in manager owns, or null if unknown/unclaimed. */
export function myRosterId(): number | null {
  if (!state.currentUserId) return null;
  const mine = state.rosters.find((r) => r.owner_id === state.currentUserId);
  return mine ? mine.roster_id : null;
}

/** Has this team committed its picks to the league's shared doc? */
export function isLockedRoster(rosterId: number): boolean {
  return !!state.keeperLocks[String(rosterId)];
}

/**
 * May this browser change this team's keepers?
 *
 * With no shared gist configured the app is purely local, so everything stays
 * editable exactly as it was before sync existed. Once sync is on, you may only
 * touch your own team, and only while it isn't locked — locked teams are
 * reopened deliberately via the Edit action, which sets editingRosterId.
 */
export function canEditRoster(rosterId: number): boolean {
  if (!canReadShared()) return true;
  const mine = myRosterId();
  if (mine === null || rosterId !== mine) return false;
  return !isLockedRoster(rosterId) || state.editingRosterId === rosterId;
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
