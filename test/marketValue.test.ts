import { describe, it, expect } from 'vitest';
import {
  matchValueToPlayers,
  pickValueEntry,
  type ValueSnapshotEntry,
} from '../src/domain/marketValue';
import type { PlayersMap } from '../src/types';

function player(id: string, pos = 'WR'): PlayersMap[string] {
  return { id, first: 'A', last: id, pos, team: 'KC', rank: 1, birthDate: null, espnId: null };
}

const playersMap: PlayersMap = {
  p1: player('p1'),
  p2: player('p2'),
  qb1: player('qb1', 'QB'),
};

const oneQb: ValueSnapshotEntry = {
  numQbs: 1,
  players: [
    { id: 'p1', rank: 3 },
    { id: 'qb1', rank: 40 },
  ],
};
const superflex: ValueSnapshotEntry = {
  numQbs: 2,
  players: [
    { id: 'qb1', rank: 2 },
    { id: 'p1', rank: 9 },
  ],
};

describe('pickValueEntry', () => {
  it('takes the 1QB entry for a normal league', () => {
    expect(pickValueEntry([oneQb, superflex], false)?.numQbs).toBe(1);
  });

  it('takes the 2QB entry for a superflex league', () => {
    // Worth pinning: switching QB count moves players a mean of 25 rank
    // positions, so picking the wrong entry badly misprices every quarterback.
    expect(pickValueEntry([oneQb, superflex], true)?.numQbs).toBe(2);
  });

  it('falls back to whatever exists rather than returning nothing', () => {
    // A slightly mispriced QB beats an empty board.
    expect(pickValueEntry([oneQb], true)?.numQbs).toBe(1);
    expect(pickValueEntry([superflex], false)?.numQbs).toBe(2);
  });

  it('returns null only when there are no entries at all', () => {
    expect(pickValueEntry([], false)).toBeNull();
    expect(pickValueEntry([], true)).toBeNull();
  });
});

describe('matchValueToPlayers', () => {
  it('maps each player to its overall rank as an implied market pick', () => {
    expect(matchValueToPlayers(oneQb, playersMap)).toEqual({ p1: 3, qb1: 40 });
  });

  it('prices quarterbacks completely differently in superflex', () => {
    expect(matchValueToPlayers(superflex, playersMap).qb1).toBe(2);
  });

  it('drops ids Sleeper does not know, so a stale snapshot cannot inject ghosts', () => {
    const stale: ValueSnapshotEntry = {
      numQbs: 1,
      players: [
        { id: 'p1', rank: 1 },
        { id: 'retired-player', rank: 2 },
      ],
    };
    expect(matchValueToPlayers(stale, playersMap)).toEqual({ p1: 1 });
  });

  it('ignores non-positive ranks rather than treating them as pick 0', () => {
    const bad: ValueSnapshotEntry = {
      numQbs: 1,
      players: [
        { id: 'p1', rank: 0 },
        { id: 'p2', rank: -5 },
      ],
    };
    expect(matchValueToPlayers(bad, playersMap)).toEqual({});
  });

  it('returns an empty map for a missing entry', () => {
    expect(matchValueToPlayers(null, playersMap)).toEqual({});
  });
});
