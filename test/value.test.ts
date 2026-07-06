import { describe, it, expect } from 'vitest';
import {
  pickValue,
  marketPickFor,
  keeperSurplusValue,
  VALUE_DECAY,
  NO_ADP_VALUE,
} from '../src/domain/value';
import type { AdpMap } from '../src/types';

describe('pickValue', () => {
  it('is 100 at the first pick', () => {
    expect(pickValue(1)).toBe(100);
  });

  it('decays by VALUE_DECAY per pick', () => {
    expect(pickValue(2)).toBeCloseTo(100 * VALUE_DECAY, 10);
    expect(pickValue(3)).toBeCloseTo(100 * VALUE_DECAY * VALUE_DECAY, 10);
  });

  it('is strictly decreasing and stays positive in late rounds', () => {
    expect(pickValue(1)).toBeGreaterThan(pickValue(50));
    expect(pickValue(150)).toBeGreaterThan(0);
  });
});

describe('marketPickFor', () => {
  const adp: AdpMap = { a: 12.5, b: 0, c: 9999, d: -3 };
  it('returns the ADP when present and valid', () => {
    expect(marketPickFor('a', adp)).toBe(12.5);
  });
  it('returns null for missing, zero, sentinel, or negative ADP', () => {
    expect(marketPickFor('missing', adp)).toBeNull();
    expect(marketPickFor('b', adp)).toBeNull();
    expect(marketPickFor('c', adp)).toBeNull();
    expect(marketPickFor('d', adp)).toBeNull();
  });
});

describe('keeperSurplusValue', () => {
  const teams = 10;

  it('flags no-ADP players with the sentinel and hasAdp=false', () => {
    const sv = keeperSurplusValue('x', 14, {}, teams);
    expect(sv).toEqual({ value: NO_ADP_VALUE, hasAdp: false });
  });

  it('gives a large positive surplus for an elite player kept cheaply', () => {
    // ADP pick 1, cost round 14 -> deep, cheap cost pick
    const sv = keeperSurplusValue('elite', 14, { elite: 1 }, teams);
    expect(sv.hasAdp).toBe(true);
    expect(sv.value).toBeGreaterThan(50);
  });

  it('gives a small positive surplus for a late-round steal', () => {
    const sv = keeperSurplusValue('deep', 14, { deep: 120 }, teams);
    expect(sv.value).toBeGreaterThan(0);
    expect(sv.value).toBeLessThan(10);
  });

  it('goes negative when the keeper costs more than market', () => {
    // ADP pick 100 but cost round 1 (cost pick ~5)
    const sv = keeperSurplusValue('overpriced', 1, { overpriced: 100 }, teams);
    expect(sv.value).toBeLessThan(0);
  });

  it('defaults to 10 teams when teamCount is falsy', () => {
    const a = keeperSurplusValue('p', 5, { p: 10 }, 0);
    const b = keeperSurplusValue('p', 5, { p: 10 }, 10);
    expect(a.value).toBe(b.value);
  });

  it('matches the round-midpoint approximation when exactCostPick is omitted (regression)', () => {
    const withoutExact = keeperSurplusValue('p', 5, { p: 10 }, teams);
    const withUndefined = keeperSurplusValue('p', 5, { p: 10 }, teams, undefined);
    const withNull = keeperSurplusValue('p', 5, { p: 10 }, teams, null);
    expect(withUndefined).toEqual(withoutExact);
    expect(withNull).toEqual(withoutExact);
  });

  it('uses the exact pick number instead of the midpoint when provided', () => {
    // round 5 midpoint pick would be round*teams - teams/2 = 45; an exact
    // pick of 41 (this team picks earlier in the round) should be cheaper
    // to keep, i.e. a lower surplus value than the midpoint approximation.
    const approx = keeperSurplusValue('p', 5, { p: 10 }, teams);
    const exact = keeperSurplusValue('p', 5, { p: 10 }, teams, 41);
    expect(exact.value).not.toBe(approx.value);
    expect(exact.hasAdp).toBe(true);
  });
});
