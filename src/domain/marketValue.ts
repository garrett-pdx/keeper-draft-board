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
  players: Array<{ id: string; rank: number; value?: number | null }>;
}

/**
 * Pick the entry matching this league's QB requirement.
 *
 * Superflex is the only dimension FantasyCalc varies meaningfully — measured
 * live, switching numQbs moves players a mean of 25 rank positions (max 103),
 * while team count and PPR move them under one slot. So this is a partition on
 * QB count alone, mirroring the ADP snapshot's superflex split.
 *
 * Falls back to the other entry rather than returning nothing: a slightly
 * mispriced QB beats an empty board.
 */
export function pickValueEntry(
  entries: ValueSnapshotEntry[],
  superflex: boolean,
): ValueSnapshotEntry | null {
  if (!entries.length) return null;
  const wanted = superflex ? 2 : 1;
  return entries.find((e) => e.numQbs === wanted) ?? entries[0];
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
