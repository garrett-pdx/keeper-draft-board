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
