import { describe, it, expect } from 'vitest';
import { pickCapacity, heldPickOriginalOwners, type TradedPicksList } from '../src/domain/tradedPicks';

// Captured live from the real Sleeper API (this test league's actual 2026
// draft, draft_id 1312235880760479744): roster 1 and roster 8 swapped their
// round 4 and round 7 picks with each other.
const REAL_TRADED_PICKS: TradedPicksList = [
  { round: 4, season: '2026', rosterId: 1, ownerId: 8, previousOwnerId: 1 },
  { round: 7, season: '2026', rosterId: 8, ownerId: 1, previousOwnerId: 8 },
];

describe('pickCapacity', () => {
  it('defaults to 1 for an untouched round/roster', () => {
    expect(pickCapacity(REAL_TRADED_PICKS, 5, 1)).toBe(1);
    expect(pickCapacity(REAL_TRADED_PICKS, 4, 2)).toBe(1);
  });

  it('matches the real captured trade data', () => {
    expect(pickCapacity(REAL_TRADED_PICKS, 4, 1)).toBe(0); // gave away round 4
    expect(pickCapacity(REAL_TRADED_PICKS, 4, 8)).toBe(2); // gained an extra round 4
    expect(pickCapacity(REAL_TRADED_PICKS, 7, 8)).toBe(0); // gave away round 7
    expect(pickCapacity(REAL_TRADED_PICKS, 7, 1)).toBe(2); // gained an extra round 7
  });

  it('sums correctly for a roster with multiple incoming picks in one round', () => {
    const trades: TradedPicksList = [
      { round: 3, season: '2026', rosterId: 2, ownerId: 1, previousOwnerId: 2 },
      { round: 3, season: '2026', rosterId: 5, ownerId: 1, previousOwnerId: 5 },
    ];
    expect(pickCapacity(trades, 3, 1)).toBe(3); // own + 2 acquired
  });

  it('never goes negative', () => {
    // a roster can only ever lose its own single original pick per round
    expect(pickCapacity(REAL_TRADED_PICKS, 4, 1)).toBeGreaterThanOrEqual(0);
  });

  it('does not cross-contaminate other rounds or rosters', () => {
    expect(pickCapacity(REAL_TRADED_PICKS, 5, 8)).toBe(1);
    expect(pickCapacity(REAL_TRADED_PICKS, 4, 3)).toBe(1);
  });
});

describe('heldPickOriginalOwners', () => {
  it('returns just the roster itself by default', () => {
    expect(heldPickOriginalOwners(REAL_TRADED_PICKS, 5, 1)).toEqual([1]);
  });

  it('returns empty when the roster traded its own pick away with nothing offsetting it', () => {
    expect(heldPickOriginalOwners(REAL_TRADED_PICKS, 4, 1)).toEqual([]);
  });

  it('returns both original owners when a roster holds an acquired pick alongside its own', () => {
    expect(heldPickOriginalOwners(REAL_TRADED_PICKS, 7, 1)).toEqual([1, 8]);
  });
});
