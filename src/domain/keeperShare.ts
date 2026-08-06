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
}

export interface MergeResult {
  keepers: Record<string, string[]>;
  locks: Record<string, SharedKeeperTeam>;
}

/**
 * Fold the league's shared picks over this browser's local ones.
 *
 * Shared picks win for every team, so a manager always sees what everyone else
 * actually committed rather than a stale local guess. The single exception is
 * the roster being actively edited here: those in-progress selections stay
 * local until they're explicitly saved, so re-opening an already-saved team to
 * change it doesn't get stomped by its own previous save on every refresh.
 */
export function mergeSharedKeepers({
  shared,
  leagueId,
  localKeepers,
  editingRosterId,
}: MergeArgs): MergeResult {
  const remote = lockedTeamsFor(shared, leagueId);
  const keepers: Record<string, string[]> = { ...localKeepers };
  const locks: Record<string, SharedKeeperTeam> = {};
  for (const rosterId in remote) {
    if (editingRosterId !== null && rosterId === String(editingRosterId)) continue;
    keepers[rosterId] = remote[rosterId].playerIds.slice();
    locks[rosterId] = remote[rosterId];
  }
  return { keepers, locks };
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
