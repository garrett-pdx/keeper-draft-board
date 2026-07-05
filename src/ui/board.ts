import {
  ensureAdpLoaded,
  ensureBoardRoundsLoaded,
  ensurePlayersLoaded,
  ensurePrevDraftLoaded,
} from '../data';
import { getRosterKeeperCostsFor } from '../selectors';
import { ensureBoardOrder, saveBoardOrder, state } from '../state';
import type { KeeperCostItem, SleeperRoster } from '../types';
import { displayNameFor, formatTime } from '../util';
import { $, el, setSpin } from './dom';
import { updateAdpSourceBadge } from './header';

function reorderBoardColumns(draggedId: string, targetId: string): void {
  if (draggedId === targetId) return;
  const order = (state.boardOrder || []).slice();
  const from = order.indexOf(draggedId);
  const to = order.indexOf(targetId);
  if (from === -1 || to === -1) return;
  order.splice(from, 1);
  order.splice(to, 0, draggedId);
  state.boardOrder = order;
  saveBoardOrder();
  renderBoard();
}

export async function loadBoard(force?: boolean): Promise<void> {
  setSpin('boardSpin', true);
  ($('#refreshBoard') as HTMLButtonElement).disabled = true;
  try {
    await ensurePlayersLoaded(force);
    await ensurePrevDraftLoaded(force);
    await ensureBoardRoundsLoaded(force);
    try {
      await ensureAdpLoaded(force);
    } catch {
      /* values will read as unavailable */
    }
    updateAdpSourceBadge();
    ensureBoardOrder();
    renderBoard();
    state.boardLoadedAt = new Date();
    $('#boardUpdated')!.textContent = formatTime(state.boardLoadedAt);
  } catch {
    $('#boardContent')!.innerHTML = '';
    $('#boardContent')!.appendChild(
      el(
        'div',
        { class: 'error-banner' },
        el('strong', null, 'Could not build the draft board. '),
        document.createTextNode('Check your connection, then hit refresh.'),
      ),
    );
  } finally {
    setSpin('boardSpin', false);
    ($('#refreshBoard') as HTMLButtonElement).disabled = false;
  }
}

export function renderBoard(): void {
  const container = $('#boardContent')!;
  container.innerHTML = '';
  if (!state.rosters.length || !state.boardOrder) {
    container.appendChild(el('div', { class: 'empty-state' }, 'Load the Rosters tab first, then come back here.'));
    return;
  }
  const playersMap = state.playersMap || {};
  const rosterById: Record<string, SleeperRoster> = {};
  state.rosters.forEach((r) => (rosterById[String(r.roster_id)] = r));
  const rounds = state.boardRounds || 15;

  // pre-compute each roster's keeper placements: round -> { players: [...] }
  const placements: Record<string, Record<number, { players: KeeperCostItem[] }>> = {};
  state.rosters.forEach((r) => {
    const rid = String(r.roster_id);
    const costs = getRosterKeeperCostsFor(r.roster_id);
    const byRound: Record<number, { players: KeeperCostItem[] }> = {};
    costs.forEach((c) => {
      if (c.cost !== null) {
        byRound[c.cost] = byRound[c.cost] || { players: [] };
        byRound[c.cost].players.push(c);
      }
    });
    placements[rid] = byRound;
  });

  const table = el('table', { class: 'board-table' });
  const thead = el('thead');
  const headRow = el('tr');
  headRow.appendChild(el('th', { class: 'round-col' }, 'Rd'));
  for (const rid of state.boardOrder) {
    const roster = rosterById[rid];
    if (!roster) continue;
    const user = state.users.find((u) => u.user_id === roster.owner_id);
    const teamName = displayNameFor(user);
    const th = el(
      'th',
      {
        draggable: 'true',
        'data-roster-id': rid,
        ondragstart: (e: Event) => {
          const de = e as DragEvent;
          de.dataTransfer!.setData('text/plain', rid);
          (de.currentTarget as HTMLElement).classList.add('dragging');
        },
        ondragend: (e: Event) => (e.currentTarget as HTMLElement).classList.remove('dragging'),
        ondragover: (e: Event) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.add('drop-target');
        },
        ondragleave: (e: Event) => (e.currentTarget as HTMLElement).classList.remove('drop-target'),
        ondrop: (e: Event) => {
          const de = e as DragEvent;
          de.preventDefault();
          (de.currentTarget as HTMLElement).classList.remove('drop-target');
          const draggedId = de.dataTransfer!.getData('text/plain');
          reorderBoardColumns(draggedId, rid);
        },
      },
      el(
        'div',
        { class: 'board-th-inner' },
        el('span', { class: 'drag-handle' }, '⋮⋮'),
        el('span', { class: 'th-team' }, teamName),
      ),
    );
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (let round = 1; round <= rounds; round++) {
    const tr = el('tr');
    tr.appendChild(el('td', { class: 'round-col' }, String(round)));
    for (const rid of state.boardOrder) {
      const roster = rosterById[rid];
      if (!roster) continue;
      const cellData = placements[rid] && placements[rid][round];
      let cellContent: HTMLElement;
      if (cellData && cellData.players && cellData.players.length) {
        const parts = cellData.players.map((c) => {
          const p = playersMap[c.playerId];
          const name = p ? `${p.first} ${p.last}`.trim() : c.playerId;
          const pos = p ? p.pos : '';
          let valEl: HTMLElement | null = null;
          if (c.hasAdp === false) {
            valEl = el('span', { class: 'val-tag na', title: 'Not being drafted this year' }, 'no ADP');
          } else if (typeof c.value === 'number') {
            const sign = c.value > 0 ? '+' : '';
            valEl = el(
              'span',
              {
                class: 'val-tag' + (c.value > 0 ? ' pos' : c.value < 0 ? ' neg' : ''),
                title: 'Keeper surplus value',
              },
              `${sign}${c.value.toFixed(1)}`,
            );
          }
          return el(
            'div',
            { class: 'board-cell-player' },
            el('div', { class: 'bp-name' }, name),
            el(
              'div',
              { class: 'bp-meta' },
              pos ? el('span', { class: 'pos-tag pos-' + pos }, pos) : null,
              valEl,
              c.bumped ? el('span', { class: 'board-warn' }, 'bumped') : null,
            ),
          );
        });
        const collisionWarn =
          cellData.players.length > 1
            ? el('div', { class: 'board-warn' }, 'Same-round collision — resolve manually')
            : null;
        cellContent = el('div', null, parts, collisionWarn);
      } else {
        cellContent = el('span', { class: 'board-cell-empty' }, '—');
      }
      tr.appendChild(el('td', { class: 'board-cell' + (cellData ? ' has-player' : '') }, cellContent));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const wrap = el('div', { class: 'table-scroll' }, table);
  container.appendChild(wrap);
}
