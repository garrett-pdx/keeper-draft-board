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
import { hasKnownDraftOrder, orderRosterIdsBySlot, reconcileOrder } from './domain/draftOrder';
import { lockedTeamsFor } from './domain/keeperShare';
import { initialRulesForLeague } from './domain/leagueSettings';
import { keepersAreLocked, type LockedKeeperMap } from './domain/lockedKeepers';
import type { MockDraftSlot } from './domain/mockDraft';
import { DEFAULT_LEAGUE_RULES } from './types';
import { displayNameFor } from './util';

// ---- localStorage keys ----
export const LS_LEAGUE_ID = 'kdb_league_id';
export const LS_SEASON = 'kdb_season';
export const LS_USERNAME = 'kdb_username';
export const LS_USER_ID = 'kdb_user_id'; // the signed-in manager's Sleeper user_id
export const LS_KEEPERS_PREFIX = 'kdb_keepers_';
export const LS_BOARD_ORDER_PREFIX = 'kdb_board_order_';
// Tracks whether the manager has ever manually dragged/arrow-key-reordered a
// board column. Until they have, ensureBoardOrder() is free to keep
// recomputing the order from the real draft slot as soon as it's known — see
// ensureBoardOrder below.
export const LS_BOARD_ORDER_CUSTOM_PREFIX = 'kdb_board_order_custom_';
export const LS_RULES_PREFIX = 'kdb_rules_';
export const LS_PLAYERS_CACHE = 'kdb_players_cache_v3'; // v3: added espnId
// v3: keyed per league, not just per season. What's cached is the *resolved*
// ADP map — already matched to Sleeper ids through this league's format — so a
// superflex league and a 1QB league in the same season must not share an entry
// or whichever loaded first would price the other's QBs completely wrong.
export const LS_ADP_CACHE_PREFIX = 'kdb_adp_cache_v3_';
// v2: keys are namespaced ("sleeper:<id>" / "espn:<id>") rather than bare ESPN
// ids. The prefix MUST be bumped whenever that shape changes — a cached v1 map
// looks perfectly valid to the loader but matches nothing, so every player
// would silently show no outlook until the 20h cache aged out.
export const LS_OUTLOOK_CACHE_PREFIX = 'kdb_outlook_cache_v2_';
export const LS_SHARED_KEEPERS_PREFIX = 'kdb_shared_keepers_';
// Versioned like the other caches above — bump this if MockDraftState's shape
// ever changes, so a stale cached shape doesn't parse "successfully" and then
// break at first use (state.mockDraft.picks etc. would just be undefined).
// Bumped to v2 when the pick sequence moved from round×roster cells to seats:
// the shape is unchanged, so a v1 draft would have parsed fine and quietly
// kept running the old order, handing a roster its two traded picks
// back-to-back for the rest of the simulation. A local practice sim is cheap
// to restart; running one on a sequence the board contradicts is not.
export const LS_MOCK_DRAFT_PREFIX = 'kdb_mock_draft_v2_';
export const PLAYERS_MAX_AGE_MS = 20 * 60 * 60 * 1000; // ~20h, Sleeper says at most once/day
// ADP moves daily and is the number people second-guess the app over ("he is
// not the 4th pick"), so it gets a much shorter leash than the player
// dictionary. The snapshot is a small static asset — refetching it is cheap.
export const ADP_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4h

export const POSITION_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };

/** How the shared-keeper sync last went, for the header badge. */
export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error';

/**
 * A local-only practice simulation on the Draft Board — never touches the
 * shared Gist. `slots`/`slotOrderRosterIds`/`claimedRosterId` are snapshotted
 * once at Start (src/mockDraft.ts's startMockDraft) so a later Refresh All,
 * the real draft order finally being set by the commissioner, or the
 * signed-in manager re-claiming a *different* team via the Rosters tab
 * mid-simulation can't retroactively perturb an in-progress simulation — turn
 * matching uses `claimedRosterId`, never a live `myRosterId()` read, so a
 * re-claim can't cause the AI to silently draft what should have been the
 * manager's own pick. `picks` is parallel to `slots`; `null` = not yet
 * picked, so "find the next open pick" is a single findIndex.
 *
 * `slotOrderRosterIds` is seeded from `state.boardOrder` — before Sleeper
 * publishes a real order the board's columns are the only draft order there
 * is, so dragging one picks the slot you practice from (see frozenSlotOrder).
 * Snapshotting it here is what keeps that a *choice made at Start* rather
 * than a live read; board.ts additionally refuses to reorder columns at all
 * while a mock draft exists, so the grid can't end up displaying an order the
 * simulation isn't running in.
 *
 * `rounds` is the one snapshot that is *checked* rather than used: the board
 * renders `1..state.boardRounds` (live), so a commissioner shrinking the draft
 * mid-simulation would silently hide tail-round picks while their players
 * stayed unavailable. mockDraftMismatch() compares the two and blocks the run
 * instead — same treatment as a roster changing underneath it.
 *
 * Deliberately NOT stored: a team count (the frozen `slots` list already
 * encodes it) and a start timestamp — both were write-only fields whose
 * presence implied a protection they didn't provide.
 */
export interface MockDraftState {
  active: boolean;
  rounds: number;
  slotOrderRosterIds: number[];
  claimedRosterId: number;
  slots: MockDraftSlot[];
  picks: (string | null)[];
}

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
  /** Which snapshot entry the market data came from, e.g. "1 QB · 10-team · half PPR". */
  marketEntryLabel: string | null;
  /**
   * player_id -> how many sources priced him, set only when adpSource is
   * 'blend'. Null otherwise. Coverage differs between sources (MFL prices no
   * quarterbacks at all), so a blended number can rest on one source or three,
   * and the UI shouldn't present those as equally settled.
   */
  marketSourceCount: Record<string, number> | null;
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
  /**
   * This season's keepers as entered in Sleeper's draft room. Once non-empty
   * they replace every in-app selection as the source of truth — see
   * domain/lockedKeepers.ts. Null means "not loaded / none entered", which is
   * the ordinary pre-deadline state, not an error.
   */
  lockedKeepers: LockedKeeperMap | null;
  lockedKeepersLoaded: boolean;
  boardRounds: number | null;
  boardOrder: string[] | null;
  rules: LeagueRules;
  draft: SleeperDraft | null;
  tradedPicks: TradedPicksList | null;
  mockDraft: MockDraftState | null;
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
  marketEntryLabel: null,
  marketSourceCount: null,
  outlookMap: {},
  keepers: {},
  sharedKeepers: null,
  keeperLocks: {},
  editingRosterId: null,
  syncStatus: 'off',
  syncedAt: null,
  prevDraftMap: null,
  prevDraftLoaded: false,
  lockedKeepers: null,
  lockedKeepersLoaded: false,
  boardRounds: null,
  boardOrder: null,
  rules: { ...DEFAULT_LEAGUE_RULES },
  draft: null,
  tradedPicks: null,
  mockDraft: null,
  rostersLoadedAt: null,
  draftLoadedAt: null,
  boardLoadedAt: null,
};

/**
 * Drop everything that belongs to the league we're leaving.
 *
 * Call this when switching leagues, BEFORE loading the new one. Every `ensure*`
 * loader in data.ts short-circuits on in-memory state (`if (state.draft &&
 * !force) return state.draft`), so without this the previous league's draft
 * history, draft order, traded picks and board rounds all survive into the next
 * one — and keeper costs get computed from the wrong league's draft entirely.
 *
 * `playersMap` and `outlookMap` deliberately survive: they're keyed by player,
 * not league, and re-downloading Sleeper's multi-megabyte player dictionary on
 * every league switch would be pure waste. `adpMap` does NOT survive — it's the
 * resolved map for one league's scoring format and superflex-ness.
 */
export function resetLeagueScopedState(): void {
  state.league = null;
  state.users = [];
  state.rosters = [];
  state.adpMap = null;
  state.adpRangeMap = {};
  state.adpSource = null;
  state.marketEntryLabel = null;
  state.marketSourceCount = null;
  state.keepers = {};
  state.sharedKeepers = null;
  state.keeperLocks = {};
  state.editingRosterId = null;
  state.syncStatus = 'off';
  state.syncedAt = null;
  state.prevDraftMap = null;
  state.prevDraftLoaded = false;
  state.lockedKeepers = null;
  state.lockedKeepersLoaded = false;
  state.boardRounds = null;
  state.boardOrder = null;
  state.draft = null;
  state.tradedPicks = null;
  state.mockDraft = null;
  state.rostersLoadedAt = null;
  state.draftLoadedAt = null;
  state.boardLoadedAt = null;
}

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
/**
 * A team's keepers as the UI should show them.
 *
 * Once the deadline has passed this reports Sleeper's locked draft-room keepers
 * rather than whatever was selected in the app, so the stars, the "Keepers N/M"
 * counts and every downstream read agree with the board. `state.keepers` is
 * left untouched — it's still the manager's own pre-deadline planning, and the
 * shared gist is still its home — it simply stops being what anyone is shown.
 */
export function keeperListFor(rosterId: number): string[] {
  if (keepersLockedInSleeper()) {
    return (state.lockedKeepers?.[String(rosterId)] || []).map((k) => k.playerId);
  }
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

// ---------- board column order persistence ----------
function boardOrderKey(): string {
  return LS_BOARD_ORDER_PREFIX + state.leagueId;
}
function boardOrderCustomKey(): string {
  return LS_BOARD_ORDER_CUSTOM_PREFIX + state.leagueId;
}
export function saveBoardOrder(): void {
  localStorage.setItem(boardOrderKey(), JSON.stringify(state.boardOrder));
}
// Called only from an explicit user reorder (drag or arrow-key) — see
// board.ts's reorderBoardColumns, which is only reachable while the order is
// still unlocked (see isBoardOrderLocked).
export function markBoardOrderCustomized(): void {
  localStorage.setItem(boardOrderCustomKey(), '1');
}
function isBoardOrderCustomized(): boolean {
  return localStorage.getItem(boardOrderCustomKey()) === '1';
}

/**
 * Once the commissioner has set the real draft order on Sleeper, the board's
 * column order stops being a preference and becomes a fact — the columns *are*
 * the draft, left to right. Reordering them from there produces a board that
 * looks authoritative and is wrong, which is worse than one that's merely
 * inconveniently arranged, so dragging is switched off entirely.
 */
export function isBoardOrderLocked(): boolean {
  return hasKnownDraftOrder(state.draft);
}

// Draft-slot order (1..N) when the commissioner has set it, else the rosters'
// existing (roster_id-ascending) order — the only thing available pre-order.
function naturalBoardOrder(currentIds: string[]): string[] {
  return orderRosterIdsBySlot(state.draft, currentIds);
}

export function ensureBoardOrder(): void {
  const currentIds = state.rosters.map((r) => String(r.roster_id));
  // A manual arrangement is only ever a stand-in for an order Sleeper hasn't
  // published yet, so the moment the real one arrives it is discarded rather
  // than merely overridden — the flag is cleared too, so nothing can resurrect
  // it later if the commissioner un-sets the order.
  if (isBoardOrderLocked() && isBoardOrderCustomized()) {
    localStorage.removeItem(boardOrderCustomKey());
  }
  if (isBoardOrderLocked() || !isBoardOrderCustomized()) {
    // Either the real order is known (authoritative), or nothing has been
    // manually reordered yet — in both cases keep tracking naturalBoardOrder
    // so the board self-corrects the moment the commissioner sets it, instead
    // of freezing on whatever was true the first time this league was loaded.
    state.boardOrder = naturalBoardOrder(currentIds);
    saveBoardOrder();
    return;
  }
  let order: unknown = null;
  try {
    order = JSON.parse(localStorage.getItem(boardOrderKey()) || 'null');
  } catch {
    order = null;
  }
  if (!Array.isArray(order)) order = [];
  state.boardOrder = reconcileOrder(order as string[], currentIds);
  saveBoardOrder();
}

// ---------- mock draft persistence ----------
// Local-only — deliberately never touches the shared Gist (see MockDraftState
// doc comment). src/mockDraft.ts owns all reads/writes of state.mockDraft;
// this is just the localStorage round-trip, following the exact boardOrder
// pattern above.
function mockDraftKey(): string {
  return LS_MOCK_DRAFT_PREFIX + state.leagueId;
}
export function saveMockDraft(): void {
  // Swallowed on purpose, unlike the keeper/rules writes above: this one is
  // called from inside advance()'s AI loop, so a QuotaExceededError thrown
  // here would abort a simulation mid-run and leave the board un-rendered
  // against a half-filled picks array. A mock draft is disposable practice
  // data — losing the save is a far smaller harm than losing the run, and
  // quota exhaustion is a live risk here (the slimmed player dictionary alone
  // is a multi-megabyte localStorage entry — see data.ts, where every cache
  // write is guarded the same way).
  try {
    if (state.mockDraft) localStorage.setItem(mockDraftKey(), JSON.stringify(state.mockDraft));
    else localStorage.removeItem(mockDraftKey());
  } catch {
    /* storage full — the simulation carries on in memory */
  }
}
export function loadMockDraftFromStorage(): void {
  try {
    const raw = localStorage.getItem(mockDraftKey());
    state.mockDraft = raw ? (JSON.parse(raw) as MockDraftState) : null;
  } catch {
    state.mockDraft = null;
  }
}
export function clearMockDraft(): void {
  state.mockDraft = null;
  localStorage.removeItem(mockDraftKey());
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
/** True once Sleeper's draft room holds this season's keepers. */
export function keepersLockedInSleeper(): boolean {
  return keepersAreLocked(state.lockedKeepers);
}

export function canEditRoster(rosterId: number): boolean {
  // Past the league's keeper deadline the picks are settled in Sleeper and
  // this app only reports them, so nobody edits anything — including your own
  // team, and including a league running with no shared gist at all.
  if (keepersLockedInSleeper()) return false;
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

/** Has this browser ever saved rules for the current league? */
export function hasSavedRules(): boolean {
  return localStorage.getItem(rulesKey()) !== null;
}

/**
 * Seed this league's rules from Sleeper's own settings, but only the first time
 * it's opened here.
 *
 * A league that has been configured in this app keeps what it was given —
 * silently rewriting a commissioner's deliberate choice because Sleeper says
 * otherwise would be worse than being slightly out of date. Settings surfaces
 * the difference instead and offers to apply it.
 */
export function seedRulesFromLeague(league: SleeperLeague | null): void {
  if (!league || hasSavedRules()) return;
  state.rules = initialRulesForLeague(league);
  saveRules();
}
export function updateRules(patch: Partial<LeagueRules>): void {
  state.rules = { ...state.rules, ...patch };
  saveRules();
}
