import { describe, it, expect } from 'vitest';
import {
  blendMarketMaps,
  describeValueEntry,
  matchValueToPlayers,
  pickValueEntry,
  pprLabel,
  type LeagueShape,
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
  numTeams: 10,
  ppr: 0.5,
  players: [
    { id: 'p1', rank: 3 },
    { id: 'qb1', rank: 40 },
  ],
};
const superflex: ValueSnapshotEntry = {
  numQbs: 2,
  numTeams: 10,
  ppr: 0.5,
  players: [
    { id: 'qb1', rank: 2 },
    { id: 'p1', rank: 9 },
  ],
};

const shape = (over: Partial<LeagueShape> = {}): LeagueShape => ({
  teams: 10,
  recPoints: 0.5,
  superflex: false,
  ...over,
});

/** A full matrix, like the real snapshot: teams x scoring x QB count. */
function matrix(): ValueSnapshotEntry[] {
  const out: ValueSnapshotEntry[] = [];
  for (const numQbs of [1, 2])
    for (const numTeams of [8, 10, 12, 14])
      for (const ppr of [0, 0.5, 1])
        out.push({ numQbs, numTeams, ppr, players: [{ id: 'p1', rank: 1 }] });
  return out;
}

describe('pickValueEntry', () => {
  it('takes the 1QB entry for a normal league', () => {
    expect(pickValueEntry([oneQb, superflex], shape())?.numQbs).toBe(1);
  });

  it('takes the 2QB entry for a superflex league', () => {
    // Worth pinning: switching QB count moves players a mean of 25 rank
    // positions, so picking the wrong entry badly misprices every quarterback.
    expect(pickValueEntry([oneQb, superflex], shape({ superflex: true }))?.numQbs).toBe(2);
  });

  it('matches the league’s own size and scoring out of the matrix', () => {
    const picked = pickValueEntry(matrix(), shape({ teams: 12, recPoints: 1 }));
    expect(picked).toMatchObject({ numQbs: 1, numTeams: 12, ppr: 1 });
  });

  it('matches standard scoring and a small league', () => {
    const picked = pickValueEntry(matrix(), shape({ teams: 8, recPoints: 0 }));
    expect(picked).toMatchObject({ numQbs: 1, numTeams: 8, ppr: 0 });
  });

  it('keeps the QB partition even when another size matches better', () => {
    // QB count dominates every other dimension, so it must never be traded away
    // to get a closer team count.
    const picked = pickValueEntry(matrix(), shape({ teams: 14, superflex: true }));
    expect(picked?.numQbs).toBe(2);
    expect(picked?.numTeams).toBe(14);
  });

  it('snaps to the nearest size and scoring when there is no exact entry', () => {
    const picked = pickValueEntry(matrix(), shape({ teams: 11, recPoints: 0.4 }));
    expect(picked?.numTeams).toBe(10);
    expect(picked?.ppr).toBe(0.5);
  });

  it('defaults unknown scoring to half PPR', () => {
    expect(pickValueEntry(matrix(), shape({ recPoints: null }))?.ppr).toBe(0.5);
    expect(pickValueEntry(matrix(), shape({ recPoints: undefined }))?.ppr).toBe(0.5);
  });

  it('still works on a snapshot predating the matrix', () => {
    // Older snapshots carry numQbs only; they must not be discarded.
    const legacy: ValueSnapshotEntry[] = [{ numQbs: 1, players: [{ id: 'p1', rank: 1 }] }];
    expect(pickValueEntry(legacy, shape({ teams: 12 }))?.numQbs).toBe(1);
  });

  it('falls back across the QB partition rather than returning nothing', () => {
    // A slightly mispriced QB beats an empty board.
    expect(pickValueEntry([oneQb], shape({ superflex: true }))?.numQbs).toBe(1);
    expect(pickValueEntry([superflex], shape())?.numQbs).toBe(2);
  });

  it('returns null only when there are no entries at all', () => {
    expect(pickValueEntry([], shape())).toBeNull();
    expect(pickValueEntry([], shape({ superflex: true }))).toBeNull();
  });
});

describe('describeValueEntry', () => {
  it('describes the entry in the terms a manager would recognise', () => {
    expect(describeValueEntry(oneQb)).toBe('1 QB · 10-team · half PPR');
    expect(describeValueEntry({ ...superflex, numTeams: 8, ppr: 1 })).toBe(
      'superflex · 8-team · full PPR',
    );
  });

  it('omits dimensions a legacy snapshot never carried', () => {
    expect(describeValueEntry({ numQbs: 1, players: [] })).toBe('1 QB');
  });

  it('returns null when nothing was selected', () => {
    expect(describeValueEntry(null)).toBeNull();
  });
});

describe('pprLabel', () => {
  it('names the common scoring formats', () => {
    expect(pprLabel(0)).toBe('standard');
    expect(pprLabel(0.5)).toBe('half PPR');
    expect(pprLabel(1)).toBe('full PPR');
  });

  it('falls back to the raw number for an unusual setting', () => {
    expect(pprLabel(0.25)).toBe('0.25 PPR');
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

describe('blendMarketMaps', () => {
  it('averages a player priced by every source', () => {
    const { blended } = blendMarketMaps([{ p1: 3 }, { p1: 6 }, { p1: 9 }]);
    expect(blended.p1).toBe(6);
  });

  it('averages over the sources that price a player, not over all of them', () => {
    // Coverage genuinely differs — MFL prices no quarterbacks at all — so a
    // missing source must not be read as a zero, which would drag every
    // partially-covered player to the top of the board.
    const { blended } = blendMarketMaps([{ qb: 20 }, { qb: 30 }, { rb: 5 }]);
    expect(blended.qb).toBe(25);
    expect(blended.rb).toBe(5);
  });

  it('reports how many sources priced each player', () => {
    const { sourceCount } = blendMarketMaps([{ a: 1, b: 2 }, { a: 3 }, { a: 5 }]);
    expect(sourceCount.a).toBe(3);
    expect(sourceCount.b).toBe(1);
  });

  it('ignores non-positive picks rather than averaging them in', () => {
    // A zero or negative pick is a broken row, not a player going first overall.
    const { blended, sourceCount } = blendMarketMaps([{ p1: 10 }, { p1: 0 }, { p1: -4 }]);
    expect(blended.p1).toBe(10);
    expect(sourceCount.p1).toBe(1);
  });

  it('drops a player no source priced', () => {
    const { blended } = blendMarketMaps([{ p1: 0 }, {}]);
    expect('p1' in blended).toBe(false);
  });

  it('returns an empty map for no sources', () => {
    expect(blendMarketMaps([]).blended).toEqual({});
  });
});
