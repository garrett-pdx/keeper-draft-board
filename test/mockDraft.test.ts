import { describe, it, expect } from 'vitest';
import { buildMockDraftSlots, bestAvailablePlayer } from '../src/domain/mockDraft';
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
