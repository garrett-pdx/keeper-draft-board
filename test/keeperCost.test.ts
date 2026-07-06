import { describe, it, expect } from 'vitest';
import {
  sameManagerLastYear,
  potentialKeeperCost,
  isInflatedForRoster,
  getRosterKeeperCosts,
} from '../src/domain/keeperCost';
import type { PlayersMap, PrevDraftEntry, PrevDraftMap } from '../src/types';

const LAST_ROUND = 14;
const INFLATION = 1;

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
    expect(potentialKeeperCost(entry({ round: 5 }), 'ownerB', 1, LAST_ROUND, INFLATION)).toBe(5);
  });

  it('climbs one round for a same-manager repeat keeper', () => {
    const prev = entry({ round: 5, wasKeeper: true, ownerId: 'ownerA' });
    expect(potentialKeeperCost(prev, 'ownerA', 1, LAST_ROUND, INFLATION)).toBe(4);
  });

  it('is floored at round 1 for a round-1 repeat keeper', () => {
    const prev = entry({ round: 1, wasKeeper: true, ownerId: 'ownerA' });
    expect(potentialKeeperCost(prev, 'ownerA', 1, LAST_ROUND, INFLATION)).toBe(1);
  });

  it('does not bump when a different manager kept the player', () => {
    const prev = entry({ round: 5, wasKeeper: true, ownerId: 'ownerA' });
    expect(potentialKeeperCost(prev, 'ownerB', 1, LAST_ROUND, INFLATION)).toBe(5);
  });

  it('costs the final round for an undrafted-last-year player', () => {
    expect(potentialKeeperCost(null, 'ownerA', 1, LAST_ROUND, INFLATION)).toBe(LAST_ROUND);
  });

  it('honors a configured inflation amount greater than 1', () => {
    const prev = entry({ round: 5, wasKeeper: true, ownerId: 'ownerA' });
    expect(potentialKeeperCost(prev, 'ownerA', 1, LAST_ROUND, 3)).toBe(2);
  });

  it('floors at round 1 even when the inflation amount would overshoot', () => {
    const prev = entry({ round: 2, wasKeeper: true, ownerId: 'ownerA' });
    expect(potentialKeeperCost(prev, 'ownerA', 1, LAST_ROUND, 3)).toBe(1);
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
    mid: { id: 'mid', first: 'C', last: 'Mid', pos: 'WR', team: 'Z', rank: 20 },
    deep: { id: 'deep', first: 'D', last: 'Deep', pos: 'TE', team: 'W', rank: 80 },
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
      inflationRounds: INFLATION,
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
      inflationRounds: INFLATION,
    });
    expect(items.every((i) => !i.bumped)).toBe(true);
  });

  it('cascades a 3-way collision: best two bump, worst-ranked keeps the round', () => {
    // star (rank 5), mid (rank 20), role (rank 40) all land on round 5.
    const prevDraftMap: PrevDraftMap = {
      star: entry({ round: 5, ownerId: 'ownerA' }),
      mid: entry({ round: 5, ownerId: 'ownerA' }),
      role: entry({ round: 5, ownerId: 'ownerA' }),
    };
    const items = getRosterKeeperCosts({
      keeperIds: ['star', 'mid', 'role'],
      prevDraftMap,
      playersMap: players,
      adpMap: { star: 8, mid: 30, role: 50 },
      ownerId: 'ownerA',
      rosterId: 1,
      lastRound: LAST_ROUND,
      teamCount: 10,
      inflationRounds: INFLATION,
    });
    const byId = Object.fromEntries(items.map((i) => [i.playerId, i]));
    // star bumps first to round 4, then would collide with nothing there,
    // mid bumps to round 4... but star already moved, so mid should cascade
    // to check against star's new position too. Best-ranked ends up cheapest.
    expect(byId.role.cost).toBe(5);
    expect(byId.role.bumped).toBe(false);
    expect(byId.mid.cost).toBe(4);
    expect(byId.mid.bumped).toBe(true);
    expect(byId.star.cost).toBe(3);
    expect(byId.star.bumped).toBe(true);
  });

  it('cascades a 4-way collision without any two items sharing a final round', () => {
    const prevDraftMap: PrevDraftMap = {
      star: entry({ round: 5, ownerId: 'ownerA' }),
      mid: entry({ round: 5, ownerId: 'ownerA' }),
      role: entry({ round: 5, ownerId: 'ownerA' }),
      deep: entry({ round: 5, ownerId: 'ownerA' }),
    };
    const items = getRosterKeeperCosts({
      keeperIds: ['star', 'mid', 'role', 'deep'],
      prevDraftMap,
      playersMap: players,
      adpMap: { star: 8, mid: 30, role: 50, deep: 90 },
      ownerId: 'ownerA',
      rosterId: 1,
      lastRound: LAST_ROUND,
      teamCount: 10,
      inflationRounds: INFLATION,
    });
    const costs = items.map((i) => i.cost).sort((a, b) => a - b);
    expect(costs).toEqual([2, 3, 4, 5]);
    expect(items.every((i) => !i.unresolvedCollision)).toBe(true);
  });

  it('marks unresolvedCollision when a bump chain hits the round-1 floor', () => {
    const prevDraftMap: PrevDraftMap = {
      star: entry({ round: 1, ownerId: 'ownerA' }),
      role: entry({ round: 1, ownerId: 'ownerA' }),
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
      inflationRounds: INFLATION,
    });
    const star = items.find((i) => i.playerId === 'star')!;
    const role = items.find((i) => i.playerId === 'role')!;
    expect(star.cost).toBe(1);
    expect(star.unresolvedCollision).toBe(true);
    expect(role.cost).toBe(1);
    expect(role.unresolvedCollision).toBe(false);
  });

  it('uses the exact pick number when a known draft order is passed via ctx.draft', () => {
    const prevDraftMap: PrevDraftMap = { star: entry({ round: 5, ownerId: 'ownerA' }) };
    const draft = {
      type: 'snake',
      draft_order: { u1: 1 },
      slot_to_roster_id: { '1': 1 },
    };
    const withoutDraft = getRosterKeeperCosts({
      keeperIds: ['star'],
      prevDraftMap,
      playersMap: players,
      adpMap: { star: 8 },
      ownerId: 'ownerA',
      rosterId: 1,
      lastRound: LAST_ROUND,
      teamCount: 10,
      inflationRounds: INFLATION,
    });
    const withDraft = getRosterKeeperCosts({
      keeperIds: ['star'],
      prevDraftMap,
      playersMap: players,
      adpMap: { star: 8 },
      ownerId: 'ownerA',
      rosterId: 1,
      lastRound: LAST_ROUND,
      teamCount: 10,
      inflationRounds: INFLATION,
      draft,
    });
    // same cost round in both cases, but value differs because the exact
    // pick (round 4, slot 1 -> pick 31 in a 10-team snake) differs from the
    // round-midpoint approximation used when no draft order is supplied.
    expect(withoutDraft[0].cost).toBe(withDraft[0].cost);
    expect(withoutDraft[0].value).not.toBe(withDraft[0].value);
  });
});
