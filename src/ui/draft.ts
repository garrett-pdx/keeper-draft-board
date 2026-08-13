import { ensureAdpLoaded, ensurePlayersLoaded } from '../data';
import { slotStartsPosition, startablePositions } from '../domain/leagueSettings';
import { allKeeperIdsWithTeam } from '../selectors';
import { state } from '../state';
import { formatTime } from '../util';
import { $, el } from './dom';
import { updateAdpSourceBadge } from './header';
import { syncPositionFilterOptions } from './positionFilter';

export async function loadDraft(force?: boolean): Promise<void> {
  try {
    await ensurePlayersLoaded(force);
    await ensureAdpLoaded(force);
    updateAdpSourceBadge();
    renderDraft();
    state.draftLoadedAt = new Date();
    $('#draftUpdated')!.textContent = formatTime(state.draftLoadedAt);
  } catch {
    $('#draftContent')!.innerHTML = '';
    $('#draftContent')!.appendChild(
      el(
        'div',
        { class: 'error-banner' },
        el('strong', null, 'Could not load draft data. '),
        document.createTextNode('Check your connection, then hit refresh.'),
      ),
    );
  }
}

export function renderDraft(): void {
  const note = $('#draftNote')!;
  if (state.adpSource === 'value') {
    note.textContent =
      'Ordered by FantasyCalc’s value ranking (how good a player is, used as an implied pick) — not real average draft position. Switch to ADP in Settings.';
  } else if (state.adpSource === 'adp') {
    note.textContent =
      'Ordered by average draft position from Fantasy Football Calculator’s mock drafts, refreshed daily.';
  } else if (state.adpSource === 'blend') {
    note.textContent =
      'Ordered by the average of all three market sources — FantasyCalc value, Fantasy Football Calculator mock ADP, and MyFantasyLeague real-league ADP — taken per player over whichever of them price him.';
  } else if (state.adpSource === 'adp-real') {
    note.textContent =
      'Ordered by average draft position in real, non-mock redraft leagues on MyFantasyLeague, refreshed daily. Quarterbacks are absent — that pool mixes 1QB and superflex leagues, so QB ADP would be wrong for this league.';
  } else if (state.adpSource === 'rank') {
    note.textContent =
      'No ADP snapshot was available for this format, so this list falls back to Sleeper’s overall player ranking as a proxy.';
  } else {
    note.textContent = '';
  }

  const search = ($('#draftSearch') as HTMLInputElement).value.trim().toLowerCase();
  const posSelect = $('#draftPosFilter') as HTMLSelectElement;
  syncPositionFilterOptions(posSelect);
  const posFilter = posSelect.value;
  const hideKept = ($('#draftHideKept') as HTMLInputElement).checked;
  const playersMap = state.playersMap || {};
  const adpMap = state.adpMap || {};
  const keeperMap = allKeeperIdsWithTeam();
  // A position this league has no slot for can never be started, so it's noise
  // on the one tab whose whole job is "who can I draft". Empty means the
  // lineup isn't known yet — show everything rather than nothing.
  const startable = startablePositions(state.league?.roster_positions);

  let rows = Object.keys(playersMap).map((pid) => {
    const p = playersMap[pid];
    return { pid, p, adp: pid in adpMap ? adpMap[pid] : 9999 };
  });

  rows = rows.filter((r) => r.p.pos && r.p.pos !== '—');
  if (startable.length) rows = rows.filter((r) => startable.includes(r.p.pos));
  if (posFilter) rows = rows.filter((r) => slotStartsPosition(r.p.pos, posFilter));
  if (hideKept) rows = rows.filter((r) => !keeperMap.has(r.pid));
  if (search) {
    rows = rows.filter((r) => `${r.p.first} ${r.p.last}`.toLowerCase().includes(search));
  }
  rows.sort((a, b) => a.adp - b.adp);
  rows = rows.slice(0, 400);

  const container = $('#draftContent')!;
  container.innerHTML = '';
  const wrap = el('div', { class: 'table-scroll' });
  const table = el('table', { class: 'draft-table' });
  table.appendChild(
    el(
      'thead',
      null,
      el(
        'tr',
        null,
        // Deliberately not always "ADP" — a value rank is a different quantity
        // and mislabeling it would misdescribe the sort, same principle as the
        // header badge (see updateAdpSourceBadge in ui/header.ts).
        el(
          'th',
          null,
          state.adpSource === 'value' ? 'Value' : state.adpSource === 'rank' ? 'Rank' : 'ADP',
        ),
        el('th', null, 'Player'),
        el('th', null, 'Pos'),
        el('th', null, 'Team'),
      ),
    ),
  );
  const tbody = el('tbody');
  if (!rows.length) {
    tbody.appendChild(el('tr', null, el('td', { colspan: '4' }, 'No players match your filters.')));
  }
  for (const r of rows) {
    const keptBy = keeperMap.get(r.pid);
    const tr = el(
      'tr',
      { class: keptBy ? 'kept' : '' },
      el('td', { class: 'rank-cell' }, r.adp >= 9999 ? '—' : r.adp.toFixed(1)),
      el(
        'td',
        null,
        `${r.p.first} ${r.p.last}`.trim(),
        keptBy
          ? el(
              'span',
              { style: 'margin-left:8px;' },
              el('span', { class: 'kept-tag' }, `KEPT · ${keptBy}`),
            )
          : null,
      ),
      el('td', null, el('span', { class: 'pos-tag pos-' + r.p.pos }, r.p.pos)),
      el('td', null, r.p.team),
    );
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}
