// Reading last season's draft and deciding which picks were actually KEPT.
//
// That verdict drives this season's inflation (see potentialKeeperCost), so
// getting it wrong is expensive in both directions: a false keeper charges a
// manager a round they don't owe, a missed one undercharges. This is a
// different job from pricing a keeper — keeperCost.ts consumes the result —
// so it lives in its own module, and it is pure so the parts most likely to
// harbour a bug (the owner-id join, the degrade-to-off paths) are testable
// without a network or a DOM.
//
// SLEEPER'S FLAG IS INCOMPLETE, WHICH IS THE WHOLE PROBLEM. `is_keeper` is
// never set on a pick made from a traded-in draft slot — Sleeper's keeper
// preassignment can only bind to a team's own original slot — so a manager
// who kept a player using an acquired pick reads as an ordinary drafter.
// Confirmed against this app's own league: two 2025 keepers (both genuinely
// kept, per the commissioner) carry `is_keeper: null` for exactly this reason.
//
// The previous fix took "made from an acquired slot" as sufficient evidence of
// a keeper. It is not. In that same 2025 draft the test flagged 14 picks, of
// which 12 were ordinary picks made with traded-for capital — putting 8 of 10
// rosters over a hard 2-keeper limit and overcharging 8 players by a round.
// An acquired slot is a *necessary* condition, never a sufficient one.
import type { PrevDraftEntry, PrevDraftMap } from '../types';
import type { SleeperDraft } from '../api/schemas';
import { pickWasAcquiredViaTrade } from './draftOrder';

/** The subset of a Sleeper draft pick this module reads. */
export interface PrevDraftPick {
  player_id?: string | null;
  round: number;
  roster_id: number;
  is_keeper?: boolean | null;
  draft_slot?: number | null;
}

export interface PrevKeeperInput {
  picks: PrevDraftPick[];
  /** Last season's draft, for the slot math. Null disables trade inference. */
  prevDraft: SleeperDraft | null;
  /** Last season's roster_id -> stable owner user_id. Empty disables inference. */
  prevRosterOwner: Record<string, string>;
  /**
   * playerId -> the owner ids holding that player at the end of the season
   * BEFORE last. `null` means we couldn't load it, which is deliberately
   * distinct from "loaded, and nobody held him": only the latter is evidence.
   */
  rosteredOwnersByPlayer: Record<string, Set<string>> | null;
  /** That season's keeper allowance — not necessarily this season's. */
  maxKeepers: number;
}

/**
 * Last season's draft as a playerId -> PrevDraftEntry map, with `wasKeeper`
 * resolved.
 *
 * Three rules, applied per roster:
 *
 *  1. Every `is_keeper` pick counts. Sleeper's own flag is never second-guessed.
 *  2. A pick made from an acquired slot counts only if that manager *already
 *     held the player* at the end of the season before — the corroboration
 *     that separates a real keeper from an ordinary pick made with traded-for
 *     capital. Matched on stable `owner_id`, never `roster_id`, which Sleeper
 *     recycles between seasons and which across a two-season gap is noise.
 *  3. Corroborated candidates fill only the slots rule 1 left free, and **if
 *     there are more of them than slots, none are admitted**. Refusing to
 *     guess is deliberate: the obvious tie-breaks are all wrong (an early-round
 *     acquired pick is the *most* likely ordinary trade-up and the least likely
 *     keeper), the situation arises in none of four seasons of real drafts, and
 *     an undercharge is the safe direction when the alternative is inventing a
 *     rule the league never specified.
 *
 * Inference switches off entirely — leaving `is_keeper` alone, the behaviour
 * from before any of this existed — when the corroboration data is missing,
 * when the prev-season owner map is empty, or per-pick when that roster has no
 * owner id (orphan and commissioner-run teams have `owner_id: null`).
 *
 * Known blind spot, measured rather than assumed: corroboration recalls ~78% of
 * genuine keepers (14 of this league's 18 known 2025 keepers). The misses are
 * players acquired in the offseason and kept by their *new* manager, who by
 * definition weren't on that manager's roster the season before. Such a keeper
 * is only missed if he was ALSO drafted on a traded slot — which has never
 * happened in this league — and the failure undercharges, which is the
 * direction to fail in.
 */
export function buildPrevDraftMap(input: PrevKeeperInput): PrevDraftMap {
  const { picks, prevDraft, prevRosterOwner, rosteredOwnersByPlayer, maxKeepers } = input;
  const canInfer = rosteredOwnersByPlayer !== null && Object.keys(prevRosterOwner).length > 0;

  const map: PrevDraftMap = {};
  // playerIds admitted by rule 1, and the rule-2 candidates, bucketed by roster.
  const certainByRoster = new Map<number, number>();
  const candidatesByRoster = new Map<number, string[]>();

  for (const pick of picks) {
    if (!pick.player_id) continue;
    const ownerId = prevRosterOwner[String(pick.roster_id)] || null;
    map[pick.player_id] = {
      round: pick.round,
      rosterId: pick.roster_id,
      ownerId,
      wasKeeper: pick.is_keeper === true,
    };
    if (pick.is_keeper === true) {
      certainByRoster.set(pick.roster_id, (certainByRoster.get(pick.roster_id) || 0) + 1);
      continue;
    }
    if (!canInfer || !ownerId) continue;
    if (!pickWasAcquiredViaTrade(prevDraft, pick.roster_id, pick.draft_slot)) continue;
    if (!rosteredOwnersByPlayer![pick.player_id]?.has(ownerId)) continue;
    const bucket = candidatesByRoster.get(pick.roster_id);
    if (bucket) bucket.push(pick.player_id);
    else candidatesByRoster.set(pick.roster_id, [pick.player_id]);
  }

  for (const [rosterId, candidates] of candidatesByRoster) {
    const free = maxKeepers - (certainByRoster.get(rosterId) || 0);
    // Rule 3: exactly-fitting candidates are all admitted; too many and we
    // decline to pick between them rather than invent a tie-break.
    if (free <= 0 || candidates.length > free) continue;
    for (const playerId of candidates) map[playerId].wasKeeper = true;
  }

  return map;
}

/** Convenience for callers holding raw rosters: playerId -> owner ids holding them. */
export function rosteredOwnersFromRosters(
  rosters: Array<{ owner_id: string | null; players?: string[] | null }> | null,
): Record<string, Set<string>> | null {
  if (!rosters) return null;
  const out: Record<string, Set<string>> = {};
  for (const roster of rosters) {
    if (!roster.owner_id) continue;
    for (const playerId of roster.players || []) {
      (out[playerId] = out[playerId] || new Set<string>()).add(roster.owner_id);
    }
  }
  return out;
}

export type { PrevDraftEntry };
