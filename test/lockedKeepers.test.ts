import { describe, it, expect } from 'vitest';
import {
  buildLockedKeepers,
  keepersAreLocked,
  lockedKeeperCosts,
  type RawKeeperPick,
} from '../src/domain/lockedKeepers';
import type { PlayersMap, PrevDraftMap } from '../src/types';

// Shape captured live from the real Mudd 2026 draft room
// (draft_id 1312235880760479744), where 20 keeper preassignments sat in a
// draft still reading status 'pre_draft'.
const PICKS: RawKeeperPick[] = [
  { player_id: '9221', round: 1, roster_id: 4, is_keeper: true, pick_no: 8 },
  { player_id: '4034', round: 7, roster_id: 4, is_keeper: true, pick_no: 68 },
  { player_id: '9509', round: 1, roster_id: 9, is_keeper: true, pick_no: 9 },
];

const PLAYERS: PlayersMap = {
  '9221': {
    id: '9221',
    first: 'Jahmyr',
    last: 'Gibbs',
    pos: 'RB',
    team: 'DET',
    rank: 3,
    birthDate: null,
    espnId: null,
  },
};

describe('buildLockedKeepers', () => {
  it('groups keeper picks by roster, in pick order', () => {
    const map = buildLockedKeepers(PICKS);
    expect(Object.keys(map).sort()).toEqual(['4', '9']);
    expect(map['4'].map((k) => k.playerId)).toEqual(['9221', '4034']);
    expect(map['4'][0]).toEqual({ playerId: '9221', rosterId: 4, round: 1, pickNo: 8 });
  });

  it('ignores ordinary picks once the draft actually runs', () => {
    const map = buildLockedKeepers([
      ...PICKS,
      { player_id: 'x1', round: 1, roster_id: 4, is_keeper: false, pick_no: 1 },
      { player_id: 'x2', round: 1, roster_id: 4, pick_no: 2 },
    ]);
    expect(map['4'].map((k) => k.playerId)).toEqual(['9221', '4034']);
  });

  it('skips picks with no player', () => {
    expect(buildLockedKeepers([{ round: 1, roster_id: 4, is_keeper: true }])).toEqual({});
  });

  it('tolerates a missing pick_no by ordering on round', () => {
    const map = buildLockedKeepers([
      { player_id: 'b', round: 9, roster_id: 1, is_keeper: true },
      { player_id: 'a', round: 2, roster_id: 1, is_keeper: true },
    ]);
    expect(map['1'].map((k) => k.playerId)).toEqual(['a', 'b']);
  });
});

describe('keepersAreLocked', () => {
  it('is true once any keeper has been entered', () => {
    expect(keepersAreLocked(buildLockedKeepers(PICKS))).toBe(true);
  });

  it('is false before the deadline, when the draft room holds nothing', () => {
    expect(keepersAreLocked(buildLockedKeepers([]))).toBe(false);
    expect(keepersAreLocked(null)).toBe(false);
    expect(keepersAreLocked(undefined)).toBe(false);
  });
});

describe('lockedKeeperCosts', () => {
  const base = {
    prevDraftMap: {} as PrevDraftMap,
    playersMap: PLAYERS,
    adpMap: { '9221': 5 },
    ownerId: 'ownerA',
    rosterId: 4,
    lastRound: 14,
    teamCount: 10,
    inflationRounds: 1,
    noKeeperCost: false,
  };
  const locked = [{ playerId: '9221', rosterId: 4, round: 1, pickNo: 8 }];

  it('takes Sleeper’s round as the cost verbatim', () => {
    const [item] = lockedKeeperCosts({ ...base, locked });
    expect(item.cost).toBe(1);
    expect(item.consumedPick).toBe(8);
    expect(item.fromSleeper).toBe(true);
  });

  it('never bumps or refuses a locked keeper — it already has its pick', () => {
    const [item] = lockedKeeperCosts({ ...base, locked });
    expect(item.bumped).toBe(false);
    expect(item.cannotBeKept).toBe(false);
  });

  it('stays silent when this app’s rules agree with Sleeper', () => {
    // Drafted round 1 last year by another manager -> app expects round 1 too.
    const prevDraftMap: PrevDraftMap = {
      '9221': { round: 1, rosterId: 7, ownerId: 'ownerB', wasKeeper: false },
    };
    const [item] = lockedKeeperCosts({ ...base, locked, prevDraftMap });
    expect(item.base).toBe(1);
    expect(item.expectedCost).toBeNull();
  });

  it('records the app’s own round when the two disagree, without overriding Sleeper', () => {
    // Same manager kept him from round 5 last year, so the app's rules say
    // round 4 — but Sleeper has him in round 1, and Sleeper wins.
    const prevDraftMap: PrevDraftMap = {
      '9221': { round: 5, rosterId: 4, ownerId: 'ownerA', wasKeeper: true },
    };
    const [item] = lockedKeeperCosts({ ...base, locked, prevDraftMap });
    expect(item.cost).toBe(1);
    expect(item.expectedCost).toBe(4);
  });

  it('spends no pick in a taxi-squad league, where the league rule still wins on cost', () => {
    const [item] = lockedKeeperCosts({ ...base, locked, noKeeperCost: true });
    expect(item.taxiSquad).toBe(true);
    expect(item.consumedPick).toBeNull();
    expect(item.expectedCost).toBeNull();
  });

  it('returns nothing for a team with no locked keepers', () => {
    expect(lockedKeeperCosts({ ...base, locked: [] })).toEqual([]);
  });
});
