// Choosing and applying a market-price source.
//
// The keeper metric needs one number per player: the pick at which the market
// prices him. Two sources can supply it, and they are NOT the same quantity:
//
//   'adp'   Fantasy Football Calculator — real average draft position. Answers
//           "what does it cost to get him", which is precisely the keeper
//           question. Crowd-sourced from a rolling recent window, so it reacts
//           fast — and sometimes overreacts (confirmed live: Rashee Rice sat at
//           ADP ~27 for three weeks, then ran to 12.7 in six days).
//   'value' FantasyCalc — a trade-value ranking. Answers "how good is he".
//           Steadier, and matched by exact Sleeper id rather than by name, but
//           it is a proxy for draft cost, not a measurement of it.
//
// Neither is strictly better, which is why the source is a setting rather than
// a decision baked into the code. Whatever is chosen, the UI must say which is
// in use — labelling a value rank as "ADP" would be a lie about the data.
import type { PlayersMap } from '../types';

export interface ValueSnapshotEntry {
  numQbs: number;
  /** Absent on snapshots taken before the matrix existed. */
  numTeams?: number;
  ppr?: number;
  players: Array<{ id: string; rank: number; value?: number | null }>;
}

export interface LeagueShape {
  teams: number;
  /** Points per reception, or null when the league's scoring is unknown. */
  recPoints: number | null | undefined;
  superflex: boolean;
}

/** Human-readable description of the entry actually in use, for the UI. */
export function describeValueEntry(entry: ValueSnapshotEntry | null): string | null {
  if (!entry) return null;
  const bits = [`${entry.numQbs === 2 ? 'superflex' : '1 QB'}`];
  if (entry.numTeams != null) bits.push(`${entry.numTeams}-team`);
  if (entry.ppr != null) bits.push(pprLabel(entry.ppr));
  return bits.join(' · ');
}

export function pprLabel(ppr: number): string {
  if (ppr === 0) return 'standard';
  if (ppr === 1) return 'full PPR';
  if (ppr === 0.5) return 'half PPR';
  return `${ppr} PPR`;
}

/**
 * Pick the entry closest to this league's shape.
 *
 * QB count is a **hard partition**, not a tiebreak: switching it moves players
 * a mean of 25 rank positions (max 103), so a 1QB league drawing on superflex
 * values would misprice every quarterback. Team count and PPR are then matched
 * nearest-wins — they shift players well under a slot on average, but they do
 * vary, so a league is priced against its own shape rather than a nominal one.
 *
 * Falls back across the QB partition rather than returning nothing when a
 * snapshot lacks the wanted side: a slightly mispriced QB beats an empty board.
 */
export function pickValueEntry(
  entries: ValueSnapshotEntry[],
  shape: LeagueShape,
): ValueSnapshotEntry | null {
  if (!entries.length) return null;
  const wantedQbs = shape.superflex ? 2 : 1;
  const pool = entries.filter((e) => e.numQbs === wantedQbs);
  const candidates = pool.length ? pool : entries;

  const targetRec = shape.recPoints ?? 0.5;
  return candidates.slice().sort((a, b) => {
    // Nearest team count first, then nearest scoring. Entries predating the
    // matrix carry neither, and sort last rather than being discarded.
    const teamDelta =
      Math.abs((a.numTeams ?? Infinity) - shape.teams) -
      Math.abs((b.numTeams ?? Infinity) - shape.teams);
    if (teamDelta !== 0) return teamDelta;
    return Math.abs((a.ppr ?? targetRec) - targetRec) - Math.abs((b.ppr ?? targetRec) - targetRec);
  })[0];
}

/**
 * Turn a value entry into the playerId -> market pick map the metric consumes.
 *
 * `overallRank` is used directly as the implied pick number: the Nth most
 * valuable player is treated as costing roughly the Nth pick. That holds up
 * well in a redraft league where drafters broadly follow value, and it is the
 * assumption to revisit first if these numbers ever read oddly.
 *
 * Restricted to players Sleeper actually knows about, so a stale snapshot can't
 * inject ids that match nothing on the board.
 */
export function matchValueToPlayers(
  entry: ValueSnapshotEntry | null,
  playersMap: PlayersMap,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!entry) return out;
  for (const { id, rank } of entry.players) {
    if (rank > 0 && id in playersMap) out[id] = rank;
  }
  return out;
}
