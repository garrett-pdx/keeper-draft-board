// Real draft-tendency data for the Mudd Keeper League, hand-transcribed from
// an offline analysis of its 2023/2024/2025 drafts (14 rounds each, keeper
// picks excluded — see docs/draft-tendencies-2023-2025.md for the full
// writeup and provenance). Held as literal constants rather than an imported
// JSON file: the source analysis is ~40 numbers buried in kilobytes of
// per-season/per-manager exhaust the app never reads, it sits outside
// tsconfig.json's declared program roots, and a public/ snapshot would incur
// the runtime-fetch/cache-busting/schema-validation obligations this project
// reserves for data that actually changes at runtime (see CLAUDE.md's
// "Snapshot freshness" section) — this describes three already-completed
// drafts. Same pattern as LAST_SEASON_STANDINGS (src/ui/rosters.ts): a
// hand-maintained league-specific table, kept in sync each offseason.
//
// Every function below takes its table as an argument rather than closing
// over these constants, matching buildMockDraftSlots's
// (holderOfPick, keepersInCellFor) idiom in the sibling module — it keeps
// "the numbers" and "what we do with them" independently testable and
// reviewable.

/** The positions these tables model. Mudd starts no DEF or K — corroborated
 *  by the source data itself: 363 live picks across 30 team-seasons contain
 *  zero DEF and zero K picks. */
export const TENDENCY_POSITIONS = ['RB', 'WR', 'QB', 'TE'] as const;

export interface RoundBand {
  /** Inclusive on both ends; a round past the last band's `toRound` clamps to it. */
  readonly fromRound: number;
  readonly toRound: number;
  readonly counts: Readonly<Record<string, number>>;
}

// Non-overlapping bands recomputed from the source analysis's per-round
// counts (its own prose bands overlap — "Round 1 only" and "Rounds 1-5" both
// include round 1 — and can't be transcribed directly). Round 1 gets its own
// band because it's the one genuinely sharp signal (RB 19, WR 8, QB 0, TE 0);
// bands 1-3 are wide because individual rounds are ~26 picks and swing on a
// handful of players — the source material itself calls the round-to-round
// pattern non-monotonic.
export const MUDD_ROUND_BANDS: readonly RoundBand[] = [
  { fromRound: 1, toRound: 1, counts: { RB: 19, WR: 8, QB: 0, TE: 0 } },
  { fromRound: 2, toRound: 3, counts: { RB: 20, WR: 20, QB: 9, TE: 4 } },
  { fromRound: 4, toRound: 8, counts: { RB: 44, WR: 57, QB: 12, TE: 17 } },
  { fromRound: 9, toRound: 14, counts: { RB: 53, WR: 62, QB: 18, TE: 20 } },
];

/** The ten Sleeper display_names this data covers. Matched case-insensitively
 *  and trimmed, the same convention rosters.ts's standingsRank uses — a
 *  manager who renames on Sleeper just falls out of the match rather than
 *  crashing anything. Keep in sync each offseason. */
export const MUDD_MANAGERS: readonly string[] = [
  'Gurret',
  'mikestreinz',
  'kshoyer',
  'Kabroa',
  'tuckersdumbteam',
  'TnT44',
  'jonahcartwright',
  'malstol',
  'paulslaats',
  'BBrown16',
];

export interface QbTeProfile {
  readonly qb: number; // seasons this manager drafted 2+ QB
  readonly te: number; // seasons this manager drafted 2+ TE
  readonly seasons: number; // seasons observed
}

// Raw counts from manager_season_qbte, keyed on the same display_names as
// MUDD_MANAGERS. All ten managers were observed across all three seasons.
export const MUDD_QBTE_PROFILES: Readonly<Record<string, QbTeProfile>> = {
  Gurret: { qb: 2, te: 0, seasons: 3 },
  mikestreinz: { qb: 1, te: 0, seasons: 3 },
  kshoyer: { qb: 2, te: 2, seasons: 3 },
  Kabroa: { qb: 0, te: 1, seasons: 3 },
  tuckersdumbteam: { qb: 3, te: 3, seasons: 3 },
  TnT44: { qb: 0, te: 3, seasons: 3 },
  jonahcartwright: { qb: 0, te: 1, seasons: 3 },
  malstol: { qb: 2, te: 2, seasons: 3 },
  paulslaats: { qb: 1, te: 0, seasons: 3 },
  BBrown16: { qb: 3, te: 2, seasons: 3 },
};

/**
 * This round's positional lean as smoothed probabilities (sum to 1, never 0).
 *
 * Add-one smoothing is mandatory, not cosmetic: round 1's raw QB/TE counts are
 * literally 0, and a literal zero weight is both a hard structural ban (this
 * position can NEVER be picked here) and breaks a caller doing weighted
 * sampling outright (an all-QB candidate set would sum to zero weight). With
 * smoothing, round 1 becomes RB .645 / WR .290 / QB .032 / TE .032 — a round-1
 * QB stays a rare, once-in-many-drafts event rather than an impossibility,
 * which is the honest read of a 27-pick sample.
 *
 * Out-of-range rounds clamp to the nearest band (round 0 or negative -> the
 * first band, a round past the last band's `toRound` -> the last) rather than
 * throwing — a caller looping over a longer draft than this data covers must
 * always get a usable answer.
 */
export function positionWeightsForRound(
  bands: readonly RoundBand[],
  round: number,
): Record<string, number> {
  const band =
    bands.find((b) => round >= b.fromRound && round <= b.toRound) ??
    (round < bands[0].fromRound ? bands[0] : bands[bands.length - 1]);
  const weights: Record<string, number> = {};
  const total = TENDENCY_POSITIONS.reduce((sum, pos) => sum + (band.counts[pos] || 0), 0);
  const denom = total + TENDENCY_POSITIONS.length;
  for (const pos of TENDENCY_POSITIONS) {
    weights[pos] = ((band.counts[pos] || 0) + 1) / denom;
  }
  return weights;
}

/**
 * This manager's odds of drafting a SECOND QB or TE in one draft, smoothed
 * from `k of n observed seasons` via (k+1)/(n+2) — unsmoothed, a manager who
 * has never doubled up could never be modeled as doing so, and one who always
 * has would be modeled as certain to. .2/.8 reads as a tendency, which is what
 * it is at n=3.
 *
 * Returns null for an unknown manager (unmatched display_name, or none at
 * all) so a caller can distinguish "not modeled" from "modeled at 0%".
 */
export function qbTeDoubleUpOdds(
  profiles: Readonly<Record<string, QbTeProfile>>,
  displayName: string | null | undefined,
): { QB: number; TE: number } | null {
  if (!displayName) return null;
  const key = Object.keys(profiles).find(
    (name) => name.toLowerCase() === displayName.trim().toLowerCase(),
  );
  if (!key) return null;
  const profile = profiles[key];
  return {
    QB: (profile.qb + 1) / (profile.seasons + 2),
    TE: (profile.te + 1) / (profile.seasons + 2),
  };
}

/**
 * Whether enough of the CURRENT league's manager handles match this data's
 * known managers for it to plausibly be about this league — the mechanism
 * that keeps Mudd's tendencies from leaking into anyone else's league without
 * any league-id check anywhere in this codebase. A stray same-named manager
 * in an unrelated league is expected to clear the bar essentially never;
 * five-of-ten also tolerates roughly half the real league renaming on
 * Sleeper before the tables silently stop applying.
 */
export function hasTendencyQuorum(
  displayNames: (string | null | undefined)[],
  knownManagers: readonly string[],
  minMatches = 5,
): boolean {
  const known = new Set(knownManagers.map((n) => n.toLowerCase()));
  let matches = 0;
  for (const name of displayNames) {
    if (name && known.has(name.trim().toLowerCase())) matches += 1;
  }
  return matches >= minMatches;
}
