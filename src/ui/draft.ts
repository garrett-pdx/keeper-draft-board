import { ensureAdpLoaded, ensurePlayersLoaded } from '../data';
import { allKeeperIdsWithTeam, state } from '../state';
import { formatTime } from '../util';
import { $, el, setSpin } from './dom';
import { updateAdpSourceBadge } from './header';

export async function loadDraft(force?: boolean): Promise<void> {
  setSpin('draftSpin', true);
  ($('#refreshDraft') as HTMLButtonElement).disabled = true;
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
  } finally {
    setSpin('draftSpin', false);
    ($('#refreshDraft') as HTMLButtonElement).disabled = false;
  }
}

export function renderDraft(): void {
  const note = $('#draftNote')!;
  if (state.adpSource === 'adp') {
    note.textContent =
      'Ordered by real average draft position from Fantasy Football Calculator, refreshed twice weekly.';
  } else if (state.adpSource === 'rank') {
    note.textContent =
      'No ADP snapshot was available for this format, so this list falls back to Sleeper’s overall player ranking as a proxy.';
  } else {
    note.textContent = '';
  }

  const search = ($('#draftSearch') as HTMLInputElement).value.trim().toLowerCase();
  const posFilter = ($('#draftPosFilter') as HTMLSelectElement).value;
  const playersMap = state.playersMap || {};
  const adpMap = state.adpMap || {};
  const keeperMap = allKeeperIdsWithTeam();

  let rows = Object.keys(playersMap).map((pid) => {
    const p = playersMap[pid];
    return { pid, p, adp: pid in adpMap ? adpMap[pid] : 9999 };
  });

  rows = rows.filter((r) => r.p.pos && r.p.pos !== '—');
  if (posFilter) rows = rows.filter((r) => r.p.pos === posFilter);
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
        el('th', null, state.adpSource === 'rank' ? 'Rank' : 'ADP'),
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
