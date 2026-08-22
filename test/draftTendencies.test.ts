import { describe, it, expect } from 'vitest';
import {
  TENDENCY_POSITIONS,
  MUDD_ROUND_BANDS,
  MUDD_MANAGERS,
  MUDD_QBTE_PROFILES,
  positionWeightsForRound,
  qbTeDoubleUpOdds,
  hasTendencyQuorum,
} from '../src/domain/draftTendencies';

describe('MUDD_ROUND_BANDS — transcription guard', () => {
  // The highest-value test in this file: catches a hand-transcription slip
  // against the source analysis (draft-position-analysis.md /
  // docs/draft-tendencies-2023-2025.md), which reported 121+120+122 = 363
  // live (non-keeper) picks across 2023/2024/2025. Asserted against literal
  // expectations rather than by re-reading the source file — re-reading it
  // would make this test tautological, and a filesystem read has no place in
  // a pure domain spec.
  it('band counts match the source analysis exactly', () => {
    expect(MUDD_ROUND_BANDS).toEqual([
      { fromRound: 1, toRound: 1, counts: { RB: 19, WR: 8, QB: 0, TE: 0 } },
      { fromRound: 2, toRound: 3, counts: { RB: 20, WR: 20, QB: 9, TE: 4 } },
      { fromRound: 4, toRound: 8, counts: { RB: 44, WR: 57, QB: 12, TE: 17 } },
      { fromRound: 9, toRound: 14, counts: { RB: 53, WR: 62, QB: 18, TE: 20 } },
    ]);
  });

  it('all bands sum to the documented 363 live picks', () => {
    const total = MUDD_ROUND_BANDS.reduce(
      (sum, band) =>
        sum + TENDENCY_POSITIONS.reduce((s, pos) => s + (band.counts[pos] || 0), 0),
      0,
    );
    expect(total).toBe(363);
  });
});

describe('positionWeightsForRound', () => {
  it('smoothed weights sum to 1 and contain no zeros, even for a band with a raw 0 count', () => {
    for (let round = 1; round <= 14; round++) {
      const weights = positionWeightsForRound(MUDD_ROUND_BANDS, round);
      const total = TENDENCY_POSITIONS.reduce((s, pos) => s + weights[pos], 0);
      expect(total).toBeCloseTo(1, 10);
      for (const pos of TENDENCY_POSITIONS) {
        expect(weights[pos]).toBeGreaterThan(0);
      }
    }
  });

  it('round 1 orders RB > WR > QB = TE, reflecting the sharp raw 19/8/0/0 split', () => {
    const weights = positionWeightsForRound(MUDD_ROUND_BANDS, 1);
    expect(weights.RB).toBeGreaterThan(weights.WR);
    expect(weights.WR).toBeGreaterThan(weights.QB);
    expect(weights.QB).toBeCloseTo(weights.TE, 10);
  });

  it('resolves each band at its boundary rounds', () => {
    expect(positionWeightsForRound(MUDD_ROUND_BANDS, 1)).toEqual(
      positionWeightsForRound(MUDD_ROUND_BANDS, 1),
    );
    // Same band -> same weights.
    expect(positionWeightsForRound(MUDD_ROUND_BANDS, 2)).toEqual(
      positionWeightsForRound(MUDD_ROUND_BANDS, 3),
    );
    expect(positionWeightsForRound(MUDD_ROUND_BANDS, 4)).toEqual(
      positionWeightsForRound(MUDD_ROUND_BANDS, 8),
    );
    expect(positionWeightsForRound(MUDD_ROUND_BANDS, 9)).toEqual(
      positionWeightsForRound(MUDD_ROUND_BANDS, 14),
    );
    // Adjacent bands differ.
    expect(positionWeightsForRound(MUDD_ROUND_BANDS, 3)).not.toEqual(
      positionWeightsForRound(MUDD_ROUND_BANDS, 4),
    );
  });

  it('clamps a round past the last band to the last band, rather than throwing', () => {
    expect(positionWeightsForRound(MUDD_ROUND_BANDS, 15)).toEqual(
      positionWeightsForRound(MUDD_ROUND_BANDS, 14),
    );
    expect(positionWeightsForRound(MUDD_ROUND_BANDS, 20)).toEqual(
      positionWeightsForRound(MUDD_ROUND_BANDS, 14),
    );
  });

  it('clamps a round below the first band to the first band', () => {
    expect(positionWeightsForRound(MUDD_ROUND_BANDS, 0)).toEqual(
      positionWeightsForRound(MUDD_ROUND_BANDS, 1),
    );
    expect(positionWeightsForRound(MUDD_ROUND_BANDS, -3)).toEqual(
      positionWeightsForRound(MUDD_ROUND_BANDS, 1),
    );
  });
});

describe('hasTendencyQuorum', () => {
  it('meets quorum at the default threshold (5 of 10)', () => {
    expect(hasTendencyQuorum(MUDD_MANAGERS.slice(0, 5), MUDD_MANAGERS)).toBe(true);
  });

  it('fails quorum one short of the threshold', () => {
    expect(hasTendencyQuorum(MUDD_MANAGERS.slice(0, 4), MUDD_MANAGERS)).toBe(false);
  });

  it('matches case-insensitively and trims whitespace', () => {
    const names = [' gurret ', 'MIKESTREINZ', 'Kshoyer', 'kabroa', 'TUCKERSDUMBTEAM'];
    expect(hasTendencyQuorum(names, MUDD_MANAGERS)).toBe(true);
  });

  it('ignores null/undefined entries rather than crashing', () => {
    const names = [...MUDD_MANAGERS.slice(0, 5), null, undefined];
    expect(hasTendencyQuorum(names, MUDD_MANAGERS)).toBe(true);
  });

  it('a league of ten strangers never meets quorum', () => {
    const strangers = Array.from({ length: 10 }, (_, i) => `stranger${i}`);
    expect(hasTendencyQuorum(strangers, MUDD_MANAGERS)).toBe(false);
  });

  it('an empty roster never meets quorum', () => {
    expect(hasTendencyQuorum([], MUDD_MANAGERS)).toBe(false);
  });
});

describe('qbTeDoubleUpOdds', () => {
  it('smooths tuckersdumbteam (3 of 3 seasons at both QB and TE) to 0.8/0.8', () => {
    expect(qbTeDoubleUpOdds(MUDD_QBTE_PROFILES, 'tuckersdumbteam')).toEqual({ QB: 0.8, TE: 0.8 });
  });

  it('smooths Gurret (2 of 3 QB, 0 of 3 TE) to 0.6/0.2', () => {
    const odds = qbTeDoubleUpOdds(MUDD_QBTE_PROFILES, 'Gurret');
    expect(odds?.QB).toBeCloseTo(0.6, 10);
    expect(odds?.TE).toBeCloseTo(0.2, 10);
  });

  it('is case-insensitive', () => {
    expect(qbTeDoubleUpOdds(MUDD_QBTE_PROFILES, 'GURRET')).toEqual(
      qbTeDoubleUpOdds(MUDD_QBTE_PROFILES, 'Gurret'),
    );
  });

  it('returns null for an unknown or missing manager', () => {
    expect(qbTeDoubleUpOdds(MUDD_QBTE_PROFILES, 'SomeStranger')).toBeNull();
    expect(qbTeDoubleUpOdds(MUDD_QBTE_PROFILES, null)).toBeNull();
    expect(qbTeDoubleUpOdds(MUDD_QBTE_PROFILES, undefined)).toBeNull();
  });

  it('every profile has an odds value in (0, 1) — smoothing forbids 0 and 1', () => {
    for (const name of MUDD_MANAGERS) {
      const odds = qbTeDoubleUpOdds(MUDD_QBTE_PROFILES, name);
      expect(odds).not.toBeNull();
      expect(odds!.QB).toBeGreaterThan(0);
      expect(odds!.QB).toBeLessThan(1);
      expect(odds!.TE).toBeGreaterThan(0);
      expect(odds!.TE).toBeLessThan(1);
    }
  });

  // Proves the smoothing preserves the league-level signal rather than just
  // making every manager individually non-deterministic: the mean of
  // P(2+QB or 2+TE) across all ten smoothed profiles should land close to the
  // observed 21/30 = 0.700 from the source analysis. A change that "simplifies"
  // the smoothing away (or gets the +1/+2 formula wrong) would drift this.
  it('the league-wide mean P(2+QB or 2+TE) is close to the observed 21/30', () => {
    const probabilities = MUDD_MANAGERS.map((name) => {
      const odds = qbTeDoubleUpOdds(MUDD_QBTE_PROFILES, name)!;
      return 1 - (1 - odds.QB) * (1 - odds.TE);
    });
    const mean = probabilities.reduce((s, p) => s + p, 0) / probabilities.length;
    expect(mean).toBeGreaterThan(0.7 - 0.05);
    expect(mean).toBeLessThan(0.7 + 0.05);
  });
});
