import type { KeeperCostItem, PrevDraftMap } from '../types';
import { potentialKeeperCost } from './keeperCost';
import { keeperSurplusValue } from './value';
import type { AdpMap, PlayersMap } from '../types';

/**
 * Keepers a commissioner has entered into this season's Sleeper draft room.
 *
 * Once they exist they are the truth, and this app stops deciding who is kept:
 * a manager's in-app selection was only ever a way to plan before the league's
 * keeper deadline. Sleeper also states each one's ROUND and exact pick number
 * outright, which means none of keeperCost.ts's collision/capacity machinery
 * applies — there is nothing left to resolve, only to read.
 *
 * The detection signal is simply that such picks exist. Sleeper publishes no
 * "keepers are locked" flag and no keeper-deadline field anywhere on the league
 * or draft object (checked live across every settings key), and the draft sits
 * at status 'pre_draft' both before and after keepers are entered — so their
 * presence is the only observable evidence that the deadline has passed.
 *
 * The accepted cost of that: a commissioner entering teams one at a time leaves
 * the rest briefly showing no keepers. Waiting for every roster to appear can't
 * fix it, because a team that legitimately keeps nobody is indistinguishable
 * from one not yet entered.
 */
export interface LockedKeeperPick {
  playerId: string;
  rosterId: number;
  round: number;
  /** Exact overall pick number, straight from Sleeper. */
  pickNo: number | null;
}

/** rosterId (as a string key) -> that team's locked keepers, in pick order. */
export type LockedKeeperMap = Record<string, LockedKeeperPick[]>;

export interface RawKeeperPick {
  player_id?: string | null;
  round: number;
  roster_id: number;
  is_keeper?: boolean | null;
  pick_no?: number | null;
}

/**
 * Groups this season's `is_keeper` picks by roster.
 *
 * Only `is_keeper === true` counts. Sleeper cannot set that flag on a pick made
 * from a traded-in slot (see domain/prevKeepers.ts for the evidence), so a
 * keeper assigned against an acquired pick could in principle be missed here —
 * but unlike last season's draft there is nothing to corroborate against, and
 * guessing would invent keepers rather than merely under-count them. Missing
 * one shows that team a keeper short, which is visible and correctable; an
 * invented one silently removes a real player from the draft pool.
 */
export function buildLockedKeepers(picks: RawKeeperPick[]): LockedKeeperMap {
  const map: LockedKeeperMap = {};
  for (const p of picks) {
    if (p.is_keeper !== true || !p.player_id) continue;
    const key = String(p.roster_id);
    (map[key] = map[key] || []).push({
      playerId: p.player_id,
      rosterId: p.roster_id,
      round: p.round,
      pickNo: p.pick_no ?? null,
    });
  }
  for (const key in map) {
    map[key].sort((a, b) => (a.pickNo ?? a.round) - (b.pickNo ?? b.round));
  }
  return map;
}

/** True once any keeper has been entered in this season's draft room. */
export function keepersAreLocked(map: LockedKeeperMap | null | undefined): boolean {
  if (!map) return false;
  for (const key in map) {
    if (map[key].length) return true;
  }
  return false;
}

export interface LockedKeeperContext {
  locked: LockedKeeperPick[];
  prevDraftMap: PrevDraftMap;
  playersMap: PlayersMap;
  adpMap: AdpMap;
  ownerId: string | null;
  rosterId: number;
  lastRound: number;
  teamCount: number;
  inflationRounds: number;
  noKeeperCost: boolean;
}

/**
 * Turns Sleeper's locked keepers into the same KeeperCostItem shape the rest of
 * the app already renders, so the board, draft list and mock draft need no
 * special case.
 *
 * `cost` is Sleeper's round verbatim — never recomputed. `expectedCost` carries
 * what this app's own rules would have charged, but ONLY when the two disagree,
 * so a rules mismatch is visible rather than silently overwritten. `bumped` and
 * `cannotBeKept` are always false: both describe outcomes of a resolution step
 * that no longer happens, and a locked keeper by definition has a pick.
 */
export function lockedKeeperCosts(ctx: LockedKeeperContext): KeeperCostItem[] {
  const {
    locked,
    prevDraftMap,
    playersMap,
    adpMap,
    ownerId,
    rosterId,
    lastRound,
    teamCount,
    inflationRounds,
    noKeeperCost,
  } = ctx;
  void playersMap; // kept for signature parity with getRosterKeeperCosts
  return locked.map((pick) => {
    const prev = prevDraftMap[pick.playerId] || null;
    const expected = potentialKeeperCost(prev, ownerId, rosterId, lastRound, inflationRounds);
    // Taxi-squad leagues spend no pick by rule. If Sleeper somehow holds keeper
    // picks for one anyway, the league's own setting still wins on COST — the
    // locked list only decides who is kept.
    const cost = noKeeperCost ? expected : pick.round;
    const sv = keeperSurplusValue(
      pick.playerId,
      cost,
      adpMap,
      teamCount,
      noKeeperCost ? Infinity : pick.pickNo,
    );
    return {
      playerId: pick.playerId,
      base: expected,
      cost,
      bumped: false,
      cannotBeKept: false,
      hasData: !!prev,
      value: sv.value,
      hasAdp: sv.hasAdp,
      consumedPick: noKeeperCost ? null : pick.pickNo,
      taxiSquad: noKeeperCost,
      fromSleeper: true,
      expectedCost: !noKeeperCost && expected !== pick.round ? expected : null,
    };
  });
}
