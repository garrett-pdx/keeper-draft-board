import type { AdpMap } from '../types';

/**
 * Uniform pseudo-random float in [0,1), a pure function of a seed plus an
 * arbitrary integer key.
 *
 * DELIBERATELY STATELESS — this is a correctness constraint, not a style
 * choice. src/mockDraft.ts's advance() does not replay a draft each time it
 * runs; it fills whichever entries of the persisted `picks` array are still
 * null, and resumeMockDraft() calls it again after a cold page reload with no
 * in-memory generator left to resume. A streaming PRNG whose state advances
 * per call would be wrong here: its state is gone the moment the tab closes,
 * so the same pick index would re-roll differently on reload. Keying every
 * draw on (seed, ...key) instead makes each decision independently
 * reproducible from what localStorage actually holds. Don't replace this with
 * a stateful generator.
 *
 * Implementation is a small hand-written avalanche mixer (splitmix32-style,
 * via Math.imul) — no runtime dependency, per this project's near-zero-deps
 * constraint.
 */
export function seededRoll(seed: number, ...key: number[]): number {
  let h = seed | 0;
  for (const k of key) {
    h = Math.imul(h ^ k, 0x9e3779b9);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  // >>> 0 makes it unsigned before normalizing, so the result stays in [0,1).
  return (h >>> 0) / 0x100000000;
}

/** Roll namespaces, so a per-pick draw can never collide with a per-roster one. */
export const ROLL_PICK = 1;
export const ROLL_DOUBLE_UP = 2;

/** How many of the top-by-market-rank available players an AI pick may ever be drawn from. */
export const TOP_N = 10;
/**
 * Per-rank falloff within that window — weight *= RANK_DECAY per step down the top N.
 * Lowered from an initial 0.75 to 0.65 to make the AI lean closer to consensus
 * best-available: 0.65 keeps the same top-N window (a positional lean can still reach as
 * deep as the market ever does) but concentrates more of the probability mass on the top
 * 1-2 ranked players, so picks vary less wildly run to run while still varying. Tune here,
 * same convention as VALUE_DECAY.
 */
export const RANK_DECAY = 0.65;

/**
 * Weighted-random pick among the top `topN` available players by market rank,
 * biased by `positionWeights` and by rank within that window.
 *
 * Chosen over the alternative of "sample a target position, then take the
 * best player at it": that alternative has unbounded reach — a rare position
 * roll could take the single best player at that position from anywhere in
 * the pool, however far outside a real draft's reach that player currently
 * is. Restricting to the top N first means this can never return a player
 * outside that window, whatever the weights say — it can only express a
 * positional lean to the extent the market actually offers one there.
 *
 * `roll` is a plain uniform number rather than a generator, so this stays a
 * pure function of numbers: a spec can pass 0 / 0.5 / 0.999... and assert an
 * exact winner with no seeding ceremony. Callers draw it from seededRoll.
 *
 * Missing-ADP players use the same 9999 sentinel bestAvailablePlayer does, so
 * the two never disagree about who is even in contention. The top N is found
 * in a single linear pass (insertion into a length-topN array) rather than a
 * full sort, since the incoming pool can be the whole player dictionary and
 * this runs once per AI pick.
 *
 * A position absent from `positionWeights` gets the mean of the weights that
 * ARE present — not 0 (would ban it outright) and not 1 (would make an
 * unmodelled position likelier than any modelled one). If every candidate's
 * weight comes out 0, or the pool is empty, falls back to bestAvailablePlayer
 * semantics (best-by-rank, or null) rather than being unable to pick at all.
 */
export function samplePlayer(
  availablePlayerIds: string[],
  adpMap: AdpMap,
  positionOf: (playerId: string) => string | undefined,
  positionWeights: Record<string, number>,
  roll: number,
  topN: number = TOP_N,
  rankDecay: number = RANK_DECAY,
): string | null {
  if (!availablePlayerIds.length) return null;

  const adpOf = (pid: string) => (pid in adpMap ? adpMap[pid] : 9999);
  const top: string[] = [];
  for (const pid of availablePlayerIds) {
    const adp = adpOf(pid);
    let i = top.length;
    if (i === topN && adp >= adpOf(top[i - 1])) continue;
    while (i > 0 && adpOf(top[i - 1]) > adp) i--;
    top.splice(i, 0, pid);
    if (top.length > topN) top.pop();
  }

  const weightValues = Object.values(positionWeights);
  const meanWeight = weightValues.length
    ? weightValues.reduce((sum, w) => sum + w, 0) / weightValues.length
    : 0;

  const weights = top.map((pid, index) => {
    const pos = positionOf(pid);
    const posWeight = pos && pos in positionWeights ? positionWeights[pos] : meanWeight;
    return posWeight * rankDecay ** index;
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return top[0];

  const threshold = roll * total;
  let cumulative = 0;
  for (let i = 0; i < top.length; i++) {
    cumulative += weights[i];
    if (threshold < cumulative) return top[i];
  }
  return top[top.length - 1];
}
