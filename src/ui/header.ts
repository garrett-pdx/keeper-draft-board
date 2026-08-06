import { canReadShared, canWriteShared, isTokenRejected, LEAGUE_ADMIN } from '../api/gist';
import { hasKnownDraftOrder } from '../domain/draftOrder';
import { myRosterId, state, teamNameForRoster } from '../state';
import { $ } from './dom';

// Keep the always-visible ADP data-source badge in sync with state.adpSource, so
// the (undocumented) ADP source vs. rank-proxy fallback is never silent.
export function updateAdpSourceBadge(): void {
  const badge = $('#adpSourceBadge');
  if (!badge) return;
  if (!state.adpSource) {
    badge.setAttribute('hidden', '');
    return;
  }
  badge.removeAttribute('hidden');
  if (state.adpSource === 'adp') {
    badge.className = 'adp-badge adp-badge-live';
    badge.textContent = 'ADP · Fantasy Football Calculator';
    badge.title =
      'Real average draft position from Fantasy Football Calculator (fantasyfootballcalculator.com), refreshed daily.';
  } else {
    badge.className = 'adp-badge adp-badge-proxy';
    badge.textContent = 'ADP · rank proxy';
    badge.title =
      'No ADP snapshot was available for this format, so value uses Sleeper’s overall player ranking as a proxy.';
  }
}

// Hidden until this season's real draft order is actually known (most of the
// season, it isn't — see hasKnownDraftOrder). Only then do keeper values use
// exact pick numbers instead of the round-midpoint approximation.
export function updatePickSourceBadge(): void {
  const badge = $('#pickSourceBadge');
  if (!badge) return;
  if (!hasKnownDraftOrder(state.draft)) {
    badge.setAttribute('hidden', '');
    return;
  }
  badge.removeAttribute('hidden');
  badge.className = 'adp-badge adp-badge-live';
  badge.textContent = 'Pick #s · exact draft order';
  badge.title =
    'Keeper values use this team’s actual pick number in each round, from the set draft order.';
}

// Who this browser is acting as, and therefore whose keepers it can edit.
// Hidden entirely when there's no shared gist — without sync there's no
// ownership to enforce and the identity is meaningless.
export function updateIdentityBadge(): void {
  const badge = $('#identityBadge');
  if (!badge) return;
  if (!canReadShared() || !state.rosters.length) {
    badge.setAttribute('hidden', '');
    return;
  }
  badge.removeAttribute('hidden');
  const mine = myRosterId();
  if (mine === null) {
    badge.className = 'adp-badge adp-badge-proxy';
    badge.textContent = state.currentUserId ? 'No team in this league' : 'Pick your team';
    badge.title = state.currentUserId
      ? 'The Sleeper account you looked up doesn’t own a team in this league. Choose yours on the Rosters tab.'
      : 'Choose which team is yours to select and lock your keepers.';
    return;
  }
  badge.className = 'adp-badge adp-badge-live';
  badge.textContent = `You: ${teamNameForRoster(mine)}`;
  badge.title = 'You can select and lock keepers for this team only. Click to switch teams.';
}

// Whether the league's shared picks are reachable, and whether this browser can
// write to them. A read-only deploy (gist configured, no token) is a normal,
// supported state — say so rather than looking broken.
export function updateSyncBadge(): void {
  const badge = $('#syncBadge');
  if (!badge) return;
  if (state.syncStatus === 'off') {
    badge.setAttribute('hidden', '');
    return;
  }
  badge.removeAttribute('hidden');
  if (state.syncStatus === 'error') {
    badge.className = 'adp-badge adp-badge-error';
    badge.textContent = 'League sync · offline';
    badge.title =
      'Could not reach the league’s shared keeper list. Your picks are still saved in this browser — hit Refresh to retry.';
  } else if (state.syncStatus === 'syncing') {
    badge.className = 'adp-badge adp-badge-proxy';
    badge.textContent = 'League sync · syncing…';
    badge.title = 'Fetching the league’s shared keeper picks.';
  } else if (isTokenRejected()) {
    // Reads still work (they fall back to unauthenticated), so this isn't
    // "offline" — it's specifically saving that's broken, and it needs a person
    // rather than a retry.
    badge.className = 'adp-badge adp-badge-error';
    badge.textContent = 'League sync · token expired';
    badge.title = `Everyone’s locked keepers still load, but saving is turned off until the shared list’s access token is renewed. Reach out to ${LEAGUE_ADMIN}.`;
  } else if (!canWriteShared()) {
    badge.className = 'adp-badge adp-badge-proxy';
    badge.textContent = 'League sync · read-only';
    badge.title =
      'You can see everyone’s locked keepers, but this build has no write access to save your own.';
  } else {
    badge.className = 'adp-badge adp-badge-live';
    badge.textContent = 'League sync · on';
    badge.title = 'Keeper picks are shared with the whole league.';
  }
}
