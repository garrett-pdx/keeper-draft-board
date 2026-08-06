// Stateful glue between the shared-keeper gist (src/api/gist.ts) and the app's
// global state, using the pure merge logic in src/domain/keeperShare.ts.
//
// Everything here is best-effort. A failed sync must never break the app: it
// leaves the local selections alone, flags the header badge, and the rest of the
// page carries on exactly as it did when picks were localStorage-only.
import { canReadShared, canWriteShared, fetchSharedKeepers, writeSharedKeepers } from './api/gist';
import {
  lockedTeamsFor,
  mergeSharedKeepers,
  withTeamKeepers,
  withoutTeamKeepers,
} from './domain/keeperShare';
import {
  cacheSharedKeepersLocally,
  keeperListFor,
  myRosterId,
  saveKeepers,
  state,
  teamNameForRoster,
} from './state';

/**
 * Pull the league's shared picks and fold them into `state.keepers`.
 *
 * Call this after rosters load — the merge needs to know which roster is the
 * signed-in manager's before it can decide what to leave alone.
 */
export async function ensureSharedKeepersLoaded(): Promise<void> {
  if (!canReadShared()) {
    state.syncStatus = 'off';
    return;
  }
  state.syncStatus = 'syncing';
  try {
    const shared = await fetchSharedKeepers();
    cacheSharedKeepersLocally(shared);
    const merged = mergeSharedKeepers({
      shared,
      leagueId: state.leagueId,
      localKeepers: state.keepers,
      editingRosterId: state.editingRosterId,
    });
    state.keepers = merged.keepers;
    state.keeperLocks = merged.locks;
    // Mirror the merged result locally so a later offline load still shows the
    // league's real picks rather than reverting to this browser's old guesses.
    saveKeepers();
    state.syncStatus = 'idle';
    state.syncedAt = new Date();
  } catch {
    state.syncStatus = 'error';
  }
}

/**
 * Commit the signed-in manager's current selections to the shared gist, locking
 * them for everyone else.
 *
 * Re-reads the gist immediately before writing so a save can't clobber another
 * manager's picks that landed since this page loaded — only this one team's
 * entry is replaced in the freshly-fetched doc.
 */
export async function saveMyKeepers(): Promise<void> {
  const rosterId = myRosterId();
  if (rosterId === null || !state.leagueId || !canWriteShared()) return;
  state.syncStatus = 'syncing';
  try {
    const latest = await fetchSharedKeepers();
    const next = withTeamKeepers(latest, state.leagueId, rosterId, {
      playerIds: keeperListFor(rosterId).slice(),
      savedBy: state.currentUserId || '',
      savedByName: teamNameForRoster(rosterId),
      savedAt: new Date().toISOString(),
    });
    await writeSharedKeepers(next);
    cacheSharedKeepersLocally(next);
    state.keeperLocks = lockedTeamsFor(next, state.leagueId);
    state.editingRosterId = null;
    state.syncStatus = 'idle';
    state.syncedAt = new Date();
  } catch {
    state.syncStatus = 'error';
    throw new Error('Could not save keepers to the league');
  }
}

/** Reopen the signed-in manager's locked picks for editing (local only). */
export function startEditingMyKeepers(): void {
  const rosterId = myRosterId();
  if (rosterId === null) return;
  state.editingRosterId = rosterId;
}

/** Abandon an in-progress edit, restoring the picks last saved to the league. */
export function cancelEditingMyKeepers(): void {
  const rosterId = myRosterId();
  state.editingRosterId = null;
  if (rosterId === null) return;
  const saved = lockedTeamsFor(state.sharedKeepers, state.leagueId)[String(rosterId)];
  if (saved) {
    state.keepers[rosterId] = saved.playerIds.slice();
    saveKeepers();
  }
}

/** Withdraw this team's picks from the league entirely, unlocking them there. */
export async function clearMyKeepers(): Promise<void> {
  const rosterId = myRosterId();
  if (rosterId === null || !state.leagueId || !canWriteShared()) return;
  state.syncStatus = 'syncing';
  try {
    const latest = await fetchSharedKeepers();
    const next = withoutTeamKeepers(latest, state.leagueId, rosterId);
    await writeSharedKeepers(next);
    cacheSharedKeepersLocally(next);
    state.keeperLocks = lockedTeamsFor(next, state.leagueId);
    state.editingRosterId = null;
    state.syncStatus = 'idle';
    state.syncedAt = new Date();
  } catch {
    state.syncStatus = 'error';
    throw new Error('Could not withdraw keepers from the league');
  }
}
