import type { AdpSnapshotEntry } from '../api/schemas';
import type { AdpMap, PlayersMap } from '../types';

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
 * dictionary. Team defenses can't be matched by name at all — FFC names them
 * "<City> Defense" while Sleeper's DEF entries use the team nickname as
 * last_name (confirmed against live data) — so those are matched by team
 * abbreviation instead, which both sources share. Everyone else is matched
 * by normalized name + position. Ambiguous matches (two Sleeper players
 * sharing a key) are skipped rather than guessed at — an unmatched player
 * just falls back to "no ADP" upstream.
 */
export function matchAdpToPlayers(
  ffcPlayers: AdpSnapshotEntry['players'],
  playersMap: PlayersMap,
): AdpMap {
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
  const assignIfUnambiguous = (candidates: string[] | undefined, adp: number) => {
    if (candidates && candidates.length === 1) adpMap[candidates[0]] = adp;
  };
  for (const fp of ffcPlayers) {
    if (!(fp.adp > 0)) continue;
    const pos = normalizePosition(fp.position);
    if (pos === 'DEF') {
      assignIfUnambiguous(fp.team ? defByTeam.get(fp.team) : undefined, fp.adp);
      continue;
    }
    const key = `${normalizePlayerName(fp.name)}|${pos}`;
    assignIfUnambiguous(nameIndex.get(key), fp.adp);
  }
  return adpMap;
}

// Reception points per format, for picking the closest scoring format below.
const FORMAT_REC: Record<string, number> = { standard: 0, 'half-ppr': 0.5, ppr: 1 };

/**
 * Picks the snapshot entry closest to this league: nearest team count first,
 * then the scoring format nearest the league's reception points (0 =
 * standard, 0.5 = half-ppr, 1 = ppr). Defaults to half-ppr when scoring
 * isn't known — this app's primary calibration (see CLAUDE.md).
 */
export function pickAdpEntry(
  entries: AdpSnapshotEntry[],
  teamCount: number,
  recPoints: number | null | undefined,
): AdpSnapshotEntry | null {
  if (!entries.length) return null;
  const closestTeamCount = entries
    .map((e) => e.teams)
    .reduce((best, t) => (Math.abs(t - teamCount) < Math.abs(best - teamCount) ? t : best));
  const atTeamCount = entries.filter((e) => e.teams === closestTeamCount);
  const targetRec = recPoints ?? 0.5;
  return atTeamCount.reduce((best, e) => {
    const rec = FORMAT_REC[e.format] ?? 0.5;
    const bestRec = FORMAT_REC[best.format] ?? 0.5;
    return Math.abs(rec - targetRec) < Math.abs(bestRec - targetRec) ? e : best;
  }, atTeamCount[0]);
}
