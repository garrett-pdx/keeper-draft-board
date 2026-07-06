// Stateful, cache-aware data loaders. Each honors a `force` flag to bypass cache.
import { fetchJSON, sleeper, tryFetchAdpFromProjections } from './api/sleeper';
import {
  LS_ADP_CACHE_PREFIX,
  LS_PLAYERS_CACHE,
  PLAYERS_MAX_AGE_MS,
  state,
} from './state';
import type { SleeperDraft } from './api/schemas';
import type { TradedPicksList } from './domain/tradedPicks';
import type { PlayersMap, PrevDraftMap } from './types';

// ---------- players map (cached, slimmed) ----------
export async function ensurePlayersLoaded(force?: boolean): Promise<PlayersMap> {
  if (state.playersMap && !force) return state.playersMap;
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(LS_PLAYERS_CACHE) || 'null');
      if (cached && Date.now() - cached.ts < PLAYERS_MAX_AGE_MS) {
        state.playersMap = cached.data;
        return state.playersMap!;
      }
    } catch {
      /* ignore, refetch */
    }
  }
  const full = await sleeper.players();
  const slim: PlayersMap = {};
  for (const pid in full) {
    const p = full[pid];
    if (!p) continue;
    const fantasyPositions = p.fantasy_positions;
    const searchRank = p.search_rank;
    slim[pid] = {
      id: pid,
      first: p.first_name || '',
      last: p.last_name || '',
      pos: (fantasyPositions && fantasyPositions[0]) || p.position || '—',
      team: p.team || 'FA',
      rank: typeof searchRank === 'number' ? searchRank : 9999,
    };
  }
  state.playersMap = slim;
  try {
    localStorage.setItem(LS_PLAYERS_CACHE, JSON.stringify({ ts: Date.now(), data: slim }));
  } catch {
    /* storage full — proceed without caching */
  }
  return slim;
}

// ---------- ADP (best-effort; Sleeper has no official public ADP endpoint) ----------
export async function ensureAdpLoaded(force?: boolean) {
  if (state.adpMap && !force) return { adpMap: state.adpMap, source: state.adpSource };
  const cacheKey = LS_ADP_CACHE_PREFIX + state.season;
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached && Date.now() - cached.ts < PLAYERS_MAX_AGE_MS) {
        state.adpMap = cached.data;
        state.adpSource = cached.source;
        return { adpMap: state.adpMap, source: state.adpSource };
      }
    } catch {
      /* ignore */
    }
  }

  let result = null;
  for (const week of [1, 2]) {
    try {
      const r = await tryFetchAdpFromProjections(state.season!, week);
      if (r.count >= 20) {
        result = r;
        break;
      }
    } catch {
      /* try next */
    }
  }

  if (result) {
    state.adpMap = result.adpMap;
    state.adpSource = 'adp';
  } else {
    const players = await ensurePlayersLoaded(false);
    const rankMap: Record<string, number> = {};
    for (const pid in players) rankMap[pid] = players[pid].rank;
    state.adpMap = rankMap;
    state.adpSource = 'rank';
  }
  try {
    localStorage.setItem(
      cacheKey,
      JSON.stringify({ ts: Date.now(), data: state.adpMap, source: state.adpSource }),
    );
  } catch {
    /* storage full — proceed without caching */
  }
  return { adpMap: state.adpMap, source: state.adpSource };
}

// ---------- previous season draft (for keeper cost) ----------
// Keeper "same team last year" is matched on the manager's user_id, which is
// stable across seasons — roster_id can change year to year. We map each
// previous-season pick's roster_id -> previous owner user_id, storing that on
// the pick record; callers compare against the CURRENT roster's owner_id.
export async function ensurePrevDraftLoaded(force?: boolean): Promise<PrevDraftMap> {
  if (state.prevDraftLoaded && !force) return state.prevDraftMap!;
  state.prevDraftMap = {};
  state.prevDraftLoaded = true;
  const league = state.league;
  if (!league || !league.previous_league_id) {
    return state.prevDraftMap; // likely the league's first season
  }
  try {
    const prevLeagueId = league.previous_league_id;
    const prevLeague = await sleeper.league(prevLeagueId);
    if (!prevLeague || !prevLeague.draft_id) return state.prevDraftMap;

    // build prev-season roster_id -> owner user_id map (best-effort; may be empty)
    const prevRosterOwner: Record<string, string> = {};
    try {
      const prevRosters = await sleeper.rosters(prevLeagueId);
      prevRosters.forEach((r) => {
        if (r.owner_id) prevRosterOwner[String(r.roster_id)] = r.owner_id;
      });
    } catch {
      /* fall back to raw roster_id matching */
    }

    const picks = await sleeper.draftPicks(prevLeague.draft_id);
    const map: PrevDraftMap = {};
    for (const pick of picks) {
      if (!pick.player_id) continue;
      const prevRid = String(pick.roster_id);
      map[pick.player_id] = {
        round: pick.round,
        rosterId: pick.roster_id, // raw prev-season roster_id (fallback only)
        ownerId: prevRosterOwner[prevRid] || null, // stable manager id (preferred)
        wasKeeper: pick.is_keeper === true,
      };
    }
    state.prevDraftMap = map;
  } catch {
    state.prevDraftMap = {};
  }
  return state.prevDraftMap;
}

// ---------- this season's draft (order + settings) ----------
// Also used to derive exact keeper pick numbers once the order is known — see
// domain/draftOrder.ts. Fetched once per session; failures leave state.draft
// null, which callers treat as "order not known" rather than throwing.
export async function ensureDraftOrderLoaded(force?: boolean): Promise<SleeperDraft | null> {
  if (state.draft && !force) return state.draft;
  state.draft = null;
  try {
    if (state.league && state.league.draft_id) {
      state.draft = await sleeper.draft(state.league.draft_id);
    }
  } catch {
    /* exact pick numbers unavailable; round-midpoint approximation used instead */
  }
  return state.draft;
}

// ---------- traded draft picks (this draft's season only) ----------
// Draft-scoped endpoint, not the league-wide one — the league-wide endpoint
// aggregates a league's entire multi-season trade history (confirmed live),
// while this one is already correctly scoped to just this draft's picks.
// Feeds keeper-cost resolution (a team's own round-N pick may have been
// traded away), not just board display — used from both loadRosters and
// loadBoard.
export async function ensureTradedPicksLoaded(force?: boolean): Promise<TradedPicksList> {
  if (state.tradedPicks && !force) return state.tradedPicks;
  state.tradedPicks = [];
  try {
    if (state.league && state.league.draft_id) {
      state.tradedPicks = await sleeper.tradedPicks(state.league.draft_id);
    }
  } catch {
    /* keeper costs fall back to capacity=1 everywhere, as if untraded */
  }
  return state.tradedPicks;
}

// ---------- draft round count ----------
export async function ensureBoardRoundsLoaded(force?: boolean): Promise<number> {
  if (state.boardRounds && !force) return state.boardRounds;
  let rounds: number | null = null;
  try {
    const draft = await ensureDraftOrderLoaded(force);
    if (draft && draft.settings && draft.settings.rounds) {
      rounds = draft.settings.rounds;
    }
  } catch {
    /* fall through to estimate */
  }
  if (!rounds) {
    rounds =
      state.league && Array.isArray(state.league.roster_positions)
        ? state.league.roster_positions.length
        : 15;
  }
  state.boardRounds = rounds;
  return rounds;
}

// Last round of the draft — keeper cost for players undrafted last year.
export function lastDraftRound(): number {
  return (
    state.boardRounds ||
    (state.league && Array.isArray(state.league.roster_positions)
      ? state.league.roster_positions.length
      : 14)
  );
}

// Does this player have real prior-season draft data?
export function hasPrevDraft(playerId: string): boolean {
  return !!(state.prevDraftMap && state.prevDraftMap[playerId]);
}

// re-export so callers have one data entrypoint
export { fetchJSON };
