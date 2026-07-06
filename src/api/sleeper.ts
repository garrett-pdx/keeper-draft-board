import { extractAdp } from '../domain/adp';
import type { AdpMap } from '../types';
import {
  DraftSchema,
  LeagueSchema,
  LeaguesForUserSchema,
  PicksSchema,
  RostersSchema,
  TradedPicksSchema,
  UserLookupSchema,
  UsersSchema,
  type PlayersResponse,
  type SleeperDraft,
  type SleeperLeague,
  type SleeperRoster,
  type SleeperTradedPick,
  type SleeperUser,
  type SleeperUserLookup,
} from './schemas';

const BASE = 'https://api.sleeper.app';

export async function fetchJSON<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

// ---- endpoint helpers (all public, read-only GETs; responses validated) ----
export const sleeper = {
  league: async (id: string): Promise<SleeperLeague> =>
    LeagueSchema.parse(await fetchJSON(`${BASE}/v1/league/${id}`)),
  users: async (id: string): Promise<SleeperUser[]> =>
    UsersSchema.parse(await fetchJSON(`${BASE}/v1/league/${id}/users`)),
  rosters: async (id: string): Promise<SleeperRoster[]> =>
    RostersSchema.parse(await fetchJSON(`${BASE}/v1/league/${id}/rosters`)),
  players: async (): Promise<PlayersResponse> =>
    fetchJSON<PlayersResponse>(`${BASE}/v1/players/nfl`),
  draft: async (draftId: string): Promise<SleeperDraft> =>
    DraftSchema.parse(await fetchJSON(`${BASE}/v1/draft/${draftId}`)),
  draftPicks: async (draftId: string) =>
    PicksSchema.parse(await fetchJSON(`${BASE}/v1/draft/${draftId}/picks`)),
  // Sleeper returns HTTP 200 with a literal `null` body for an unknown username
  // (not a 404), so this is special-cased rather than always-parse-and-throw
  // like the other endpoints.
  userByUsername: async (username: string): Promise<SleeperUserLookup | null> => {
    const raw = await fetchJSON<unknown>(`${BASE}/v1/user/${encodeURIComponent(username)}`);
    if (raw === null) return null;
    return UserLookupSchema.parse(raw);
  },
  leaguesForUser: async (userId: string, season: string): Promise<SleeperLeague[]> =>
    LeaguesForUserSchema.parse(await fetchJSON(`${BASE}/v1/user/${userId}/leagues/nfl/${season}`)),
  tradedPicks: async (draftId: string): Promise<SleeperTradedPick[]> =>
    TradedPicksSchema.parse(await fetchJSON(`${BASE}/v1/draft/${draftId}/traded_picks`)),
};

export interface AdpFetchResult {
  adpMap: AdpMap;
  count: number;
}

// UNDOCUMENTED endpoint — Sleeper exposes no official ADP. See README "ADP data source".
// Left intentionally loose (no schema) because the payload shape is unofficial and
// varies; extractAdp scans whatever stats object it finds.
export async function tryFetchAdpFromProjections(
  season: string,
  week: number,
): Promise<AdpFetchResult> {
  const posParams = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX']
    .map((p) => `position[]=${p}`)
    .join('&');
  const url = `${BASE}/projections/nfl/${season}/${week}?season_type=regular&${posParams}`;
  const data = await fetchJSON<unknown>(url);
  const adpMap: AdpMap = {};
  let count = 0;
  if (Array.isArray(data)) {
    for (const item of data) {
      const pid = item.player_id || (item.metadata && item.metadata.player_id);
      const stats = item.stats || item;
      const adp = extractAdp(stats);
      if (pid && adp) {
        adpMap[pid] = adp;
        count++;
      }
    }
  } else if (data && typeof data === 'object') {
    for (const pid in data as Record<string, { stats?: Record<string, unknown> }>) {
      const entry = (data as Record<string, { stats?: Record<string, unknown> }>)[pid];
      const stats = (entry && entry.stats) || entry;
      const adp = extractAdp(stats);
      if (adp) {
        adpMap[pid] = adp;
        count++;
      }
    }
  }
  return { adpMap, count };
}
