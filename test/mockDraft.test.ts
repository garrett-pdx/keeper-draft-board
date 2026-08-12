import { describe, it, expect } from 'vitest';
import {
  buildMockDraftSlots,
  bestAvailablePlayer,
  positionCaps,
  filterByPositionCaps,
  filterByStarterPriority,
} from '../src/domain/mockDraft';
import type { AdpMap } from '../src/types';

describe('buildMockDraftSlots', () => {
  const alwaysOne = () => 1;
  const noKeepers = () => 0;

  it('snake-reverses the roster order on even rounds', () => {
    const slots = buildMockDraftSlots(2, [1, 2, 3], alwaysOne, noKeepers);
    expect(slots.slice(0, 3).map((s) => s.rosterId)).toEqual([1, 2, 3]); // round 1
    expect(slots.slice(3, 6).map((s) => s.rosterId)).toEqual([3, 2, 1]); // round 2
  });

  it('continues correctly into round 3 (odd again)', () => {
    const slots = buildMockDraftSlots(3, [1, 2, 3], alwaysOne, noKeepers);
    expect(slots.slice(6, 9).map((s) => s.rosterId)).toEqual([1, 2, 3]);
  });

  it('produces zero slots for a round/roster with zero capacity (pick traded away)', () => {
    const capacityFor = (round: number, rosterId: number) =>
      round === 1 && rosterId === 2 ? 0 : 1;
    const slots = buildMockDraftSlots(1, [1, 2, 3], capacityFor, noKeepers);
    expect(slots.map((s) => s.rosterId)).toEqual([1, 3]);
  });

  it('produces one consecutive slot when capacity is 2 and one keeper already fills the cell', () => {
    const capacityFor = (round: number, rosterId: number) =>
      round === 1 && rosterId === 2 ? 2 : 1;
    const keepersInCellFor = (round: number, rosterId: number) =>
      round === 1 && rosterId === 2 ? 1 : 0;
    const slots = buildMockDraftSlots(1, [1, 2, 3], capacityFor, keepersInCellFor);
    expect(slots.map((s) => s.rosterId)).toEqual([1, 2, 3]);
  });

  it('produces two consecutive slots when capacity is 2 and no keeper occupies the cell', () => {
    const capacityFor = (round: number, rosterId: number) =>
      round === 1 && rosterId === 2 ? 2 : 1;
    const slots = buildMockDraftSlots(1, [1, 2, 3], capacityFor, noKeepers);
    expect(slots.map((s) => s.rosterId)).toEqual([1, 2, 2, 3]);
  });

  it('produces zero slots for a cell fully pre-filled by keepers (capacity === keepersInCell)', () => {
    const keepersInCellFor = (round: number, rosterId: number) =>
      round === 1 && rosterId === 2 ? 1 : 0;
    const slots = buildMockDraftSlots(1, [1, 2, 3], alwaysOne, keepersInCellFor);
    expect(slots.map((s) => s.rosterId)).toEqual([1, 3]);
  });

  it('total slot count matches sum(capacityFor - keepersInCellFor) across all round×roster pairs', () => {
    const rosterIds = [1, 2, 3, 4];
    const rounds = 4;
    const capacityFor = (round: number, rosterId: number) =>
      round === 2 && rosterId === 3 ? 2 : round === 3 && rosterId === 1 ? 0 : 1;
    const keepersInCellFor = (round: number, rosterId: number) =>
      round === 1 && rosterId === 2 ? 1 : 0;
    const slots = buildMockDraftSlots(rounds, rosterIds, capacityFor, keepersInCellFor);
    let expected = 0;
    for (let round = 1; round <= rounds; round++) {
      for (const rosterId of rosterIds) {
        expected += capacityFor(round, rosterId) - keepersInCellFor(round, rosterId);
      }
    }
    expect(slots.length).toBe(expected);
  });

  it('returns an empty array for zero/negative rounds', () => {
    expect(buildMockDraftSlots(0, [1, 2], alwaysOne, noKeepers)).toEqual([]);
    expect(buildMockDraftSlots(-1, [1, 2], alwaysOne, noKeepers)).toEqual([]);
  });

  it('returns an empty array for an empty roster order', () => {
    expect(buildMockDraftSlots(3, [], alwaysOne, noKeepers)).toEqual([]);
  });
});

describe('bestAvailablePlayer', () => {
  const adpMap: AdpMap = { p1: 4.6, p2: 55.2, p3: 12.3 };

  it('returns the lowest-adp id from a mixed available list', () => {
    expect(bestAvailablePlayer(['p2', 'p1', 'p3'], adpMap)).toBe('p1');
  });

  it('returns null for an empty list', () => {
    expect(bestAvailablePlayer([], adpMap)).toBeNull();
  });

  it('still selects a player missing from adpMap, just deprioritized via the 9999 sentinel', () => {
    // p4 has no ADP; still picked over nothing, but never over a real-ADP player.
    expect(bestAvailablePlayer(['p4'], adpMap)).toBe('p4');
    expect(bestAvailablePlayer(['p4', 'p1'], adpMap)).toBe('p1');
  });
});

describe('positionCaps', () => {
  it('returns no caps at all when roster_positions is unknown, rather than guessing', () => {
    expect(positionCaps(null)).toEqual({});
    expect(positionCaps(undefined)).toEqual({});
    expect(positionCaps([])).toEqual({});
  });

  it('caps a standard 1QB league by starting slots + FLEX eligibility + bench buffer', () => {
    const rosterPositions = [
      'QB',
      'RB',
      'RB',
      'WR',
      'WR',
      'TE',
      'FLEX',
      'FLEX',
      'FLEX',
      'DEF',
      'BN',
      'BN',
      'BN',
    ];
    expect(positionCaps(rosterPositions)).toEqual({
      QB: 3, // 1 starter, no FLEX home, +2 buffer
      RB: 7, // 2 starters + 3 FLEX slots + 2 buffer
      WR: 7, // 2 starters + 3 FLEX slots + 2 buffer
      TE: 6, // 1 starter + 3 FLEX slots + 2 buffer
      K: 2, // no starting slot at all — just the bare buffer
      DEF: 3, // 1 starter + 2 buffer
    });
  });

  it('gives QB a much bigger cap in a superflex league via SUPER_FLEX eligibility', () => {
    const rosterPositions = [
      'QB',
      'QB',
      'RB',
      'WR',
      'WR',
      'TE',
      'FLEX',
      'FLEX',
      'SUPER_FLEX',
      'DEF',
    ];
    expect(positionCaps(rosterPositions)).toEqual({
      QB: 5, // 2 starters + SUPER_FLEX + 2 buffer
      RB: 6, // 1 starter + FLEX + SUPER_FLEX + 2 buffer
      WR: 7, // 2 starters + FLEX + SUPER_FLEX + 2 buffer
      TE: 6, // 1 starter + FLEX + SUPER_FLEX + 2 buffer
      K: 2,
      DEF: 3,
    });
  });

  it('handles WRRB_FLEX and REC_FLEX eligibility separately from plain FLEX', () => {
    const rosterPositions = ['QB', 'RB', 'WR', 'TE', 'WRRB_FLEX', 'REC_FLEX'];
    expect(positionCaps(rosterPositions)).toEqual({
      QB: 3,
      RB: 4, // 1 starter + WRRB_FLEX + 2 buffer
      WR: 5, // 1 starter + WRRB_FLEX + REC_FLEX + 2 buffer
      TE: 4, // 1 starter + REC_FLEX + 2 buffer
      K: 2,
      DEF: 2,
    });
  });

  it('honors a custom bench buffer, including zero', () => {
    expect(positionCaps(['QB'], 0)).toEqual({ QB: 1, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 });
  });
});

describe('filterByPositionCaps', () => {
  const positions: Record<string, string> = { qb1: 'QB', qb2: 'QB', rb1: 'RB', def1: 'IDP' };
  const positionOf = (pid: string) => positions[pid];

  it('drops players whose position has already reached its cap', () => {
    const result = filterByPositionCaps(
      ['qb1', 'qb2', 'rb1'],
      positionOf,
      { QB: 2 },
      { QB: 2, RB: 5 },
    );
    expect(result).toEqual(['rb1']);
  });

  it('keeps players whose position is still under cap', () => {
    const result = filterByPositionCaps(['qb1'], positionOf, { QB: 1 }, { QB: 2 });
    expect(result).toEqual(['qb1']);
  });

  it('never restricts a position absent from the caps map', () => {
    const result = filterByPositionCaps(['def1'], positionOf, { IDP: 99 }, { QB: 2 });
    expect(result).toEqual(['def1']);
  });

  it('never restricts a player with no known position', () => {
    const result = filterByPositionCaps(['ghost'], () => undefined, {}, { QB: 0 });
    expect(result).toEqual(['ghost']);
  });

  it('passes everything through when caps is empty (unknown roster_positions)', () => {
    const result = filterByPositionCaps(['qb1', 'qb2', 'rb1'], positionOf, { QB: 5 }, {});
    expect(result).toEqual(['qb1', 'qb2', 'rb1']);
  });
});

describe('filterByStarterPriority', () => {
  const positions: Record<string, string> = {
    qb1: 'QB',
    te1: 'TE',
    wr1: 'WR',
    rb1: 'RB',
    def1: 'IDP',
  };
  const positionOf = (pid: string) => positions[pid];
  // A standard 1QB league's starting slots (no FLEX eligibility needed for these tests).
  const starting1qb = { QB: 1, RB: 2, WR: 2, TE: 1 };

  it('blocks the 2nd bench WR before the starting QB is filled', () => {
    const result = filterByStarterPriority(['wr1', 'te1'], positionOf, { WR: 3, QB: 0 }, starting1qb);
    expect(result).toEqual(['te1']);
  });

  it('allows the 1st bench WR regardless of QB — only the 2nd bench WR is gated', () => {
    const result = filterByStarterPriority(['wr1'], positionOf, { WR: 2, QB: 0 }, starting1qb);
    expect(result).toEqual(['wr1']);
  });

  it('blocks the 3rd bench RB before the starting TE is filled', () => {
    const result = filterByStarterPriority(['rb1', 'qb1'], positionOf, { RB: 4, TE: 0 }, starting1qb);
    expect(result).toEqual(['qb1']);
  });

  it('blocks the 1st bench TE before the starting QB is filled', () => {
    const result = filterByStarterPriority(['te1', 'wr1'], positionOf, { TE: 1, QB: 0 }, starting1qb);
    expect(result).toEqual(['wr1']);
  });

  it('blocks the 1st bench QB before the starting TE is filled', () => {
    const result = filterByStarterPriority(['qb1', 'wr1'], positionOf, { QB: 1, TE: 0 }, starting1qb);
    expect(result).toEqual(['wr1']);
  });

  it('allows the 2nd bench WR once the team already has its starting QB and TE', () => {
    const result = filterByStarterPriority(
      ['wr1'],
      positionOf,
      { WR: 3, QB: 1, TE: 1 },
      starting1qb,
    );
    expect(result).toEqual(['wr1']);
  });

  it('allows the 1st bench QB once the team already has its starting TE', () => {
    const result = filterByStarterPriority(['qb1'], positionOf, { QB: 1, TE: 1 }, starting1qb);
    expect(result).toEqual(['qb1']);
  });

  it('scales to a 2QB league: a 2nd QB is still a starter, not gated by TE', () => {
    const starting2qb = { QB: 2, RB: 2, WR: 2, TE: 1 };
    // QB count 1 -> nextCount 2, which only reaches starting(QB)=2, not a bench pick yet.
    const result = filterByStarterPriority(['qb1'], positionOf, { QB: 1, TE: 0 }, starting2qb);
    expect(result).toEqual(['qb1']);
  });

  it('scales to a 2QB league: the 1st bench QB (3rd overall) is gated by TE', () => {
    const starting2qb = { QB: 2, RB: 2, WR: 2, TE: 1 };
    const result = filterByStarterPriority(['qb1'], positionOf, { QB: 2, TE: 0 }, starting2qb);
    expect(result).toEqual([]);
  });

  it('never restricts a position with no prerequisite rule, or an unknown position', () => {
    const result = filterByStarterPriority(['rb1', 'def1'], positionOf, { RB: 1, IDP: 99 }, starting1qb);
    expect(result).toEqual(['rb1', 'def1']);
  });

  it('degrades to no restriction when startingSlots is empty (unknown roster_positions)', () => {
    const result = filterByStarterPriority(['wr1', 'qb1'], positionOf, { WR: 10, QB: 0 }, {});
    expect(result).toEqual(['wr1', 'qb1']);
  });

  it('is a no-op below every threshold', () => {
    const result = filterByStarterPriority(
      ['wr1', 'rb1', 'te1', 'qb1'],
      positionOf,
      { WR: 2, RB: 2, TE: 0, QB: 0 },
      starting1qb,
    );
    expect(result).toEqual(['wr1', 'rb1', 'te1', 'qb1']);
  });
});
