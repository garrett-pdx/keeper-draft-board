import type { OutlookMap } from '../types';

// Trivial by design — matching is a direct espn_id lookup (Sleeper's own
// player dict carries espn_id), unlike ADP's fuzzy name matching. Kept as a
// pure function anyway for the same reason the rest of domain/ is: testable,
// state-free, and the one place null-handling for a missing/unmatched player
// lives.
export function outlookFor(espnId: number | null, outlookMap: OutlookMap): string | null {
  if (espnId == null) return null;
  return outlookMap[String(espnId)] || null;
}
