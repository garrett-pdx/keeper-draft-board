import { describe, it, expect } from 'vitest';
import { seededRoll, samplePlayer, ROLL_PICK, ROLL_DOUBLE_UP } from '../src/domain/draftAi';
import { bestAvailablePlayer } from '../src/domain/mockDraft';
import { MUDD_ROUND_BANDS, positionWeightsForRound } from '../src/domain/draftTendencies';
import type { AdpMap } from '../src/types';

describe('seededRoll', () => {
  it('is a pure function of (seed, key) — same inputs, same output regardless of call order', () => {
    // This is the reload-safety property: advance() fills the null entries of
    // a persisted picks array rather than replaying the draft, and
    // resumeMockDraft() calls it again after a cold page reload with no
    // in-memory generator left to resume. seededRoll(seed, ROLL_PICK, idx)
    // must therefore reproduce the exact same value whether it's the first
    // call ever made or the hundredth call after a reload.
    const a = seededRoll(42, ROLL_PICK, 7);
    seededRoll(1, 2, 3); // interleave unrelated calls
    seededRoll(99, 0);
    const b = seededRoll(42, ROLL_PICK, 7);
    expect(a).toBe(b);
  });

  it('stays within [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const r = seededRoll(i * 7919, ROLL_PICK, i);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });

  it('different seeds or keys produce different rolls', () => {
    expect(seededRoll(1, ROLL_PICK, 0)).not.toBe(seededRoll(2, ROLL_PICK, 0));
    expect(seededRoll(1, ROLL_PICK, 0)).not.toBe(seededRoll(1, ROLL_PICK, 1));
  });

  it('namespaces (ROLL_PICK vs ROLL_DOUBLE_UP) never collide for the same trailing key', () => {
    expect(seededRoll(5, ROLL_PICK, 3)).not.toBe(seededRoll(5, ROLL_DOUBLE_UP, 3));
  });

  it('is roughly uniform over many draws', () => {
    const buckets = new Array(10).fill(0);
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const r = seededRoll(1234567, ROLL_PICK, i);
      buckets[Math.min(9, Math.floor(r * 10))] += 1;
    }
    const expected = n / 10;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(expected * 0.8);
      expect(count).toBeLessThan(expected * 1.2);
    }
  });
});

describe('samplePlayer', () => {
  function pool(entries: [string, number, string][]): {
    ids: string[];
    adpMap: AdpMap;
    positionOf: (pid: string) => string | undefined;
  } {
    const ids = entries.map(([id]) => id);
    const adpMap: AdpMap = {};
    const positions: Record<string, string> = {};
    for (const [id, adp, pos] of entries) {
      adpMap[id] = adp;
      positions[id] = pos;
    }
    return { ids, adpMap, positionOf: (pid) => positions[pid] };
  }

  it('returns null for an empty pool', () => {
    expect(samplePlayer([], {}, () => undefined, {}, 0)).toBeNull();
  });

  it('under monotonic (decay-only) weights, roll=0 equals bestAvailablePlayer', () => {
    const { ids, adpMap, positionOf } = pool([
      ['a', 5, 'RB'],
      ['b', 1, 'WR'],
      ['c', 3, 'QB'],
    ]);
    const flat = { RB: 1, WR: 1, QB: 1, TE: 1 };
    expect(samplePlayer(ids, adpMap, positionOf, flat, 0)).toBe(bestAvailablePlayer(ids, adpMap));
    expect(samplePlayer(ids, adpMap, positionOf, flat, 0)).toBe('b');
  });

  it('never returns a player at a position weighted to 0', () => {
    const { ids, adpMap, positionOf } = pool([
      ['qb', 1, 'QB'],
      ['rb', 2, 'RB'],
      ['wr', 3, 'WR'],
    ]);
    const weights = { QB: 0, RB: 1, WR: 1, TE: 1 };
    for (let i = 0; i < 50; i++) {
      const result = samplePlayer(ids, adpMap, positionOf, weights, i / 50);
      expect(result).not.toBe('qb');
    }
  });

  it('falls back to bestAvailablePlayer when every candidate weighs 0', () => {
    const { ids, adpMap, positionOf } = pool([
      ['a', 5, 'RB'],
      ['b', 1, 'WR'],
    ]);
    // Empty weights map + no fallback mean weight (no entries to average).
    expect(samplePlayer(ids, adpMap, positionOf, {}, 0.9)).toBe(
      bestAvailablePlayer(ids, adpMap),
    );
  });

  it('a position absent from the weights map gets the mean of the mapped weights', () => {
    // index0 = 'x' (unmapped position, mean weight = (0.8+0.2)/2 = 0.5),
    // index1 = 'rb' (weight 0.8). rankDecay=1 so index has no effect, so the
    // selection boundary between them sits exactly at roll = 0.5/(0.5+0.8).
    const { ids, adpMap, positionOf } = pool([
      ['x', 1, 'GHOST'],
      ['rb', 2, 'RB'],
    ]);
    const weights = { RB: 0.8, WR: 0.2 };
    const boundary = 0.5 / (0.5 + 0.8);
    expect(samplePlayer(ids, adpMap, positionOf, weights, boundary - 0.01, 2, 1)).toBe('x');
    expect(samplePlayer(ids, adpMap, positionOf, weights, boundary + 0.01, 2, 1)).toBe('rb');
  });

  it('treats a missing-ADP player with the same 9999 sentinel as bestAvailablePlayer', () => {
    const ids = ['known', 'unknown'];
    const adpMap: AdpMap = { known: 1 };
    const positionOf = () => 'RB';
    const flat = { RB: 1 };
    // Only 'known' has an ADP entry; 'unknown' sorts last (sentinel 9999) but
    // is still in the pool, so a high roll can still land on it.
    expect(samplePlayer(ids, adpMap, positionOf, flat, 0)).toBe('known');
    expect(samplePlayer(ids, adpMap, positionOf, flat, 0.99, 2, 1)).toBe('unknown');
  });

  it('the anti-reach guarantee: never returns a player outside the top N by ADP, however skewed the weights', () => {
    const entries: [string, number, string][] = [];
    for (let i = 1; i <= 50; i++) {
      entries.push([`p${i}`, i, i % 4 === 0 ? 'RB' : i % 4 === 1 ? 'WR' : i % 4 === 2 ? 'QB' : 'TE']);
    }
    const { ids, adpMap, positionOf } = pool(entries);
    // Deliberately extreme skew: almost all weight on a position that's rare
    // near the top of the pool, to try to force a reach if the guarantee is broken.
    const weights = { RB: 0.97, WR: 0.01, QB: 0.01, TE: 0.01 };
    const topNAdpCutoff = 10;
    for (let i = 0; i < 200; i++) {
      const roll = i / 200;
      const result = samplePlayer(ids, adpMap, positionOf, weights, roll, 10, 0.75);
      expect(result).not.toBeNull();
      expect(adpMap[result as string]).toBeLessThanOrEqual(topNAdpCutoff);
    }
  });

  describe('distribution sanity (deterministic — driven by seededRoll, never Math.random)', () => {
    const FIXED_SEED = 2026822;
    const round1Weights = positionWeightsForRound(MUDD_ROUND_BANDS, 1);

    it('on a position-neutral pool, the realized RB share tracks the round-1 weight lean', () => {
      // RB/WR alternate by rank so decay contributes to both positions
      // roughly evenly across many trials; only QB/TE are absent from the
      // pool since this isolates the RB-vs-WR signal.
      const entries: [string, number, string][] = [];
      for (let i = 1; i <= 10; i++) entries.push([`p${i}`, i, i % 2 === 1 ? 'RB' : 'WR']);
      const { ids, adpMap, positionOf } = pool(entries);

      let rbCount = 0;
      const trials = 5000;
      for (let i = 0; i < trials; i++) {
        const roll = seededRoll(FIXED_SEED, 1, i);
        const result = samplePlayer(ids, adpMap, positionOf, round1Weights, roll);
        if (positionOf(result as string) === 'RB') rbCount += 1;
      }
      const rbShare = rbCount / trials;
      // Centered on the smoothed round-1 weight ratio between RB and WR
      // (20:9 -> ~0.690); wide enough not to be a change-detector on the
      // exact decay math, tight enough to catch a swapped or inverted lean.
      expect(rbShare).toBeGreaterThan(0.62);
      expect(rbShare).toBeLessThan(0.76);
    });

    it('on an RB-poor pool, the sampler leans RB but cannot manufacture RBs that are not there', () => {
      // Only 3 of the top 10 by ADP are RBs (spread across the window, not
      // stacked at the favorable early ranks) — this demonstrates the result
      // is bounded by the pool's actual composition, not just the weight
      // table, which the neutral-pool test above can't show on its own.
      const positionsByIndex = ['RB', 'WR', 'WR', 'WR', 'RB', 'WR', 'WR', 'WR', 'RB', 'WR'];
      const entries: [string, number, string][] = [];
      positionsByIndex.forEach((pos, i) => entries.push([`p${i + 1}`, i + 1, pos]));
      const { ids, adpMap, positionOf } = pool(entries);

      let rbCount = 0;
      const trials = 5000;
      for (let i = 0; i < trials; i++) {
        const roll = seededRoll(FIXED_SEED, 2, i);
        const result = samplePlayer(ids, adpMap, positionOf, round1Weights, roll);
        if (positionOf(result as string) === 'RB') rbCount += 1;
      }
      const rbShare = rbCount / trials;
      // Above the pool's raw RB share (0.30) — the lean is real — but well
      // below the unrestricted weight ratio (~0.69) — it can't manufacture
      // RBs the pool doesn't have.
      expect(rbShare).toBeGreaterThan(0.3);
      expect(rbShare).toBeLessThan(0.65);
    });
  });
});
