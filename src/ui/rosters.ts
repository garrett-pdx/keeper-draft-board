import { sleeper } from '../api/sleeper';
import {
  ensureAdpLoaded,
  ensureBoardRoundsLoaded,
  ensureOutlookLoaded,
  ensurePlayersLoaded,
  ensurePrevDraftLoaded,
  ensureTradedPicksLoaded,
  hasPrevDraft,
} from '../data';
import { outlookFor } from '../domain/outlook';
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
  userForRoster,
} from '../state';
import type { SleeperRoster, SurplusValue } from '../types';
import { displayNameFor, formatBirthDate, formatTime, starSignFor } from '../util';
import { $, el, setSpin } from './dom';
import { renderBoard } from './board';
import { renderDraft } from './draft';
import { updateAdpSourceBadge, updatePickSourceBadge } from './header';
import { openOutlookDrawer } from './outlookDrawer';

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
    try {
      await ensureTradedPicksLoaded(force);
    } catch {
      /* keeper costs assume untraded picks (capacity 1 everywhere) */
    }
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
    // Best-effort, same rationale as ADP — a player simply gets no outlook
    // teaser if this fails, nothing else on the page depends on it.
    try {
      await ensureOutlookLoaded(force);
    } catch {
      /* outlook teasers just won't render */
    }

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
      ? 'No ADP snapshot was available for this format, so value uses Sleeper’s overall ranking as a proxy. '
      : state.adpSource === 'adp'
        ? 'Market value comes from real ADP data from Fantasy Football Calculator. '
        : '';
  note.appendChild(
    el(
      'div',
      { class: 'info-note' },
      `Value = surplus between a player’s market round and their keeper cost round, with early-round surplus weighted more heavily (exponential curve). ${adpLabel}The two best-value keepers on each roster are outlined. "no ADP" means the player isn’t being drafted this year.`,
    ),
  );
}

// Which teams currently have their roster expanded. Session-only (not
// persisted) — the point is just to keep the initial view condensed, not to
// remember a choice across reloads.
const expandedRosters = new Set<number>();

function toggleRosterExpanded(rosterId: number): void {
  if (expandedRosters.has(rosterId)) expandedRosters.delete(rosterId);
  else expandedRosters.add(rosterId);
  renderRosters();
}

// Same idea, one level down: which individual player rows have their detail
// panel open. Keyed by "rosterId:playerId" rather than bare playerId — a
// player only ever rows under one roster, but the compound key costs nothing
// and avoids any cross-roster surprise if that ever changes.
const expandedPlayers = new Set<string>();

function togglePlayerExpanded(key: string): void {
  if (expandedPlayers.has(key)) expandedPlayers.delete(key);
  else expandedPlayers.add(key);
  renderRosters();
}

function detailRow(label: string, value: string): HTMLElement {
  return el(
    'div',
    { class: 'player-detail-row' },
    el('span', { class: 'player-detail-label' }, label),
    el('span', { class: 'player-detail-value' }, value),
  );
}

// Last season's final standings, 1st place first — Sleeper has no simple
// "previous season finish" endpoint already fetched here, so this is entered
// by hand from the league itself and matched against each roster's Sleeper
// display_name. Keep in sync each offseason.
const LAST_SEASON_STANDINGS = [
  'malstol',
  'tuckersdumbteam',
  'Gurret',
  'kshoyer',
  'mikestreinz',
  'BBrown16',
  'jonahcartwright',
  'paulslaats',
  'Kabroa',
  'TnT44',
];

// Index into LAST_SEASON_STANDINGS (0 = defending champion), or Infinity for
// an unclaimed/unmatched team so it sorts last rather than crashing the order.
function standingsRank(roster: SleeperRoster): number {
  const handle = userForRoster(roster.roster_id)?.display_name;
  if (!handle) return Infinity;
  const idx = LAST_SEASON_STANDINGS.findIndex((h) => h.toLowerCase() === handle.toLowerCase());
  return idx === -1 ? Infinity : idx;
}

export function renderRosters(): void {
  const container = $('#rostersContent')!;
  container.innerHTML = '';
  if (!state.rosters.length) {
    container.appendChild(
      el('div', { class: 'empty-state' }, 'No rosters found for this league yet.'),
    );
    return;
  }
  const grid = el('div', { class: 'roster-grid' });
  const sortedRosters = state.rosters.slice().sort((a, b) => {
    const ra = standingsRank(a);
    const rb = standingsRank(b);
    if (ra !== rb) return ra - rb; // last season's finish, best first
    return a.roster_id - b.roster_id; // stable fallback
  });
  for (const roster of sortedRosters) {
    grid.appendChild(renderTeamCard(roster));
  }
  container.appendChild(grid);
}

function renderTeamCard(roster: SleeperRoster): HTMLElement {
  const user = userForRoster(roster.roster_id);
  const teamName = displayNameFor(user);
  const ownerHandle = user ? '@' + user.display_name : 'Unclaimed team';
  const avatarUrl =
    user && user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null;

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

  const expanded = expandedRosters.has(roster.roster_id);
  const isChampion = standingsRank(roster) === 0;
  const listId = `roster-list-${roster.roster_id}`;
  const toggleExpanded = () => toggleRosterExpanded(roster.roster_id);

  const head = el(
    'div',
    {
      class: 'team-card-head',
      role: 'button',
      tabindex: '0',
      'aria-expanded': expanded ? 'true' : 'false',
      'aria-controls': listId,
      'aria-label': `${teamName} roster. Press to ${expanded ? 'collapse' : 'expand'}.`,
      onclick: toggleExpanded,
      onkeydown: (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' || ke.key === ' ') {
          ke.preventDefault();
          toggleExpanded();
        }
      },
    },
    el(
      'div',
      { class: 'team-avatar' },
      avatarUrl ? el('img', { src: avatarUrl, alt: '' }) : teamName[0] || '?',
    ),
    el(
      'div',
      { class: 'team-info' },
      el(
        'div',
        { class: 'team-name' },
        teamName,
        isChampion
          ? el('span', { class: 'champion-badge', title: 'Last season’s champion' }, '🏆')
          : null,
      ),
      el('div', { class: 'team-owner' }, ownerHandle),
    ),
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
    const oa = pa ? (POSITION_ORDER[pa.pos] ?? 6) : 6;
    const ob = pb ? (POSITION_ORDER[pb.pos] ?? 6) : 6;
    if (oa !== ob) return oa - ob;
    return potentialValue[b].value - potentialValue[a].value;
  });
  // top maxKeepers value candidates that actually have an ADP (positive-value, real market)
  const rankedCandidates = playerIds
    .filter((pid) => potentialValue[pid].hasAdp)
    .sort((a, b) => potentialValue[b].value - potentialValue[a].value)
    .slice(0, maxKeepers);
  const bestSet = new Set(rankedCandidates);

  const list = el('div', { class: 'team-roster-list', id: listId });
  if (!playerIds.length) {
    list.appendChild(
      el(
        'div',
        { class: 'player-row' },
        el('span', { class: 'player-sub' }, 'No players on this roster.'),
      ),
    );
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
    let cannotBeKeptWarning: HTMLElement | null = null;
    if (active && costByPlayer[pid]) {
      const c = costByPlayer[pid];
      resolvedCostRound = c.cost;
      if (c.cannotBeKept) {
        costTag = el(
          'span',
          {
            class: 'cost-tag error',
            title: `No available pick at round ${c.base} or any cheaper round on this team — this player cannot be kept.`,
          },
          `Can't keep`,
        );
        cannotBeKeptWarning = el(
          'div',
          { class: 'keeper-warn' },
          `No available pick at round ${c.base} or earlier — trades left this team without a pick to keep ${name} on. Deselect it or free up an earlier pick.`,
        );
      } else {
        costTag = el(
          'span',
          {
            class: 'cost-tag active' + (c.bumped ? ' bumped' : '') + (inflated ? ' inflated' : ''),
            title: c.bumped
              ? 'Bumped to a more expensive round due to a same-round collision or a traded-away pick on this team'
              : undrafted
                ? 'Undrafted last year — kept at the final round'
                : inflated
                  ? `Cost inflated: you kept this player last year (Rd ${prevRound}), so it climbs one round`
                  : 'Keeper cost',
          },
          `Rd ${c.cost}`,
        );
      }
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
    if (active && costByPlayer[pid]?.cannotBeKept) {
      valueBadge = el(
        'span',
        { class: 'val-tag na', title: 'This player cannot be kept — no meaningful value' },
        '—',
      );
    } else if (!sv.hasAdp) {
      valueBadge = el(
        'span',
        { class: 'val-tag na', title: 'Not being drafted this year — no market value' },
        'no ADP',
      );
    } else {
      const sign = sv.value > 0 ? '+' : '';
      const cls =
        'val-tag' +
        (sv.value > 0 ? ' pos' : sv.value < 0 ? ' neg' : '') +
        (bestSet.has(pid) ? ' best' : '');
      valueBadge = el(
        'span',
        {
          class: cls,
          title: 'Keeper surplus value (market vs. cost, early rounds weighted heavier)',
        },
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
          e.stopPropagation();
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

    const playerKey = `${roster.roster_id}:${pid}`;
    const playerExpanded = expandedPlayers.has(playerKey);
    const detailId = `player-detail-${roster.roster_id}-${pid}`;
    const togglePlayerDetail = () => togglePlayerExpanded(playerKey);

    const row = el(
      'div',
      {
        class: 'player-row' + (active ? ' is-keeper' : '') + (inflated ? ' is-inflated' : ''),
        role: 'button',
        tabindex: '0',
        'aria-expanded': playerExpanded ? 'true' : 'false',
        'aria-controls': detailId,
        'aria-label': `${name} details. Press to ${playerExpanded ? 'collapse' : 'expand'}.`,
        onclick: togglePlayerDetail,
        onkeydown: (e: Event) => {
          const ke = e as KeyboardEvent;
          if (ke.key === 'Enter' || ke.key === ' ') {
            ke.preventDefault();
            togglePlayerDetail();
          }
        },
      },
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
    );

    const cannotBeKept = active && costByPlayer[pid]?.cannotBeKept;
    const adpIsReal = state.adpSource === 'adp';
    const rawAdp = state.adpMap ? state.adpMap[pid] : undefined;
    const range = state.adpRangeMap[pid];

    const adpValueText = !sv.hasAdp
      ? 'No ADP — not being drafted this year'
      : adpIsReal && typeof rawAdp === 'number'
        ? `Pick ${rawAdp.toFixed(1)}`
        : typeof rawAdp === 'number'
          ? `Sleeper rank ${rawAdp} (no live ADP)`
          : '—';
    const highText = adpIsReal && range?.high != null ? `Pick ${range.high}` : '—';
    const lowText = adpIsReal && range?.low != null ? `Pick ${range.low}` : '—';
    const costText = cannotBeKept
      ? `Can't be kept — no available pick at Rd ${costByPlayer[pid]!.base} or earlier`
      : `Round ${resolvedCostRound}`;
    const valueText = cannotBeKept
      ? 'No meaningful value — this player cannot be kept'
      : sv.hasAdp
        ? `${sv.value > 0 ? '+' : ''}${sv.value.toFixed(1)}`
        : 'No ADP — not being drafted this year';
    const draftedText = undrafted ? 'Undrafted last year' : `Round ${prevRound}`;
    const inflationText = inflated
      ? `Yes — kept by this team last year at Rd ${prevRound}, cost climbs one round`
      : 'No';
    const birthDateText = formatBirthDate(p?.birthDate) || 'Unknown';
    const starSignText = starSignFor(p?.birthDate) || 'Unknown';

    const outlook = outlookFor(p?.espnId ?? null, state.outlookMap);
    const outlookBlock = outlook
      ? el(
          'div',
          {
            class: 'player-outlook',
            role: 'button',
            tabindex: '0',
            title: 'Tap for the full outlook',
            onclick: () => openOutlookDrawer(name, outlook),
            onkeydown: (e: Event) => {
              const ke = e as KeyboardEvent;
              if (ke.key === 'Enter' || ke.key === ' ') {
                ke.preventDefault();
                openOutlookDrawer(name, outlook);
              }
            },
          },
          outlook,
        )
      : el('div', { class: 'player-outlook player-outlook-empty' }, 'No outlook available.');

    const detailGrid = el(
      'div',
      { class: 'player-detail-grid' },
      detailRow('Position', pos),
      detailRow('NFL team', team || 'Free agent'),
      detailRow('Keeper cost', costText),
      detailRow('Keeper surplus value', valueText),
      detailRow('Average draft position', adpValueText),
      detailRow('Highest pick taken', highText),
      detailRow('Lowest pick taken', lowText),
      detailRow('Drafted last year', draftedText),
      detailRow('Repeat-keeper inflation', inflationText),
      detailRow('Birthdate', birthDateText),
      detailRow('Star sign', starSignText),
    );

    const detail = el('div', { class: 'player-detail', id: detailId }, outlookBlock, detailGrid);

    list.appendChild(
      el('div', { class: 'player-item' + (playerExpanded ? ' expanded' : '') }, row, detail),
    );
    if (cannotBeKeptWarning) list.appendChild(cannotBeKeptWarning);
  }

  return el(
    'div',
    { class: 'team-card' + (expanded ? ' expanded' : '') + (isChampion ? ' champion' : '') },
    head,
    list,
  );
}
