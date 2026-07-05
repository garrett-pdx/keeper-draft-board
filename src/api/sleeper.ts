import { extractAdp } from '../domain/adp';
import type { AdpMap } from '../types';

const BASE = 'https://api.sleeper.app';

export async function fetchJSON<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

// ---- endpoint helpers (all public, read-only GETs) ----
export const sleeper = {
  league: (id: string) => fetchJSON<Record<string, unknown>>(`${BASE}/v1/league/${id}`),
  users: (id: string) => fetchJSON<Record<string, unknown>[]>(`${BASE}/v1/league/${id}/users`),
  rosters: (id: string) => fetchJSON<Record<string, unknown>[]>(`${BASE}/v1/league/${id}/rosters`),
  players: () => fetchJSON<Record<string, Record<string, unknown>>>(`${BASE}/v1/players/nfl`),
  draft: (draftId: string) => fetchJSON<Record<string, unknown>>(`${BASE}/v1/draft/${draftId}`),
  draftPicks: (draftId: string) =>
    fetchJSON<Record<string, unknown>[]>(`${BASE}/v1/draft/${draftId}/picks`),
};

export interface AdpFetchResult {
  adpMap: AdpMap;
  count: number;
}

// UNDOCUMENTED endpoint — Sleeper exposes no official ADP. See README "ADP data source".
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
