import { sleeper } from '../api/sleeper';
import {
  ensureAdpLoaded,
  ensureBoardRoundsLoaded,
  ensurePlayersLoaded,
  ensurePrevDraftLoaded,
  hasPrevDraft,
} from '../data';
import { NO_ADP_VALUE } from '../domain/value';
import {
  getRosterKeeperCostsFor,
  isInflatedFor,
  keeperSurplusValueFor,
  potentialKeeperCostFor,
} from '../selectors';
import {
  ensureBoardOrder,
  isKeeper,
  keeperListFor,
  POSITION_ORDER,
  state,
  toggleKeeper,
} from '../state';
import type { SleeperRoster, SurplusValue } from '../types';
import { displayNameFor, formatTime } from '../util';
import { $, el, setSpin } from './dom';
import { renderBoard } from './board';
import { renderDraft } from './draft';
import { updateAdpSourceBadge, updatePickSourceBadge } from './header';

export async function loadRosters(force?: boolean): Promise<void> {
  setSpin('rostersSpin', true);
  ($('#refreshRosters') as HTMLButtonElement).disabled = true;
  try {
    const [league, users, rosters] = await Promise.all([
      sleeper.league(state.leagueId!),
      sleeper.users(state.leagueId!),
      sleeper.rosters(state.leagueId!),
    ]);
    await ensurePlayersLoaded(force);

    state.league = league;
    state.users = users;
    state.rosters = rosters.sort((a, b) => a.roster_id - b.roster_id);

    await ensurePrevDraftLoaded(force);
    await ensureBoardRoundsLoaded(force); // needed for last-round keeper cost; also loads state.draft
    updatePickSourceBadge();
    ensureBoardOrder();
    // ADP powers the value metric; fetch it here but don't fail the whole roster
    // render if it's unavailable — costs still show, values just read "—".
    try {
      await ensureAdpLoaded(force);
    } catch {
      /* value badges will show as unavailable */
    }
    updateAdpSourceBadge();

    $('#leagueName')!.textContent = state.league.name || 'League';
    $('#leagueMeta')!.textContent = `${state.rosters.length} teams · ${state.league.season} season`;

    renderRostersNote();
    renderRosters();
    state.rostersLoadedAt = new Date();
    $('#rostersUpdated')!.textContent = formatTime(state.rostersLoadedAt);

    if (state.adpMap) renderDraft();
    if ($('#panel-board')!.classList.contains('active')) renderBoard();
  } catch {
    $('#rostersContent')!.innerHTML = '';
    $('#rostersContent')!.appendChild(
      el(
        'div',
        { class: 'error-banner' },
        el('strong', null, 'Could not load this league. '),
        document.createTextNode(
          'Check your connection and that the league ID is correct, then hit refresh.',
        ),
      ),
    );
  } finally {
    setSpin('rostersSpin', false);
    ($('#refreshRosters') as HTMLButtonElement).disabled = false;
  }
}

export function renderRostersNote(): void {
  const note = $('#rostersNote')!;
  note.innerHTML = '';
  if (state.prevDraftLoaded && Object.keys(state.prevDraftMap || {}).length === 0) {
    note.appendChild(
      el(
        'div',
        { class: 'info-note' },
        'No prior-season draft was found for this league, so undrafted-cost logic applies to everyone (final round). This is likely the league’s first season.',
      ),
    );
  }
  const adpLabel =
    state.adpSource === 'rank'
      ? 'Sleeper has no public ADP endpoint right now, so value uses Sleeper’s overall ranking as an ADP proxy. '
      : state.adpSource === 'adp'
        ? 'Market value comes from current Sleeper ADP. '
        : '';
  note.appendChild(
    el(
      'div',
      { class: 'info-note' },
      `Value = surplus between a player’s market round and their keeper cost round, with early-round surplus weighted more heavily (exponential curve). ${adpLabel}The two best-value keepers on each roster are outlined. "no ADP" means the player isn’t being drafted this year.`,
    ),
  );
}

export function renderRosters(): void {
  const container = $('#rostersContent')!;
  container.innerHTML = '';
  if (!state.rosters.length) {
    container.appendChild(el('div', { class: 'empty-state' }, 'No rosters found for this league yet.'));
    return;
  }
  const grid = el('div', { class: 'roster-grid' });
  const sortedRosters = state.rosters.slice().sort((a, b) => {
    const va = bestRosterKeeperValue(a);
    const vb = bestRosterKeeperValue(b);
    if (vb !== va) return vb - va; // highest best-keeper value first
    return a.roster_id - b.roster_id; // stable fallback
  });
  for (const roster of sortedRosters) {
    grid.appendChild(renderTeamCard(roster));
  }
  container.appendChild(grid);
}

// Best single keeper surplus available to a roster (ignoring collisions), used to
// order the team cards. Players with no current ADP contribute NO_ADP_VALUE.
function bestRosterKeeperValue(roster: SleeperRoster): number {
  const ids = roster.players || [];
  let best = -Infinity;
  for (const pid of ids) {
    const cr = potentialKeeperCostFor(pid, roster.roster_id);
    const sv = keeperSurplusValueFor(pid, cr, roster.roster_id);
    if (sv.value > best) best = sv.value;
  }
  return best === -Infinity ? NO_ADP_VALUE : best;
}

function renderTeamCard(roster: SleeperRoster): HTMLElement {
  const user = state.users.find((u) => u.user_id === roster.owner_id);
  const teamName = displayNameFor(user);
  const ownerHandle = user ? '@' + user.display_name : 'Unclaimed team';
  const avatarUrl = user && user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null;

  const keeperList = keeperListFor(roster.roster_id);
  const finalCosts = getRosterKeeperCostsFor(roster.roster_id);
  const costByPlayer: Record<string, (typeof finalCosts)[number]> = {};
  finalCosts.forEach((c) => (costByPlayer[c.playerId] = c));

  const maxKeepers = state.rules.maxKeepers;
  const countBadge = el(
    'div',
    { class: 'keeper-count' + (keeperList.length >= maxKeepers ? ' full' : '') },
    `Keepers ${keeperList.length}/${maxKeepers}`,
  );

  const head = el(
    'div',
    { class: 'team-card-head' },
    el('div', { class: 'team-avatar' }, avatarUrl ? el('img', { src: avatarUrl, alt: '' }) : teamName[0] || '?'),
    el('div', null, el('div', { class: 'team-name' }, teamName), el('div', { class: 'team-owner' }, ownerHandle)),
    countBadge,
  );

  const playerIds = (roster.players || []).slice();
  const playersMap = state.playersMap || {};

  // Per-player potential value (if this team kept them alone, ignoring collisions).
  // Computed before sorting so within-position order can rank by it.
  const potentialValue: Record<string, SurplusValue> = {};
  playerIds.forEach((pid) => {
    const cr = potentialKeeperCostFor(pid, roster.roster_id);
    potentialValue[pid] = keeperSurplusValueFor(pid, cr, roster.roster_id);
  });

  playerIds.sort((a, b) => {
    const pa = playersMap[a];
    const pb = playersMap[b];
    const oa = pa ? POSITION_ORDER[pa.pos] ?? 6 : 6;
    const ob = pb ? POSITION_ORDER[pb.pos] ?? 6 : 6;
    if (oa !== ob) return oa - ob;
    return potentialValue[b].value - potentialValue[a].value;
  });
  // top maxKeepers value candidates that actually have an ADP (positive-value, real market)
  const rankedCandidates = playerIds
    .filter((pid) => potentialValue[pid].hasAdp)
    .sort((a, b) => potentialValue[b].value - potentialValue[a].value)
    .slice(0, maxKeepers);
  const bestSet = new Set(rankedCandidates);

  const list = el('div', null);
  if (!playerIds.length) {
    list.appendChild(el('div', { class: 'player-row' }, el('span', { class: 'player-sub' }, 'No players on this roster.')));
  }
  for (const pid of playerIds) {
    const p = playersMap[pid];
    const name = p ? `${p.first} ${p.last}`.trim() : `Player ${pid}`;
    const pos = p ? p.pos : '—';
    const team = p ? p.team : '';
    const active = isKeeper(roster.roster_id, pid);
    const maxedOut = !active && keeperList.length >= maxKeepers;

    const undrafted = !hasPrevDraft(pid);
    const inflated = isInflatedFor(pid, roster.roster_id);
    const prevRound =
      state.prevDraftMap && state.prevDraftMap[pid] ? state.prevDraftMap[pid].round : null;
    let costTag: HTMLElement;
    let resolvedCostRound: number;
    if (active && costByPlayer[pid]) {
      const c = costByPlayer[pid];
      resolvedCostRound = c.cost;
      costTag = el(
        'span',
        {
          class: 'cost-tag active' + (c.bumped ? ' bumped' : '') + (inflated ? ' inflated' : ''),
          title: c.bumped
            ? 'Bumped one round due to a same-round keeper collision on this team'
            : undrafted
              ? 'Undrafted last year — kept at the final round'
              : inflated
                ? `Cost inflated: you kept this player last year (Rd ${prevRound}), so it climbs one round`
                : 'Keeper cost',
        },
        `Rd ${c.cost}`,
      );
    } else {
      resolvedCostRound = potentialKeeperCostFor(pid, roster.roster_id);
      costTag = el(
        'span',
        {
          class: 'cost-tag' + (inflated ? ' inflated' : ''),
          title: undrafted
            ? 'Undrafted last year — kept at the final round'
            : inflated
              ? `Cost inflated: you kept this player last year (Rd ${prevRound}), so it climbs one round`
              : 'Round this player would cost as a keeper',
        },
        `Rd ${resolvedCostRound}`,
      );
    }

    const inflatedMark = inflated
      ? el(
          'span',
          {
            class: 'inflate-mark',
            title: `Kept by this team last year at Rd ${prevRound} — cost climbs a round`,
          },
          `↑ Rd ${prevRound}`,
        )
      : null;

    const sv =
      active && costByPlayer[pid]
        ? { value: costByPlayer[pid].value, hasAdp: costByPlayer[pid].hasAdp }
        : keeperSurplusValueFor(pid, resolvedCostRound, roster.roster_id);
    let valueBadge: HTMLElement;
    if (!sv.hasAdp) {
      valueBadge = el('span', { class: 'val-tag na', title: 'Not being drafted this year — no market value' }, 'no ADP');
    } else {
      const sign = sv.value > 0 ? '+' : '';
      const cls =
        'val-tag' +
        (sv.value > 0 ? ' pos' : sv.value < 0 ? ' neg' : '') +
        (bestSet.has(pid) ? ' best' : '');
      valueBadge = el(
        'span',
        { class: cls, title: 'Keeper surplus value (market vs. cost, early rounds weighted heavier)' },
        `${sign}${sv.value.toFixed(1)}`,
      );
    }

    const toggle = el(
      'button',
      {
        class: 'keeper-toggle' + (active ? ' active' : '') + (maxedOut ? ' disabled' : ''),
        title: active
          ? 'Remove keeper'
          : maxedOut
            ? `Max ${maxKeepers} keepers selected`
            : 'Mark as keeper',
        onclick: (e: Event) => {
          const target = e.currentTarget as HTMLElement;
          if (maxedOut) {
            target.classList.add('shake');
            setTimeout(() => target.classList.remove('shake'), 300);
            return;
          }
          toggleKeeper(roster.roster_id, pid);
          renderRosters();
          if (state.adpMap) renderDraft();
          if ($('#panel-board')!.classList.contains('active')) renderBoard();
        },
      },
      active ? '★' : '☆',
    );

    list.appendChild(
      el(
        'div',
        { class: 'player-row' + (active ? ' is-keeper' : '') + (inflated ? ' is-inflated' : '') },
        el('span', { class: 'pos-tag pos-' + pos }, pos),
        el(
          'div',
          { class: 'player-info' },
          el('div', { class: 'player-name' }, name),
          el('div', { class: 'player-sub' }, team, inflatedMark),
        ),
        valueBadge,
        costTag,
        toggle,
      ),
    );
  }

  return el('div', { class: 'team-card' }, head, list);
}
