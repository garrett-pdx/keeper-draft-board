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
