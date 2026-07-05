// Sleeper has no official public ADP endpoint. We scan a player's stats object
// for an ADP-like field. In practice the field present is `adp_dd_ppr` (a
// dropoff-adjusted PPR projection), not a true consensus ADP — see README.

const PREFERRED_ADP_KEYS = [
  'adp_std',
  'adp_ppr',
  'adp_half_ppr',
  'adp_2qb',
  'adp_dynasty',
  'adp_dd_ppr',
  'adp_dd_std',
  'adp_dd_half_ppr',
  'adp_rookie',
];

export function extractAdp(statsObj: Record<string, unknown> | null | undefined): number | null {
  if (!statsObj) return null;
  for (const k of PREFERRED_ADP_KEYS) {
    const v = statsObj[k];
    if (typeof v === 'number' && v > 0) return v;
  }
  for (const k in statsObj) {
    const v = statsObj[k];
    if (k.toLowerCase().startsWith('adp') && typeof v === 'number' && v > 0) return v;
  }
  return null;
}
