import type { SleeperTradedPick } from '../api/schemas';

// Sleeper payload type is inferred from the zod schema that validates it at
// the fetch boundary, so the runtime check and the compile-time type can't drift.
export type TradedPicksList = SleeperTradedPick[];

/**
 * Net picks this roster holds for a round: 1 (default) minus its own pick if
 * traded away, plus any picks acquired for that round via trade. Never
 * negative — a roster only ever has one original pick per round to lose.
 */
export function pickCapacity(
  tradedPicks: TradedPicksList,
  round: number,
  rosterId: number,
): number {
  let cap = 1;
  for (const row of tradedPicks) {
    if (row.round !== round) continue;
    if (row.rosterId === rosterId) cap -= 1;
    if (row.ownerId === rosterId) cap += 1;
  }
  return cap;
}

/**
 * Original-owner roster_ids of every pick this roster holds in a round
 * (length === pickCapacity for that round). Used only to decide which
 * literal pick a keeper consumes when a roster holds more than one pick in
 * a round — never affects the resolved cost round itself.
 */
export function heldPickOriginalOwners(
  tradedPicks: TradedPicksList,
  round: number,
  rosterId: number,
): number[] {
  const owners = new Set<number>([rosterId]);
  for (const row of tradedPicks) {
    if (row.round !== round) continue;
    if (row.rosterId === rosterId) owners.delete(rosterId);
    if (row.ownerId === rosterId) owners.add(row.rosterId);
  }
  return [...owners];
}

/**
 * Which roster actually drafts at a given seat's pick in a round — the
 * original owner unless that pick was traded, in which case its current
 * holder. The inverse view of heldPickOriginalOwners, and consistent with
 * pickCapacity by construction: a roster's capacity in a round is exactly the
 * number of seats this returns it for.
 *
 * This is what puts an acquired pick at the *seller's* position in the draft
 * order rather than next to the buyer's own pick — the board has always drawn
 * it that way ("+N incoming from {team}" against the seller's round cell), and
 * the mock draft now runs it that way too.
 */
export function pickHolder(
  tradedPicks: TradedPicksList,
  round: number,
  originalOwnerRosterId: number,
): number {
  for (const row of tradedPicks) {
    if (row.round === round && row.rosterId === originalOwnerRosterId) return row.ownerId;
  }
  return originalOwnerRosterId;
}
