import { describe, it, expect } from 'vitest';
import {
  sameManagerLastYear,
  potentialKeeperCost,
  isInflatedForRoster,
  getRosterKeeperCosts,
} from '../src/domain/keeperCost';
import type { PlayersMap, PrevDraftEntry, PrevDraftMap } from '../src/types';

const LAST_ROUND = 14;

function entry(over: Partial<PrevDraftEntry> = {}): PrevDraftEntry {
  return { round: 5, rosterId: 1, ownerId: 'ownerA', wasKeeper: false, ...over };
}

describe('sameManagerLastYear', () => {
  it('matches on stable owner id when available', () => {
    expect(sameManagerLastYear(entry({ ownerId: 'ownerA' }), 'ownerA', 99)).toBe(true);
    expect(sameManagerLastYear(entry({ ownerId: 'ownerA' }), 'ownerB', 99)).toBe(false);
  });

  it('falls back to roster id when owner ids are unavailable', () => {
    expect(sameManagerLastYear(entry({ ownerId: null, rosterId: 3 }), null, 3)).toBe(true);
    expect(sameManagerLastYear(entry({ ownerId: null, rosterId: 3 }), null, 4)).toBe(false);
  });

  it('returns false for no prior data', () => {
    expect(sameManagerLastYear(null, 'ownerA', 1)).toBe(false);
  });
});

describe('potentialKeeperCost', () => {
  it('is the prior round for a straight (non-repeat) keep', () => {
    expect(potentialKeeperCost(entry({ round: 5 }), 'ownerB', 1, LAST_ROUND)).toBe(5);
  });

  it('climbs one round for a same-manager repeat keeper', () => {
    const prev = entry({ round: 5, wasKeeper: true, ownerId: 'ownerA' });
    expect(potentialKeeperCost(prev, 'ownerA', 1, LAST_ROUND)).toBe(4);
  });

  it('is floored at round 1 for a round-1 repeat keeper', () => {
    const prev = entry({ round: 1, wasKeeper: true, ownerId: 'ownerA' });
    expect(potentialKeeperCost(prev, 'ownerA', 1, LAST_ROUND)).toBe(1);
  });

  it('does not bump when a different manager kept the player', () => {
    const prev = entry({ round: 5, wasKeeper: true, ownerId: 'ownerA' });
    expect(potentialKeeperCost(prev, 'ownerB', 1, LAST_ROUND)).toBe(5);
  });

  it('costs the final round for an undrafted-last-year player', () => {
    expect(potentialKeeperCost(null, 'ownerA', 1, LAST_ROUND)).toBe(LAST_ROUND);
  });
});

describe('isInflatedForRoster', () => {
  it('is true for a same-team repeat keeper above round 1', () => {
    expect(isInflatedForRoster(entry({ wasKeeper: true }), 'ownerA', 1)).toBe(true);
  });
  it('is false for a straight pick', () => {
    expect(isInflatedForRoster(entry({ wasKeeper: false }), 'ownerA', 1)).toBe(false);
  });
  it('is false for a different team', () => {
    expect(isInflatedForRoster(entry({ wasKeeper: true }), 'ownerB', 1)).toBe(false);
  });
  it('is false at round 1', () => {
    expect(isInflatedForRoster(entry({ wasKeeper: true, round: 1 }), 'ownerA', 1)).toBe(false);
  });
  it('is false with no prior data', () => {
    expect(isInflatedForRoster(null, 'ownerA', 1)).toBe(false);
  });
});

describe('getRosterKeeperCosts (collision handling)', () => {
  const players: PlayersMap = {
    star: { id: 'star', first: 'A', last: 'Star', pos: 'RB', team: 'X', rank: 5 },
    role: { id: 'role', first: 'B', last: 'Role', pos: 'WR', team: 'Y', rank: 40 },
  };

  it('bumps the better-ranked player up a round on a same-round collision', () => {
    const prevDraftMap: PrevDraftMap = {
      star: entry({ round: 5, ownerId: 'ownerA' }),
      role: entry({ round: 5, ownerId: 'ownerA' }),
    };
    const items = getRosterKeeperCosts({
      keeperIds: ['star', 'role'],
      prevDraftMap,
      playersMap: players,
      adpMap: { star: 8, role: 50 },
      ownerId: 'ownerA',
      rosterId: 1,
      lastRound: LAST_ROUND,
      teamCount: 10,
    });
    const star = items.find((i) => i.playerId === 'star')!;
    const role = items.find((i) => i.playerId === 'role')!;
    expect(star.cost).toBe(4);
    expect(star.bumped).toBe(true);
    expect(role.cost).toBe(5);
    expect(role.bumped).toBe(false);
  });

  it('does not bump when the two keepers land on different rounds', () => {
    const prevDraftMap: PrevDraftMap = {
      star: entry({ round: 3, ownerId: 'ownerA' }),
      role: entry({ round: 8, ownerId: 'ownerA' }),
    };
    const items = getRosterKeeperCosts({
      keeperIds: ['star', 'role'],
      prevDraftMap,
      playersMap: players,
      adpMap: { star: 8, role: 50 },
      ownerId: 'ownerA',
      rosterId: 1,
      lastRound: LAST_ROUND,
      teamCount: 10,
    });
    expect(items.every((i) => !i.bumped)).toBe(true);
  });
});
