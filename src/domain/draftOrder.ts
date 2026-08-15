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

/**
 * Orders roster ids by real draft slot (1..N) when the commissioner has set
 * one, else returns `rosterIds` unchanged — the only thing available
 * pre-order. Any id missing from `slot_to_roster_id` is appended at the end
 * in its original relative order rather than dropped.
 *
 * This is the *natural* order — what the board falls back to before anyone
 * rearranges anything (state.ts's naturalBoardOrder is a thin wrapper) and
 * what a mock draft falls back to if no board order has been built yet. It is
 * NOT the last word on a mock draft's pick sequence: before Sleeper publishes
 * a real order the manager's own column arrangement is the only order that
 * exists, so startMockDraft (src/mockDraft.ts) prefers state.boardOrder and
 * uses this as the fallback. See frozenSlotOrder there.
 */
export function orderRosterIdsBySlot(
  draft: SleeperDraft | null | undefined,
  rosterIds: string[],
): string[] {
  if (!hasKnownDraftOrder(draft)) return rosterIds.slice();
  const slotToRosterId = draft!.slot_to_roster_id as Record<string, number>;
  const withSlot = rosterIds
    .map((id) => ({ id, slot: slotForRoster(slotToRosterId, Number(id)) }))
    .filter((x): x is { id: string; slot: number } => x.slot !== null);
  withSlot.sort((a, b) => a.slot - b.slot);
  const ordered = withSlot.map((x) => x.id);
  const withoutSlot = rosterIds.filter((id) => !ordered.includes(id));
  return ordered.concat(withoutSlot);
}

/**
 * Reconciles an order saved earlier against the ids that actually exist now:
 * ids present in `saved` keep their saved relative order, ids missing from it
 * are appended in `fallback` order rather than dropped, and ids no longer in
 * `fallback` are discarded.
 *
 * Shared by the two places that resurrect a stored column arrangement — the
 * board's own localStorage round-trip (state.ts's ensureBoardOrder, against
 * the current roster ids) and a mock draft's frozen pick sequence
 * (src/mockDraft.ts's frozenSlotOrder, against the natural slot order). The
 * fallback differs; the reconciliation must not.
 */
export function reconcileOrder(saved: string[], fallback: string[]): string[] {
  const kept = saved.filter((id) => fallback.includes(id));
  return kept.concat(fallback.filter((id) => !kept.includes(id)));
}

/**
 * True if `draftSlot` (the slot a specific pick was actually made from)
 * differs from `rosterId`'s own natural snake-draft slot — i.e. that pick was
 * exercised using one acquired via trade, not the roster's own original slot.
 *
 * This exists because Sleeper's own `is_keeper` flag on a draft pick is
 * confirmed to never be set for a pick made this way (verified live: across 13
 * drafts / 2008 picks, not one is_keeper:true pick landed on an acquired slot)
 * — Sleeper's keeper-preassignment can only bind to a team's own original
 * slot. So a manager who kept a player using a traded pick reads as a
 * non-keeper from is_keeper alone.
 *
 * **This is a necessary condition for that hidden case, never a sufficient
 * one, and treating it as sufficient was a real bug** (issue #2): in one real
 * draft it flagged 14 picks of which only 2 were kept, because a manager who
 * trades for a pick and drafts an ordinary player with it looks identical
 * here. domain/prevKeepers.ts owns the actual verdict and corroborates this
 * signal against whether that manager already held the player; do not
 * reintroduce a bare `is_keeper || pickWasAcquiredViaTrade`.
 *
 * Never guesses: returns false (not "true", not "unknown") whenever the
 * order isn't known — a missed traded-pick keeper degrades to the prior
 * behavior rather than risking a false positive from bad slot data.
 */
export function pickWasAcquiredViaTrade(
  draft: SleeperDraft | null | undefined,
  rosterId: number,
  draftSlot: number | null | undefined,
): boolean {
  if (!hasKnownDraftOrder(draft) || draftSlot == null) return false;
  const naturalSlot = slotForRoster(draft!.slot_to_roster_id as Record<string, number>, rosterId);
  return naturalSlot !== null && naturalSlot !== draftSlot;
}
