import type { SleeperDraft } from '../api/schemas';

// The critical signal for "is this season's draft order real" is draft_order
// !== null — NOT slot_to_roster_id's presence, which Sleeper populates with a
// default identity placeholder (slot N -> roster N) before the commissioner
// actually sets/randomizes the order. Trusting slot_to_roster_id alone would
// silently produce wrong "exact" pick numbers for a season that isn't set yet.
export function hasKnownDraftOrder(draft: SleeperDraft | null | undefined): boolean {
  return !!(
    draft &&
    draft.type === 'snake' &&
    draft.draft_order != null &&
    draft.slot_to_roster_id != null
  );
}

/** roster_id -> its draft slot (1-indexed), derived from slot_to_roster_id. */
export function slotForRoster(
  slotToRosterId: Record<string, number>,
  rosterId: number,
): number | null {
  for (const slot in slotToRosterId) {
    if (slotToRosterId[slot] === rosterId) return Number(slot);
  }
  return null;
}

/**
 * Exact overall pick number for a given slot in a round of a snake draft.
 * Odd rounds keep slot order (1..N); even rounds reverse (N..1).
 */
export function exactPickNumber(round: number, slot: number, teamCount: number): number | null {
  if (!(round > 0) || !(slot > 0) || !(teamCount > 0) || slot > teamCount) return null;
  const positionInRound = round % 2 === 1 ? slot : teamCount - slot + 1;
  return (round - 1) * teamCount + positionInRound;
}

/**
 * Exact overall pick number for a roster in a round, or null if the order
 * isn't known yet, the draft isn't a snake draft, or the roster's slot can't
 * be found — callers should fall back to a round-based approximation in that case.
 */
export function exactPickForRoster(
  draft: SleeperDraft | null | undefined,
  rosterId: number,
  round: number,
  teamCount: number,
): number | null {
  if (!hasKnownDraftOrder(draft)) return null;
  const slot = slotForRoster(draft!.slot_to_roster_id as Record<string, number>, rosterId);
  return slot === null ? null : exactPickNumber(round, slot, teamCount);
}
