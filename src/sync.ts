// Stateful glue between the shared-keeper gist (src/api/gist.ts) and the app's
// global state, using the pure merge logic in src/domain/keeperShare.ts.
//
// Reads are best-effort: a failed refresh must never break the app. It leaves
// the local selections alone, flags the header badge, and the rest of the page
// carries on exactly as it did when picks were localStorage-only. Writes are
// the opposite — they retry, verify, and throw if they can't confirm, because
// silently losing a manager's keeper picks is the one failure this app can't
// shrug off.
import {
  canReadShared,
  canWriteShared,
  fetchSharedKeepers,
  GistAuthError,
  writeSharedKeepers,
} from './api/gist';
import type { SharedKeepers } from './api/schemas';
import {
  lockedTeamsFor,
  mergeSharedKeepers,
  samePicks,
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
 * Call after rosters load — the merge needs to know which roster is the
 * signed-in manager's before it can decide whose local picks to leave alone.
 * Returns whether anything actually changed, so a background poll can skip a
 * pointless re-render.
 */
export async function refreshSharedKeepers(): Promise<boolean> {
  if (!canReadShared()) {
    state.syncStatus = 'off';
    return false;
  }
  const before = JSON.stringify(state.keeperLocks);
  try {
    const shared = await fetchSharedKeepers();
    applySharedDoc(shared);
    state.syncStatus = 'idle';
    state.syncedAt = new Date();
  } catch {
    state.syncStatus = 'error';
    return false;
  }
  return JSON.stringify(state.keeperLocks) !== before;
}

/** Fold a freshly-fetched doc into state and mirror it to localStorage. */
function applySharedDoc(shared: SharedKeepers): void {
  cacheSharedKeepersLocally(shared);
  const merged = mergeSharedKeepers({
    shared,
    leagueId: state.leagueId,
    localKeepers: state.keepers,
    editingRosterId: state.editingRosterId,
    myRosterId: myRosterId(),
  });
  state.keepers = merged.keepers;
  state.keeperLocks = merged.locks;
  // Mirror the merged result locally so a later offline load still shows the
  // league's real picks rather than reverting to this browser's old guesses.
  saveKeepers();
}

// ---------- writing ----------

const COMMIT_ATTEMPTS = 3;

/**
 * Jittered backoff. The jitter matters more than the delay: two managers who
 * collided are by definition acting at the same moment, and a fixed wait would
 * line their retries up to collide again.
 */
function backoffMs(attempt: number): number {
  return 250 * 2 ** (attempt - 1) + Math.random() * 250;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read-modify-write one team's entry, then verify it actually stuck.
 *
 * The gist API has no compare-and-swap, so there's a window between our read
 * and our write in which another manager's save can land — and our write would
 * overwrite it. Re-reading afterwards is how we notice the mirror image of that
 * (someone overwrote *us*), and retrying re-applies our change on top of their
 * now-current doc. Both clients run this loop, so a collision resolves with
 * both entries intact instead of one manager silently losing their picks.
 *
 * `apply` must only ever touch this manager's own team, which is what keeps a
 * retry from dragging a stale copy of anyone else's entry along with it.
 */
async function commitSharedChange(
  apply: (latest: SharedKeepers) => SharedKeepers,
  confirmed: (doc: SharedKeepers) => boolean,
  failureMessage: string,
): Promise<void> {
  state.syncStatus = 'syncing';
  for (let attempt = 1; attempt <= COMMIT_ATTEMPTS; attempt++) {
    try {
      const next = apply(await fetchSharedKeepers());
      await writeSharedKeepers(next);
      const readBack = await fetchSharedKeepers();
      if (confirmed(readBack)) {
        applySharedDoc(readBack);
        state.editingRosterId = null;
        state.syncStatus = 'idle';
        state.syncedAt = new Date();
        return;
      }
    } catch (e) {
      // A rejected token is neither transient nor racy — retrying just burns
      // three round trips to be told no again. Surface it straight away, with
      // the message that tells the manager who can actually fix it.
      if (e instanceof GistAuthError) {
        state.syncStatus = 'error';
        throw e;
      }
      /* network/API failure — retried below, same as a lost write */
    }
    if (attempt < COMMIT_ATTEMPTS) await delay(backoffMs(attempt));
  }
  state.syncStatus = 'error';
  throw new Error(failureMessage);
}

/**
 * Commit the signed-in manager's current selections to the shared gist, locking
 * them for everyone else.
 */
export async function saveMyKeepers(): Promise<void> {
  const rosterId = myRosterId();
  if (rosterId === null || !state.leagueId || !canWriteShared()) return;
  const leagueId = state.leagueId;
  const entry = {
    playerIds: keeperListFor(rosterId).slice(),
    savedBy: state.currentUserId || '',
    savedByName: teamNameForRoster(rosterId),
    // Fixed before the first attempt so a retry reports when the manager acted,
    // not when the network finally cooperated.
    savedAt: new Date().toISOString(),
  };
  await commitSharedChange(
    (latest) => withTeamKeepers(latest, leagueId, rosterId, entry),
    (doc) => samePicks(lockedTeamsFor(doc, leagueId)[String(rosterId)], entry.playerIds),
    'Could not save keepers to the league',
  );
}

/** Withdraw this team's picks from the league entirely, unlocking them there. */
export async function clearMyKeepers(): Promise<void> {
  const rosterId = myRosterId();
  if (rosterId === null || !state.leagueId || !canWriteShared()) return;
  const leagueId = state.leagueId;
  await commitSharedChange(
    (latest) => withoutTeamKeepers(latest, leagueId, rosterId),
    (doc) => !(String(rosterId) in lockedTeamsFor(doc, leagueId)),
    'Could not withdraw keepers from the league',
  );
}

// ---------- local edit state ----------

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

// ---------- background polling ----------

// Keeper season is a shared, live activity: managers sit on this page watching
// for what everyone else does. Without a poll the board looks frozen until
// someone thinks to hit Refresh.
const POLL_INTERVAL_MS = 60_000;

let pollTimer: number | null = null;
let pollHandler: (() => void) | null = null;

async function pollOnce(): Promise<void> {
  // Skip while hidden (a backgrounded tab nobody is reading doesn't need to
  // keep hitting GitHub) and while a save is mid-flight, so a poll can't land
  // between a write and its read-back and confuse the verification.
  if (document.visibilityState !== 'visible') return;
  if (state.syncStatus === 'syncing') return;
  if (await refreshSharedKeepers()) pollHandler?.();
}

function onVisibilityChange(): void {
  // Catch up the moment the tab is looked at again rather than waiting out the
  // rest of the interval — coming back to the tab is exactly when a manager
  // wants to see what changed while they were away.
  if (document.visibilityState === 'visible') void pollOnce();
}

/** Begin polling the shared doc; `onUpdate` fires only when something changed. */
export function startSharedKeeperPolling(onUpdate: () => void): void {
  stopSharedKeeperPolling();
  if (!canReadShared()) return;
  pollHandler = onUpdate;
  pollTimer = window.setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

export function stopSharedKeeperPolling(): void {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
  pollHandler = null;
  document.removeEventListener('visibilitychange', onVisibilityChange);
}
