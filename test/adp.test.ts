import { describe, it, expect } from 'vitest';
import { normalizePlayerName, matchAdpToPlayers, pickAdpEntry } from '../src/domain/adp';
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
  };

  it('matches by normalized name + position', () => {
    const result = matchAdpToPlayers(
      [
        { name: "Ja'Marr Chase", position: 'WR', team: 'CIN', adp: 4.6 },
        { name: 'Michael Pittman Jr.', position: 'WR', team: 'IND', adp: 55.2 },
      ],
      playersMap,
    );
    expect(result).toEqual({ p1: 4.6, p2: 55.2 });
  });

  it('skips a name + position collision (ambiguous match)', () => {
    const result = matchAdpToPlayers(
      [{ name: 'John Smith', position: 'RB', team: 'FA', adp: 120 }],
      playersMap,
    );
    expect(result).toEqual({});
  });

  it('skips players with no position match and non-positive adp', () => {
    const result = matchAdpToPlayers(
      [
        { name: "Ja'Marr Chase", position: 'RB', team: 'CIN', adp: 4.6 }, // wrong position
        { name: 'Michael Pittman Jr.', position: 'WR', team: 'IND', adp: 0 }, // non-positive
      ],
      playersMap,
    );
    expect(result).toEqual({});
  });

  it('maps FFC\'s "PK" to Sleeper\'s "K" for kickers', () => {
    const result = matchAdpToPlayers(
      [{ name: 'Harrison Butker', position: 'PK', team: 'KC', adp: 180 }],
      playersMap,
    );
    expect(result).toEqual({ p5: 180 });
  });

  it('matches team defenses by team abbreviation, not name', () => {
    // FFC names defenses "<City> Defense" (e.g. "Denver Defense"), which never
    // matches Sleeper's DEF entries (first/last = city/nickname) by name.
    const result = matchAdpToPlayers(
      [{ name: 'Denver Defense', position: 'DEF', team: 'DEN', adp: 140 }],
      playersMap,
    );
    expect(result).toEqual({ p6: 140 });
  });

  it('skips a defense with no team match', () => {
    const result = matchAdpToPlayers(
      [{ name: 'Nowhere Defense', position: 'DEF', team: 'XXX', adp: 140 }],
      playersMap,
    );
    expect(result).toEqual({});
  });
});

describe('pickAdpEntry', () => {
  const entries: AdpSnapshotEntry[] = [
    { teams: 8, format: 'standard', players: [] },
    { teams: 8, format: 'half-ppr', players: [] },
    { teams: 8, format: 'ppr', players: [] },
    { teams: 12, format: 'standard', players: [] },
    { teams: 12, format: 'half-ppr', players: [] },
    { teams: 12, format: 'ppr', players: [] },
  ];

  it('returns null for an empty entry list', () => {
    expect(pickAdpEntry([], 10, 0.5)).toBeNull();
  });

  it('picks the closest team count, then the closest scoring format', () => {
    const picked = pickAdpEntry(entries, 10, 0.5);
    expect(picked?.teams).toBe(8); // |8-10| === |12-10|, first candidate wins the tie
    expect(picked?.format).toBe('half-ppr');
  });

  it('picks standard for rec=0', () => {
    expect(pickAdpEntry(entries, 12, 0)?.format).toBe('standard');
  });

  it('picks ppr for rec=1', () => {
    expect(pickAdpEntry(entries, 12, 1)?.format).toBe('ppr');
  });

  it('defaults to half-ppr when recPoints is unknown', () => {
    expect(pickAdpEntry(entries, 12, null)?.format).toBe('half-ppr');
    expect(pickAdpEntry(entries, 12, undefined)?.format).toBe('half-ppr');
  });

  it('picks the nearer team count when not tied', () => {
    expect(pickAdpEntry(entries, 13, 0.5)?.teams).toBe(12);
    expect(pickAdpEntry(entries, 9, 0.5)?.teams).toBe(8);
  });
});
