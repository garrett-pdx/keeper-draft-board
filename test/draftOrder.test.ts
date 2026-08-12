import { describe, it, expect } from 'vitest';
import {
  hasKnownDraftOrder,
  slotForRoster,
  exactPickNumber,
  exactPickForRoster,
  pickWasAcquiredViaTrade,
  orderRosterIdsBySlot,
} from '../src/domain/draftOrder';
import type { SleeperDraft } from '../src/api/schemas';

// Captured live from the real Sleeper API during planning.
const PRE_DRAFT: SleeperDraft = {
  draft_id: '1312235880760479744',
  type: 'snake',
  draft_order: null, // commissioner hasn't set the order yet
  slot_to_roster_id: {
    '1': 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
    '10': 10,
  },
  settings: { rounds: 14 },
};

const COMPLETE_DRAFT: SleeperDraft = {
  draft_id: '1257452519521517571',
  type: 'snake',
  draft_order: {
    '605683461667229696': 6,
    '611630747161358336': 8,
    '611649934390870016': 1,
    '611664340277383168': 3,
    '611697269254791168': 2,
    '612407006212468736': 10,
    '76909640692416512': 5,
    '850475150817234944': 7,
    '870570674836656128': 4,
    '999190763323944960': 9,
  },
  slot_to_roster_id: {
    '1': 9,
    '2': 2,
    '3': 4,
    '4': 5,
    '5': 1,
    '6': 3,
    '7': 10,
    '8': 7,
    '9': 8,
    '10': 6,
  },
  settings: { rounds: 14 },
};

describe('hasKnownDraftOrder', () => {
  it('is false for the pre-draft placeholder (identity slot_to_roster_id, draft_order null)', () => {
    expect(hasKnownDraftOrder(PRE_DRAFT)).toBe(false);
  });

  it('is true for a completed draft with a real order', () => {
    expect(hasKnownDraftOrder(COMPLETE_DRAFT)).toBe(true);
  });

  it('is false for null/undefined', () => {
    expect(hasKnownDraftOrder(null)).toBe(false);
    expect(hasKnownDraftOrder(undefined)).toBe(false);
  });

  it('is false for a non-snake draft type', () => {
    expect(hasKnownDraftOrder({ ...COMPLETE_DRAFT, type: 'linear' })).toBe(false);
  });

  it('is false when slot_to_roster_id is missing even if draft_order is present', () => {
    expect(hasKnownDraftOrder({ ...COMPLETE_DRAFT, slot_to_roster_id: null })).toBe(false);
  });
});

describe('slotForRoster', () => {
  it('finds the slot for a known roster_id', () => {
    expect(slotForRoster(COMPLETE_DRAFT.slot_to_roster_id as Record<string, number>, 9)).toBe(1);
    expect(slotForRoster(COMPLETE_DRAFT.slot_to_roster_id as Record<string, number>, 6)).toBe(10);
  });

  it('returns null for an unknown roster_id', () => {
    expect(
      slotForRoster(COMPLETE_DRAFT.slot_to_roster_id as Record<string, number>, 999),
    ).toBeNull();
  });
});

describe('exactPickNumber', () => {
  it('keeps slot order in odd (round 1) rounds', () => {
    expect(exactPickNumber(1, 1, 10)).toBe(1);
    expect(exactPickNumber(1, 10, 10)).toBe(10);
  });

  it('reverses slot order in even rounds (snake)', () => {
    expect(exactPickNumber(2, 1, 10)).toBe(20);
    expect(exactPickNumber(2, 10, 10)).toBe(11);
  });

  it('continues correctly into round 3 (odd again)', () => {
    expect(exactPickNumber(3, 1, 10)).toBe(21);
    expect(exactPickNumber(3, 10, 10)).toBe(30);
  });

  it('returns null for out-of-range slot/round/teamCount', () => {
    expect(exactPickNumber(0, 1, 10)).toBeNull();
    expect(exactPickNumber(1, 0, 10)).toBeNull();
    expect(exactPickNumber(1, 11, 10)).toBeNull();
    expect(exactPickNumber(1, 1, 0)).toBeNull();
  });
});

describe('exactPickForRoster', () => {
  it('resolves the exact pick using a completed draft’s real order', () => {
    // roster 9 holds slot 1 -> round 1 pick 1, round 2 pick 20
    expect(exactPickForRoster(COMPLETE_DRAFT, 9, 1, 10)).toBe(1);
    expect(exactPickForRoster(COMPLETE_DRAFT, 9, 2, 10)).toBe(20);
  });

  it('returns null against the pre-draft placeholder (order not actually known)', () => {
    expect(exactPickForRoster(PRE_DRAFT, 1, 1, 10)).toBeNull();
  });

  it('returns null for a roster not present in slot_to_roster_id', () => {
    expect(exactPickForRoster(COMPLETE_DRAFT, 999, 1, 10)).toBeNull();
  });

  it('returns null when the draft is null/undefined', () => {
    expect(exactPickForRoster(null, 1, 1, 10)).toBeNull();
    expect(exactPickForRoster(undefined, 1, 1, 10)).toBeNull();
  });
});

describe('pickWasAcquiredViaTrade', () => {
  // Real case this exists for: roster 1's natural slot is 5 (see
  // COMPLETE_DRAFT.slot_to_roster_id), but they drafted Jayden Daniels from
  // draft_slot 10 (roster 6's original slot, acquired via trade) — confirmed
  // live against the real 2025 Mudd League draft, where Sleeper's own
  // is_keeper flag came back null for that exact pick despite it genuinely
  // being a keeper.
  it('is true when the pick came from a different slot than the roster’s own', () => {
    expect(pickWasAcquiredViaTrade(COMPLETE_DRAFT, 1, 10)).toBe(true);
  });

  it('is false when the pick came from the roster’s own natural slot', () => {
    expect(pickWasAcquiredViaTrade(COMPLETE_DRAFT, 1, 5)).toBe(false);
  });

  it('is false against the pre-draft placeholder (order not actually known)', () => {
    expect(pickWasAcquiredViaTrade(PRE_DRAFT, 1, 10)).toBe(false);
  });

  it('is false when draft is null/undefined', () => {
    expect(pickWasAcquiredViaTrade(null, 1, 10)).toBe(false);
    expect(pickWasAcquiredViaTrade(undefined, 1, 10)).toBe(false);
  });

  it('is false when draftSlot is null/undefined (never guesses)', () => {
    expect(pickWasAcquiredViaTrade(COMPLETE_DRAFT, 1, null)).toBe(false);
    expect(pickWasAcquiredViaTrade(COMPLETE_DRAFT, 1, undefined)).toBe(false);
  });

  it('is false for a roster not present in slot_to_roster_id', () => {
    expect(pickWasAcquiredViaTrade(COMPLETE_DRAFT, 999, 10)).toBe(false);
  });
});

describe('orderRosterIdsBySlot', () => {
  it('reorders roster ids by real slot ascending when the order is known', () => {
    // COMPLETE_DRAFT.slot_to_roster_id: slot 1->9, 2->2, 3->4, 4->5, 5->1,
    // 6->3, 7->10, 8->7, 9->8, 10->6.
    const rosterIdOrder = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    expect(orderRosterIdsBySlot(COMPLETE_DRAFT, rosterIdOrder)).toEqual([
      '9',
      '2',
      '4',
      '5',
      '1',
      '3',
      '10',
      '7',
      '8',
      '6',
    ]);
  });

  it('appends a roster id missing from slot_to_roster_id at the end, in its original relative order', () => {
    const result = orderRosterIdsBySlot(COMPLETE_DRAFT, ['999', '9', '2']);
    expect(result).toEqual(['9', '2', '999']);
  });

  it('returns the given order unchanged against the pre-draft placeholder', () => {
    const order = ['3', '1', '2'];
    expect(orderRosterIdsBySlot(PRE_DRAFT, order)).toEqual(order);
  });

  it('returns the given order unchanged when draft is null/undefined', () => {
    const order = ['3', '1', '2'];
    expect(orderRosterIdsBySlot(null, order)).toEqual(order);
    expect(orderRosterIdsBySlot(undefined, order)).toEqual(order);
  });

  it('returns an empty array for an empty input', () => {
    expect(orderRosterIdsBySlot(COMPLETE_DRAFT, [])).toEqual([]);
  });
});
