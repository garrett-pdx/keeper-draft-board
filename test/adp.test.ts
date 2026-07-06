import { describe, it, expect } from 'vitest';
import { normalizePlayerName, matchAdpToPlayers, rankAdpEntries } from '../src/domain/adp';
import type { AdpSnapshotEntry } from '../src/api/schemas';
import type { PlayersMap } from '../src/types';

describe('normalizePlayerName', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizePlayerName('Ja Marr Chase')).toBe('ja marr chase');
    expect(normalizePlayerName('  Puka   Nacua ')).toBe('puka nacua');
  });

  it('strips periods and apostrophes', () => {
    expect(normalizePlayerName("Ja'Marr Chase")).toBe('jamarr chase');
    expect(normalizePlayerName('A.J. Brown')).toBe('aj brown');
  });

  it('strips a trailing generational suffix', () => {
    expect(normalizePlayerName('Michael Pittman Jr.')).toBe('michael pittman');
    expect(normalizePlayerName('Marvin Harrison III')).toBe('marvin harrison');
    expect(normalizePlayerName('Odell Beckham Sr')).toBe('odell beckham');
  });

  it('does not strip a suffix-like single-word name', () => {
    expect(normalizePlayerName('Sr')).toBe('sr');
  });
});

describe('matchAdpToPlayers', () => {
  const playersMap: PlayersMap = {
    p1: { id: 'p1', first: "Ja'Marr", last: 'Chase', pos: 'WR', team: 'CIN', rank: 1 },
    p2: { id: 'p2', first: 'Michael', last: 'Pittman', pos: 'WR', team: 'IND', rank: 2 },
    p3: { id: 'p3', first: 'John', last: 'Smith', pos: 'RB', team: 'FA', rank: 3 },
    p4: { id: 'p4', first: 'John', last: 'Smith', pos: 'RB', team: 'FA', rank: 4 }, // ambiguous dupe
    p5: { id: 'p5', first: 'Harrison', last: 'Butker', pos: 'K', team: 'KC', rank: 5 },
    p6: { id: 'p6', first: 'Denver', last: 'Broncos', pos: 'DEF', team: 'DEN', rank: 6 },
    p7: { id: 'p7', first: 'Puka', last: 'Nacua', pos: 'WR', team: 'LAR', rank: 7 },
  };
  const entry = (players: AdpSnapshotEntry['players']): AdpSnapshotEntry => ({
    teams: 10,
    format: 'half-ppr',
    players,
  });

  it('matches by normalized name + position', () => {
    const result = matchAdpToPlayers(
      [
        entry([
          { name: "Ja'Marr Chase", position: 'WR', team: 'CIN', adp: 4.6 },
          { name: 'Michael Pittman Jr.', position: 'WR', team: 'IND', adp: 55.2 },
        ]),
      ],
      playersMap,
    );
    expect(result).toEqual({ p1: 4.6, p2: 55.2 });
  });

  it('skips a name + position collision (ambiguous match)', () => {
    const result = matchAdpToPlayers(
      [entry([{ name: 'John Smith', position: 'RB', team: 'FA', adp: 120 }])],
      playersMap,
    );
    expect(result).toEqual({});
  });

  it('skips players with no position match and non-positive adp', () => {
    const result = matchAdpToPlayers(
      [
        entry([
          { name: "Ja'Marr Chase", position: 'RB', team: 'CIN', adp: 4.6 }, // wrong position
          { name: 'Michael Pittman Jr.', position: 'WR', team: 'IND', adp: 0 }, // non-positive
        ]),
      ],
      playersMap,
    );
    expect(result).toEqual({});
  });

  it('maps FFC\'s "PK" to Sleeper\'s "K" for kickers', () => {
    const result = matchAdpToPlayers(
      [entry([{ name: 'Harrison Butker', position: 'PK', team: 'KC', adp: 180 }])],
      playersMap,
    );
    expect(result).toEqual({ p5: 180 });
  });

  it('matches team defenses by team abbreviation, not name', () => {
    // FFC names defenses "<City> Defense" (e.g. "Denver Defense"), which never
    // matches Sleeper's DEF entries (first/last = city/nickname) by name.
    const result = matchAdpToPlayers(
      [entry([{ name: 'Denver Defense', position: 'DEF', team: 'DEN', adp: 140 }])],
      playersMap,
    );
    expect(result).toEqual({ p6: 140 });
  });

  it('skips a defense with no team match', () => {
    const result = matchAdpToPlayers(
      [entry([{ name: 'Nowhere Defense', position: 'DEF', team: 'XXX', adp: 140 }])],
      playersMap,
    );
    expect(result).toEqual({});
  });

  it('falls back to a lower-priority entry for a player missing from the top one', () => {
    // Real bug this guards against: Puka Nacua is a real top-5 pick, but FFC's
    // half-ppr set (much smaller sample than ppr) omits him entirely, even
    // though he's present in ppr for the same league size — confirmed live.
    const halfPpr = entry([{ name: "Ja'Marr Chase", position: 'WR', team: 'CIN', adp: 4.1 }]);
    const ppr: AdpSnapshotEntry = {
      teams: 10,
      format: 'ppr',
      players: [
        { name: "Ja'Marr Chase", position: 'WR', team: 'CIN', adp: 3.8 },
        { name: 'Puka Nacua', position: 'WR', team: 'LAR', adp: 2.5 },
      ],
    };
    const result = matchAdpToPlayers([halfPpr, ppr], playersMap);
    // present in the higher-priority (half-ppr) entry: that value wins
    expect(result.p1).toBe(4.1);
    // missing from half-ppr, but found in the fallback ppr entry
    expect(result.p7).toBe(2.5);
  });
});

describe('rankAdpEntries', () => {
  const entries: AdpSnapshotEntry[] = [
    { teams: 8, format: 'standard', players: [] },
    { teams: 8, format: 'half-ppr', players: [] },
    { teams: 8, format: 'ppr', players: [] },
    { teams: 12, format: 'standard', players: [] },
    { teams: 12, format: 'half-ppr', players: [] },
    { teams: 12, format: 'ppr', players: [] },
  ];

  it('returns an empty array for an empty entry list', () => {
    expect(rankAdpEntries([], 10, 0.5)).toEqual([]);
  });

  it('ranks the closest team count by closest scoring format first', () => {
    const ranked = rankAdpEntries(entries, 10, 0.5);
    expect(ranked.every((e) => e.teams === 8)).toBe(true); // |8-10| === |12-10|, first group wins the tie
    expect(ranked.map((e) => e.format)).toEqual(['half-ppr', 'standard', 'ppr']);
  });

  it('ranks standard first for rec=0', () => {
    expect(rankAdpEntries(entries, 12, 0)[0].format).toBe('standard');
  });

  it('ranks ppr first for rec=1', () => {
    expect(rankAdpEntries(entries, 12, 1)[0].format).toBe('ppr');
  });

  it('defaults to half-ppr first when recPoints is unknown', () => {
    expect(rankAdpEntries(entries, 12, null)[0].format).toBe('half-ppr');
    expect(rankAdpEntries(entries, 12, undefined)[0].format).toBe('half-ppr');
  });

  it('picks the nearer team count when not tied', () => {
    expect(rankAdpEntries(entries, 13, 0.5)[0].teams).toBe(12);
    expect(rankAdpEntries(entries, 9, 0.5)[0].teams).toBe(8);
  });
});
