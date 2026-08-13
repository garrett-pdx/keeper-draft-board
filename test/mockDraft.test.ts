import { describe, it, expect } from 'vitest';
import {
  buildMockDraftSlots,
  bestAvailablePlayer,
  positionCaps,
  filterByPositionCaps,
  dedicatedStarterCounts,
  unfilledStartingSlots,
  filterBenchQbTe,
  filterByRemainingNeeds,
  mockDraftCaps,
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

describe('dedicatedStarterCounts', () => {
  it('returns nothing when roster_positions is unknown, rather than guessing', () => {
    expect(dedicatedStarterCounts(null)).toEqual({});
    expect(dedicatedStarterCounts(undefined)).toEqual({});
    expect(dedicatedStarterCounts([])).toEqual({});
  });

  it('counts only dedicated slots — a generic FLEX is not a TE start', () => {
    const rosterPositions = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'DEF'];
    // Contrast with positionCaps, which credits TE with all three FLEX slots.
    expect(dedicatedStarterCounts(rosterPositions)).toEqual({ QB: 1, TE: 1 });
  });

  it('counts SUPER_FLEX as a real QB start', () => {
    expect(dedicatedStarterCounts(['QB', 'SUPER_FLEX', 'TE', 'FLEX'])).toEqual({ QB: 2, TE: 1 });
  });

  it('counts a 2QB lineup’s second QB as a starter', () => {
    expect(dedicatedStarterCounts(['QB', 'QB', 'TE'])).toEqual({ QB: 2, TE: 1 });
  });

  it('reports 0 for a position this league never starts', () => {
    expect(dedicatedStarterCounts(['QB', 'RB', 'WR', 'FLEX'])).toEqual({ QB: 1, TE: 0 });
  });
});

// A Mudd-shaped lineup: 9 startable slots once DEF is set aside.
const MUDD = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'DEF', 'BN', 'BN'];

describe('unfilledStartingSlots', () => {
  it('counts every startable slot for an empty roster, DEF/K and bench excluded', () => {
    expect(unfilledStartingSlots(MUDD, {})).toBe(9);
  });

  it('is 0 once a legal lineup can be fielded', () => {
    // 1 QB, 2 RB, 2 WR, 1 TE + 3 more RB/WR covering the FLEX slots.
    expect(unfilledStartingSlots(MUDD, { QB: 1, RB: 4, WR: 3, TE: 1 })).toBe(0);
  });

  it('lets RB/WR overflow consume the FLEX slots', () => {
    // 7 RB/WR fill RB,RB,WR,WR + all 3 FLEX; only QB and TE remain.
    expect(unfilledStartingSlots(MUDD, { RB: 4, WR: 3 })).toBe(2);
  });

  it('reports exactly the missing slot when only a QB is absent', () => {
    expect(unfilledStartingSlots(MUDD, { RB: 4, WR: 3, TE: 1 })).toBe(1);
  });

  it('counts a TE toward a FLEX slot — a legal lineup question, not a bench one', () => {
    // 2 TEs: one starts at TE, the other legitimately fills a FLEX.
    expect(unfilledStartingSlots(MUDD, { QB: 1, RB: 4, WR: 2, TE: 2 })).toBe(0);
  });

  it('degrades to 0 (no restriction) when roster_positions is unknown', () => {
    expect(unfilledStartingSlots(null, {})).toBe(0);
    expect(unfilledStartingSlots([], { QB: 1 })).toBe(0);
  });

  it('counts the 3rd RB and 3rd WR as FLEX starters, not bench players', () => {
    // The canonical worked example: [QB, RB, RB, WR, WR, FLEX, FLEX] with 3 RB
    // and 3 WR drafted. The two FLEX slots absorb the third of each, so all six
    // are starters and the only thing still missing is the quarterback.
    const lineup = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX'];
    expect(unfilledStartingSlots(lineup, { RB: 3, WR: 3 })).toBe(1);
    // Add the QB and nothing at all is outstanding.
    expect(unfilledStartingSlots(lineup, { QB: 1, RB: 3, WR: 3 })).toBe(0);
    // A 4th RB would be the first genuine bench player.
    expect(unfilledStartingSlots(lineup, { QB: 1, RB: 4, WR: 3 })).toBe(0);
  });
});

describe('filterBenchQbTe', () => {
  const positions: Record<string, string> = { qb: 'QB', te: 'TE', rb: 'RB', wr: 'WR' };
  const positionOf = (pid: string) => positions[pid];
  const dedicated = { QB: 1, TE: 1 };
  const all = ['qb', 'te', 'rb', 'wr'];

  it('blocks a 2nd QB and 2nd TE while a starting slot is unfilled', () => {
    const counts = { QB: 1, TE: 1, RB: 2, WR: 2 }; // FLEX slots still empty
    expect(filterBenchQbTe(all, positionOf, counts, MUDD, dedicated)).toEqual(['rb', 'wr']);
  });

  it('always allows the first QB and TE, however early', () => {
    expect(filterBenchQbTe(all, positionOf, {}, MUDD, dedicated)).toEqual(all);
  });

  it('never gates RB/WR, however many the roster holds', () => {
    const counts = { RB: 6, WR: 6 };
    const result = filterBenchQbTe(['rb', 'wr'], positionOf, counts, MUDD, dedicated);
    expect(result).toEqual(['rb', 'wr']);
  });

  it('is a no-op once every starting slot is filled', () => {
    const counts = { QB: 1, RB: 4, WR: 3, TE: 1 };
    expect(filterBenchQbTe(all, positionOf, counts, MUDD, dedicated)).toEqual(all);
  });

  it('treats a 2QB league’s second QB as a starter, not a bench player', () => {
    const twoQb = ['QB', 'QB', 'RB', 'WR', 'TE', 'FLEX'];
    const result = filterBenchQbTe(['qb'], positionOf, { QB: 1 }, twoQb, { QB: 2, TE: 1 });
    expect(result).toEqual(['qb']);
  });

  it('degrades to no restriction when roster_positions is unknown', () => {
    expect(filterBenchQbTe(all, positionOf, { QB: 5, TE: 5 }, null, {})).toEqual(all);
  });
});

describe('filterByRemainingNeeds', () => {
  const positions: Record<string, string> = { def: 'DEF', k: 'K', rb: 'RB' };
  const positionOf = (pid: string) => positions[pid];
  const all = ['def', 'k', 'rb'];

  it('keeps DEF/K out of the pool while other picks remain', () => {
    expect(filterByRemainingNeeds(all, positionOf, {}, MUDD, 5)).toEqual(['rb']);
  });

  it('returns only the still-needed DEF/K on the roster’s final pick', () => {
    expect(filterByRemainingNeeds(all, positionOf, {}, MUDD, 1)).toEqual(['def']);
  });

  it('reserves two picks in a league that starts both a DEF and a K', () => {
    const withK = [...MUDD, 'K'];
    expect(filterByRemainingNeeds(all, positionOf, {}, withK, 3)).toEqual(['rb']);
    expect(filterByRemainingNeeds(all, positionOf, {}, withK, 2)).toEqual(['def', 'k']);
  });

  it('stops offering a slot the roster has already filled', () => {
    const withK = [...MUDD, 'K'];
    expect(filterByRemainingNeeds(all, positionOf, { DEF: 1 }, withK, 1)).toEqual(['k']);
  });

  it('excludes DEF/K entirely in a league that starts neither', () => {
    const noDefK = ['QB', 'RB', 'WR', 'TE', 'FLEX'];
    expect(filterByRemainingNeeds(all, positionOf, {}, noDefK, 1)).toEqual(['rb']);
  });

  it('degrades to no restriction when roster_positions is unknown', () => {
    expect(filterByRemainingNeeds(all, positionOf, {}, null, 1)).toEqual(all);
  });

  // --- the late-round starter safety net ---
  // Positions beyond the DEF/K set, so the middle tier has something to sort.
  const roster: Record<string, string> = { qb: 'QB', te: 'TE', rb2: 'RB', wr: 'WR', def2: 'DEF' };
  const rosterOf = (pid: string) => roster[pid];
  const pool = ['qb', 'te', 'rb2', 'wr', 'def2'];
  // A lineup one tight end short of complete: QB + 2 RB + 2 WR + 3 FLEX filled.
  const needsTeOnly = { QB: 1, RB: 4, WR: 3 };

  it('leaves the middle rounds alone while there is room to spare', () => {
    // 9 picks left, 1 slot open — plenty of slack, so bench RB/WR stay legal.
    expect(filterByRemainingNeeds(pool, rosterOf, needsTeOnly, MUDD, 9).sort()).toEqual(
      ['qb', 'rb2', 'te', 'wr'].sort(),
    );
  });

  it('restricts to slot-filling positions once picks run down to what is still needed', () => {
    // 2 picks left: one owed to DEF, one to the missing TE. Only a TE qualifies.
    expect(filterByRemainingNeeds(pool, rosterOf, needsTeOnly, MUDD, 2)).toEqual(['te']);
  });

  it('still takes the defense last when a team is short a starter and a DEF at once', () => {
    // The pick after the one above: nothing left but the defense.
    const withTe = { ...needsTeOnly, TE: 1 };
    expect(filterByRemainingNeeds(pool, rosterOf, withTe, MUDD, 1)).toEqual(['def2']);
  });

  it('frees up bench picks again once the lineup is complete', () => {
    // Lineup full, DEF already in hand: no reservation left to make.
    const complete = { QB: 1, RB: 4, WR: 3, TE: 1, DEF: 1 };
    expect(filterByRemainingNeeds(pool, rosterOf, complete, MUDD, 2).sort()).toEqual(
      ['qb', 'rb2', 'te', 'wr'].sort(),
    );
  });

  it('offers every open position when several slots are still unfilled', () => {
    // No QB and no TE, 3 picks left (1 owed to DEF) — both qualify, RB/WR don't.
    const needsQbAndTe = { RB: 4, WR: 3 };
    expect(filterByRemainingNeeds(pool, rosterOf, needsQbAndTe, MUDD, 3).sort()).toEqual(
      ['qb', 'te'].sort(),
    );
  });
});

describe('mockDraftCaps', () => {
  it('caps QB/TE at twice what the league starts, leaving RB/WR on the base formula', () => {
    expect(mockDraftCaps(MUDD)).toEqual({
      QB: 2, // 2 x 1 dedicated start, not 1 + 2 buffer
      RB: 7, // unchanged: 2 starters + 3 FLEX + 2 buffer
      WR: 7, // unchanged
      TE: 2, // 2 x 1 dedicated start, not 1 + 3 FLEX + 2 buffer
      K: 2,
      DEF: 3,
    });
  });

  it('scales QB with a 2QB lineup', () => {
    const twoQb = ['QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'DEF'];
    expect(mockDraftCaps(twoQb).QB).toBe(4);
    expect(mockDraftCaps(twoQb).TE).toBe(2);
  });

  it('counts SUPER_FLEX toward the QB cap', () => {
    expect(mockDraftCaps(['QB', 'SUPER_FLEX', 'RB', 'WR', 'TE', 'FLEX']).QB).toBe(4);
  });

  it('leaves a position with no dedicated slot on the FLEX-credited cap, never 0', () => {
    // No TE slot: a tight end is a pure FLEX asset, so 2 x 0 must not apply.
    const noTe = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'DEF'];
    expect(mockDraftCaps(noTe).TE).toBe(4); // 0 starters + 2 FLEX + 2 buffer
  });

  it('returns no caps when roster_positions is unknown', () => {
    expect(mockDraftCaps(null)).toEqual({});
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
