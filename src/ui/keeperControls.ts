// The shared-keeper controls on the Rosters tab: claiming which team you are,
// and the save/lock/edit/withdraw row on your own team's card.
//
// Split out of rosters.ts, which is otherwise about rendering rosters — this is
// the only part of that tab that writes to the league. Takes an `onChange`
// callback rather than importing rosters.ts back, to keep the dependency
// one-way.
import { canReadShared, canWriteShared, isTokenRejected, LEAGUE_ADMIN } from '../api/gist';
import { isLockedRoster, myRosterId, setCurrentUserId, state, teamNameForRoster } from '../state';
import {
  cancelEditingMyKeepers,
  clearMyKeepers,
  saveMyKeepers,
  startEditingMyKeepers,
} from '../sync';
import { el } from './dom';
import { withBusy } from './overlay';

// Error text from the most recent save/withdraw, shown inline in the actions
// row. Only ever one team's controls are on screen, so a single slot is enough.
let actionError: string | null = null;

// Whether the "which team is yours?" picker is forced open. It shows itself
// when nothing is claimed; this covers re-opening it to switch teams.
let claimPickerOpen = false;

export function openClaimPicker(): void {
  claimPickerOpen = true;
}

function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? 'unknown time' : d.toLocaleString();
}

/** Run a shared-list write behind the blocking overlay, surfacing failures. */
async function runAction(message: string, action: () => Promise<void>, onChange: () => void) {
  actionError = null;
  try {
    await withBusy(message, action);
  } catch (e) {
    actionError = e instanceof Error ? e.message : 'Something went wrong';
  }
  onChange();
}

/**
 * "Which team is yours?" — shown when sync is on but this browser hasn't been
 * claimed by a manager yet.
 *
 * The setup screen's username lookup already resolves this for anyone who
 * signed in that way, so most managers never see it. It exists for the manual
 * league-ID path (which never learns a Sleeper user_id) and for switching
 * teams, and it lives here rather than in Settings because it gates the tab's
 * whole purpose: until it's answered, nobody can select a keeper.
 */
export function renderClaimTeamPrompt(onChange: () => void): HTMLElement | null {
  if (!canReadShared() || !state.rosters.length) return null;
  const mine = myRosterId();
  if (mine !== null && !claimPickerOpen) return null;

  const claimed = state.rosters
    .filter((r) => r.owner_id)
    .sort((a, b) => teamNameForRoster(a.roster_id).localeCompare(teamNameForRoster(b.roster_id)));

  const choices = el(
    'div',
    { class: 'claim-choices' },
    ...claimed.map((roster) =>
      el(
        'button',
        {
          class: 'claim-choice' + (roster.roster_id === mine ? ' current' : ''),
          onclick: () => {
            setCurrentUserId(roster.owner_id);
            // A different manager means a different editable team, so any edit
            // opened as the previous one no longer belongs to this browser.
            state.editingRosterId = null;
            claimPickerOpen = false;
            onChange();
          },
        },
        teamNameForRoster(roster.roster_id),
      ),
    ),
  );

  return el(
    'div',
    { class: 'claim-card' },
    el('div', { class: 'claim-title' }, 'Which team is yours?'),
    el(
      'div',
      { class: 'claim-sub' },
      state.currentUserId && mine === null
        ? 'The Sleeper account you looked up doesn’t own a team in this league. Pick yours to select and lock keepers.'
        : 'Pick your team to select and lock in your keepers. Everyone else’s picks stay read-only.',
    ),
    choices,
    mine !== null
      ? el(
          'button',
          {
            class: 'btn btn-ghost btn-sm',
            onclick: () => {
              claimPickerOpen = false;
              onChange();
            },
          },
          'Cancel',
        )
      : null,
  );
}

/**
 * The save/lock controls, shown only on the signed-in manager's own team.
 * Returns null when there's nothing to offer — no sync configured (the app is
 * purely local then), or this isn't your team.
 */
export function renderKeeperActions(rosterId: number, onChange: () => void): HTMLElement | null {
  if (!canReadShared() || myRosterId() !== rosterId) return null;

  const locked = isLockedRoster(rosterId);
  const editing = state.editingRosterId === rosterId;
  const row = el('div', { class: 'keeper-actions' });

  if (!canWriteShared()) {
    // Two different read-only states that need different things from the
    // reader: one is how this build was deployed, the other is a break someone
    // has to go fix.
    row.appendChild(
      isTokenRejected()
        ? el(
            'div',
            { class: 'keeper-actions-error' },
            `Saving is turned off — the league’s shared list token has expired. Your picks are safe in this browser, and everyone’s locked keepers still show. Reach out to ${LEAGUE_ADMIN} to renew it, then save again.`,
          )
        : el(
            'div',
            { class: 'keeper-actions-note' },
            'This build can’t save to the league — you can see everyone’s locked keepers but not publish your own.',
          ),
    );
    return row;
  }

  if (locked && !editing) {
    const lock = state.keeperLocks[String(rosterId)];
    row.appendChild(
      el(
        'div',
        { class: 'keeper-actions-note' },
        `Locked in for the league on ${formatSavedAt(lock.savedAt)}. Everyone else sees these picks.`,
      ),
    );
    row.appendChild(
      el(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          onclick: (e: Event) => {
            e.stopPropagation();
            startEditingMyKeepers();
            onChange();
          },
        },
        'Edit keepers',
      ),
    );
    row.appendChild(
      el(
        'button',
        {
          class: 'btn btn-ghost btn-sm btn-danger',
          title: 'Remove your picks from the league’s shared list entirely',
          onclick: (e: Event) => {
            e.stopPropagation();
            void runAction('Withdrawing your keepers…', clearMyKeepers, onChange);
          },
        },
        'Withdraw',
      ),
    );
  } else {
    row.appendChild(
      el(
        'div',
        { class: 'keeper-actions-note' },
        editing
          ? 'Editing — your saved picks stay visible to the league until you save again.'
          : 'These picks are only in this browser until you save them to the league.',
      ),
    );
    row.appendChild(
      el(
        'button',
        {
          class: 'btn btn-primary btn-sm',
          onclick: (e: Event) => {
            e.stopPropagation();
            void runAction('Saving your keepers to the league…', saveMyKeepers, onChange);
          },
        },
        'Save & lock keepers',
      ),
    );
    if (editing) {
      row.appendChild(
        el(
          'button',
          {
            class: 'btn btn-ghost btn-sm',
            onclick: (e: Event) => {
              e.stopPropagation();
              cancelEditingMyKeepers();
              onChange();
            },
          },
          'Cancel',
        ),
      );
    }
  }

  if (actionError) {
    row.appendChild(
      el(
        'div',
        { class: 'keeper-actions-error' },
        `${actionError}. Your picks are still saved in this browser — try again.`,
      ),
    );
  }
  return row;
}
