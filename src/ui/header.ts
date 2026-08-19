import { canReadShared, canWriteShared, isTokenRejected, LEAGUE_ADMIN } from '../api/gist';
import { hasKnownDraftOrder } from '../domain/draftOrder';
import { myRosterId, state, teamNameForRoster } from '../state';
import { $ } from './dom';

// Keep the always-visible ADP data-source badge in sync with state.adpSource, so
// the (undocumented) ADP source vs. rank-proxy fallback is never silent.
//
// Labels are deliberately terse — four of these chips share one header row and
// the full source names ran a phone's header to four rows. What may NOT be
// traded away for brevity is which source is in use: a value ranking is never
// called ADP, and mock-draft ADP is never called real-league ADP. Each badge's
// `title` still carries the full name and provenance, and the menu it opens
// spells both out.
export function updateAdpSourceBadge(): void {
  const badge = $('#adpSourceBadge');
  if (!badge) return;
  if (!state.adpSource) {
    badge.setAttribute('hidden', '');
    return;
  }
  badge.removeAttribute('hidden');
  if (state.adpSource === 'value') {
    // Deliberately NOT labelled "ADP": this is a trade-value ranking used as an
    // implied pick, and calling it average draft position would misdescribe it.
    badge.className = 'adp-badge adp-badge-live';
    badge.textContent = 'Value · FantasyCalc';
    badge.title =
      'Player value ranking from FantasyCalc (fantasycalc.com), refreshed daily and matched by Sleeper id. This is “how good is this player”, used as an implied draft pick — not real average draft position. Tap to switch sources.';
  } else if (state.adpSource === 'adp') {
    badge.className = 'adp-badge adp-badge-live';
    badge.textContent = 'ADP · FF Calculator';
    badge.title =
      'Average draft position from Fantasy Football Calculator (fantasyfootballcalculator.com), refreshed daily. Drawn from mock drafts run on their site. Tap to switch sources.';
  } else if (state.adpSource === 'blend') {
    // Not labelled "ADP" for the same reason the value rank isn't: two of its
    // three inputs are average draft position and one is a value ranking, so
    // the result is a consensus estimate rather than a measurement.
    badge.className = 'adp-badge adp-badge-live';
    badge.textContent = 'Blend · 3 sources';
    badge.title =
      'The average of FantasyCalc’s value rank, Fantasy Football Calculator’s mock-draft ADP and MyFantasyLeague’s real-league ADP, taken per player over whichever of them price him. Smooths any one source’s bad week; not a measurement of any single market. Tap to switch sources.';
  } else if (state.adpSource === 'adp-real') {
    // Named separately from 'adp' on purpose: both are average draft position,
    // but one is mock drafts and the other is leagues people paid to host, and
    // which one you're looking at changes how much to trust it.
    badge.className = 'adp-badge adp-badge-live';
    badge.textContent = 'ADP · MFL real drafts';
    badge.title =
      'Average draft position from real, non-mock redraft leagues hosted on MyFantasyLeague (myfantasyleague.com), refreshed daily. Smaller sample than the mock-draft data, and quarterbacks are not priced — that pool blends 1QB and superflex leagues. Tap to switch sources.';
  } else {
    badge.className = 'adp-badge adp-badge-proxy';
    badge.textContent = 'ADP · rank proxy';
    badge.title =
      'No ADP snapshot was available for this format, so value uses Sleeper’s overall player ranking as a proxy. Tap to switch sources.';
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
  badge.textContent = 'Exact pick #s';
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
    badge.textContent = 'Sync · offline';
    badge.title =
      'Could not reach the league’s shared keeper list. Your picks are still saved in this browser — hit Refresh to retry.';
  } else if (state.syncStatus === 'syncing') {
    badge.className = 'adp-badge adp-badge-proxy';
    badge.textContent = 'Sync · syncing…';
    badge.title = 'Fetching the league’s shared keeper picks.';
  } else if (isTokenRejected()) {
    // Reads still work (they fall back to unauthenticated), so this isn't
    // "offline" — it's specifically saving that's broken, and it needs a person
    // rather than a retry.
    badge.className = 'adp-badge adp-badge-error';
    badge.textContent = 'Sync · token expired';
    badge.title = `Everyone’s locked keepers still load, but saving is turned off until the shared list’s access token is renewed. Reach out to ${LEAGUE_ADMIN}.`;
  } else if (!canWriteShared()) {
    badge.className = 'adp-badge adp-badge-proxy';
    badge.textContent = 'Sync · read-only';
    badge.title =
      'You can see everyone’s locked keepers, but this build has no write access to save your own.';
  } else {
    badge.className = 'adp-badge adp-badge-live';
    badge.textContent = 'Sync · on';
    badge.title = 'Keeper picks are shared with the whole league.';
  }
}
