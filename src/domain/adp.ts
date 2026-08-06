import type { AdpSnapshotEntry } from '../api/schemas';
import type { AdpMap, AdpRangeMap, PlayersMap } from '../types';

// Real, crowd-sourced ADP from Fantasy Football Calculator, snapshotted at
// build/CI time (see scripts/fetch-adp.mjs) — their API has no CORS support,
// so it can never be called live from the browser (confirmed live: a direct
// fetch() from this app's origin fails with net::ERR_FAILED). FFC's data is
// keyed by player name; Sleeper's is keyed by player_id — matchAdpToPlayers
// bridges the two.

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

export function normalizePlayerName(name: string): string {
  const tokens = name.toLowerCase().replace(/[.,']/g, '').split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(' ');
}

// FFC uses "PK" where Sleeper uses "K" (confirmed against live data) —
// normalize both sides through this before comparing positions.
const POSITION_ALIASES: Record<string, string> = { PK: 'K' };
function normalizePosition(pos: string): string {
  const upper = pos.toUpperCase();
  return POSITION_ALIASES[upper] || upper;
}

/**
 * Matches FFC's name-keyed players against Sleeper's id-keyed player
 * dictionary, using `rankedEntries` in priority order (closest format first —
 * see rankAdpEntries). A lower-sample-size format (e.g. half-ppr, which draws
 * from far fewer real mock drafts than ppr) can genuinely omit real players
 * who are present in another format's data (confirmed live: ~38 players,
 * including Alvin Kamara and Cooper Kupp, are absent from FFC's half-ppr set
 * but present in ppr for the same league size). Rather than showing "no ADP"
 * for a player who clearly has real market data just one format over, each
 * Sleeper player is matched against the first (highest-priority) entry that
 * contains them, falling through lower-priority entries only when absent
 * from every higher-priority one.
 *
 * Team defenses can't be matched by name at all — FFC names them "<City>
 * Defense" while Sleeper's DEF entries use the team nickname as last_name
 * (confirmed against live data) — so those are matched by team abbreviation
 * instead, which both sources share. Everyone else is matched by normalized
 * name + position. Ambiguous matches (two Sleeper players sharing a key) are
 * skipped rather than guessed at — a player unmatched in every entry just
 * falls back to "no ADP" upstream.
 *
 * Alongside the ADP map, also returns each matched player's high/low draft
 * position range from that same entry — display only (e.g. an ADP volatility
 * hint), never fed into the value metric. A player only ever gets a range
 * when they get an adp, from the same priority-ordered entry.
 */
export function matchAdpToPlayers(
  rankedEntries: AdpSnapshotEntry[],
  playersMap: PlayersMap,
): { adp: AdpMap; range: AdpRangeMap } {
  const nameIndex = new Map<string, string[]>();
  const defByTeam = new Map<string, string[]>();
  for (const pid in playersMap) {
    const p = playersMap[pid];
    const pos = normalizePosition(p.pos);
    if (pos === 'DEF') {
      const bucket = defByTeam.get(p.team);
      if (bucket) bucket.push(pid);
      else defByTeam.set(p.team, [pid]);
      continue;
    }
    const key = `${normalizePlayerName(`${p.first} ${p.last}`)}|${pos}`;
    const bucket = nameIndex.get(key);
    if (bucket) bucket.push(pid);
    else nameIndex.set(key, [pid]);
  }

  const adpMap: AdpMap = {};
  const rangeMap: AdpRangeMap = {};
  const assignIfUnambiguous = (
    candidates: string[] | undefined,
    adp: number,
    high: number | null | undefined,
    low: number | null | undefined,
  ) => {
    if (candidates && candidates.length === 1 && !(candidates[0] in adpMap)) {
      adpMap[candidates[0]] = adp;
      rangeMap[candidates[0]] = { high: high ?? null, low: low ?? null };
    }
  };
  for (const entry of rankedEntries) {
    for (const fp of entry.players) {
      if (!(fp.adp > 0)) continue;
      const pos = normalizePosition(fp.position);
      if (pos === 'DEF') {
        assignIfUnambiguous(fp.team ? defByTeam.get(fp.team) : undefined, fp.adp, fp.high, fp.low);
        continue;
      }
      const key = `${normalizePlayerName(fp.name)}|${pos}`;
      assignIfUnambiguous(nameIndex.get(key), fp.adp, fp.high, fp.low);
    }
  }
  return { adp: adpMap, range: rangeMap };
}

// Reception points per format, for ranking scoring formats by closeness below.
const FORMAT_REC: Record<string, number> = { standard: 0, 'half-ppr': 0.5, ppr: 1 };

/** FFC's name for the superflex/2QB market. */
export const SUPERFLEX_FORMAT = '2qb';

/**
 * Ranks this league's entries: superflex first (a hard partition), then by
 * scoring-format closeness to the league's reception points (0 = standard,
 * 0.5 = half-ppr, 1 = ppr), defaulting to half-ppr when scoring isn't known
 * (this app's primary calibration, see CLAUDE.md). The full ranked list feeds
 * matchAdpToPlayers so a player missing from the closest format can still be
 * matched from the next-closest one, rather than showing "no ADP".
 *
 * The superflex split is a **filter, not a tiebreak**, and that distinction is
 * the whole point. Starting a second QB moves the position so far that the two
 * markets aren't comparable — confirmed live, Josh Allen goes 25.6 in half-ppr
 * and 1.4 in 2qb. If 2qb entries merely sorted last for a 1QB league, a QB
 * absent from every 1QB format would still fall through and be priced as a
 * first overall pick, which is worse than showing no ADP at all. So a league
 * draws from one market or the other, never a blend.
 *
 * Superflex leagues still fall back to the 1QB entries when the snapshot has
 * no 2qb data (an older snapshot, or FFC dropping the format) — a slightly
 * mispriced QB beats an empty board.
 */
export function rankAdpEntries(
  entries: AdpSnapshotEntry[],
  teamCount: number,
  recPoints: number | null | undefined,
  superflex = false,
): AdpSnapshotEntry[] {
  if (!entries.length) return [];
  const superflexEntries = entries.filter((e) => e.format === SUPERFLEX_FORMAT);
  const singleQbEntries = entries.filter((e) => e.format !== SUPERFLEX_FORMAT);
  const pool = superflex && superflexEntries.length ? superflexEntries : singleQbEntries;
  if (!pool.length) return [];

  const closestTeamCount = pool
    .map((e) => e.teams)
    .reduce((best, t) => (Math.abs(t - teamCount) < Math.abs(best - teamCount) ? t : best));
  const atTeamCount = pool.filter((e) => e.teams === closestTeamCount);

  // FFC publishes one 2qb set rather than a per-scoring-format matrix, so for a
  // superflex league this sort is a no-op — the partition already picked the
  // market, and reception points only break ties within the 1QB set.
  const targetRec = recPoints ?? 0.5;
  return atTeamCount.slice().sort((a, b) => {
    const ra = FORMAT_REC[a.format] ?? 0.5;
    const rb = FORMAT_REC[b.format] ?? 0.5;
    return Math.abs(ra - targetRec) - Math.abs(rb - targetRec);
  });
}
