// Pure merge/update logic for the league's shared keeper picks. State-free and
// unit-tested, like the rest of src/domain — the network side lives in
// src/api/gist.ts and src/sync.ts.
import type { SharedKeepers, SharedKeeperTeam } from '../api/schemas';

export const EMPTY_SHARED_KEEPERS: SharedKeepers = { version: 1, leagues: {} };

/** Every team that has saved (and therefore locked) picks in this league. */
export function lockedTeamsFor(
  shared: SharedKeepers | null,
  leagueId: string | null,
): Record<string, SharedKeeperTeam> {
  if (!shared || !leagueId) return {};
  return shared.leagues[leagueId] || {};
}

export interface MergeArgs {
  shared: SharedKeepers | null;
  leagueId: string | null;
  /** This browser's own selections, from localStorage. */
  localKeepers: Record<string, string[]>;
  /** The roster currently being edited in this browser, if any. */
  editingRosterId: number | null;
  /** The signed-in manager's roster — the only one with uncommitted local picks. */
  myRosterId: number | null;
}

export interface MergeResult {
  keepers: Record<string, string[]>;
  locks: Record<string, SharedKeeperTeam>;
}

/**
 * Fold the league's shared picks over this browser's local ones.
 *
 * The shared doc is authoritative: it decides what every team's keepers are,
 * INCLUDING that a team absent from it has no keepers at all. Building the
 * result from the remote doc rather than patching the local copy is what makes
 * a withdrawal propagate — a team that un-saves would otherwise keep showing
 * its old picks forever on everyone else's device, since each sync had mirrored
 * them into localStorage.
 *
 * Only two rosters keep their local selections through a merge:
 *  - the one being edited here, so re-opening an already-saved team to change it
 *    doesn't get stomped back by its own previous save on the next refresh;
 *  - the signed-in manager's own, and only while it's absent from the shared doc
 *    — those are picks they've chosen but not yet committed. Once it IS in the
 *    doc the remote copy wins, so a save made on another device shows up here.
 */
export function mergeSharedKeepers({
  shared,
  leagueId,
  localKeepers,
  editingRosterId,
  myRosterId,
}: MergeArgs): MergeResult {
  const remote = lockedTeamsFor(shared, leagueId);
  const keepers: Record<string, string[]> = {};
  for (const rosterId in remote) {
    keepers[rosterId] = remote[rosterId].playerIds.slice();
  }

  const keepLocal = (rosterId: number): void => {
    const key = String(rosterId);
    const local = localKeepers[key];
    if (local) keepers[key] = local.slice();
    else delete keepers[key];
  };
  if (myRosterId !== null && !(String(myRosterId) in remote)) keepLocal(myRosterId);
  if (editingRosterId !== null) keepLocal(editingRosterId);

  // Locks mirror the shared doc exactly, including the roster being edited here:
  // that team really is still locked for the league until it's saved again, and
  // the edit affects what this browser may change, not what everyone else sees.
  return { keepers, locks: { ...remote } };
}

/** Whether a team's committed picks match `playerIds`, order-insensitively. */
export function samePicks(team: SharedKeeperTeam | undefined, playerIds: string[]): boolean {
  if (!team) return false;
  if (team.playerIds.length !== playerIds.length) return false;
  const sorted = playerIds.slice().sort();
  return team.playerIds
    .slice()
    .sort()
    .every((id, i) => id === sorted[i]);
}

/**
 * A copy of `shared` with one team's picks replaced. Non-mutating on purpose:
 * saving is a read-modify-write against the live gist, and rebuilding rather
 * than patching in place keeps the freshly-fetched doc (which may contain
 * another manager's save from a second ago) intact except for this one team.
 */
export function withTeamKeepers(
  shared: SharedKeepers | null,
  leagueId: string,
  rosterId: number,
  team: SharedKeeperTeam,
): SharedKeepers {
  const base = shared || EMPTY_SHARED_KEEPERS;
  return {
    version: 1,
    leagues: {
      ...base.leagues,
      [leagueId]: { ...(base.leagues[leagueId] || {}), [String(rosterId)]: team },
    },
  };
}

/** A copy of `shared` with one team's picks removed entirely (unlock + clear). */
export function withoutTeamKeepers(
  shared: SharedKeepers | null,
  leagueId: string,
  rosterId: number,
): SharedKeepers {
  const base = shared || EMPTY_SHARED_KEEPERS;
  const league = { ...(base.leagues[leagueId] || {}) };
  delete league[String(rosterId)];
  return { version: 1, leagues: { ...base.leagues, [leagueId]: league } };
}
