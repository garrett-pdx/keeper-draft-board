import type { OutlookMap } from '../types';

// Keys are namespaced by which id they came from, so a Sleeper id can never be
// confused with a numerically equal ESPN id.
export const sleeperKey = (id: string): string => `sleeper:${id}`;
export const espnKey = (id: number | string): string => `espn:${id}`;

/**
 * A player's season outlook, looked up by Sleeper id first and ESPN id second.
 *
 * The two-key lookup exists because neither id alone covers the board.
 * Sleeper's `espn_id` is missing for roughly two thirds of the top 200 players
 * — including Bijan Robinson, Gibbs, Ja'Marr Chase and Puka Nacua — so matching
 * on it alone left most of the players anyone actually cares about with no
 * outlook. The snapshot now carries a Sleeper id resolved at CI time via
 * FantasyCalc, and that's the preferred key; the ESPN id stays as a fallback
 * for players FantasyCalc doesn't rank but Sleeper does identify.
 */
export function outlookFor(
  sleeperId: string | null | undefined,
  espnId: number | null | undefined,
  outlookMap: OutlookMap,
): string | null {
  if (sleeperId) {
    const hit = outlookMap[sleeperKey(sleeperId)];
    if (hit) return hit;
  }
  if (espnId != null) {
    const hit = outlookMap[espnKey(espnId)];
    if (hit) return hit;
  }
  return null;
}
