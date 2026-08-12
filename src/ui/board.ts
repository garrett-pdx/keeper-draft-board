import {
  ensureAdpLoaded,
  ensureBoardRoundsLoaded,
  ensurePlayersLoaded,
  ensurePrevDraftLoaded,
  ensureTradedPicksLoaded,
} from '../data';
import { exactPickForRoster } from '../domain/draftOrder';
import { pickCapacity } from '../domain/tradedPicks';
import {
  currentSlot,
  isMyTurn,
  mockDraftRosterMismatch,
  openPickerForCurrentTurn,
  resumeMockDraft,
} from '../mockDraft';
import { getRosterKeeperCostsFor } from '../selectors';
import {
  ensureBoardOrder,
  markBoardOrderCustomized,
  myRosterId,
  saveBoardOrder,
  state,
  teamNameForRoster,
} from '../state';
import type { KeeperCostItem, SleeperRoster } from '../types';
import { formatTime } from '../util';
import { $, el } from './dom';
import { updateAdpSourceBadge, updatePickSourceBadge } from './header';

function reorderBoardColumns(draggedId: string, targetId: string): void {
  if (draggedId === targetId) return;
  const order = (state.boardOrder || []).slice();
  const from = order.indexOf(draggedId);
  const to = order.indexOf(targetId);
  if (from === -1 || to === -1) return;
  order.splice(from, 1);
  order.splice(to, 0, draggedId);
  state.boardOrder = order;
  markBoardOrderCustomized();
  saveBoardOrder();
  renderBoard();
  // renderBoard() rebuilds the whole table, destroying the focused <th> —
  // re-find it by its stable data-roster-id and refocus after the repaint.
  requestAnimationFrame(() => {
    const th = $(`.board-table th[data-roster-id="${draggedId}"]`) as HTMLElement | null;
    th?.focus();
  });
}

function moveColumn(rid: string, direction: -1 | 1): void {
  const order = state.boardOrder || [];
  const from = order.indexOf(rid);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= order.length) return;
  reorderBoardColumns(rid, order[to]);
}

export async function loadBoard(force?: boolean): Promise<void> {
  try {
    await ensurePlayersLoaded(force);
    await ensurePrevDraftLoaded(force);
    await ensureBoardRoundsLoaded(force); // also loads state.draft
    try {
      await ensureTradedPicksLoaded(force);
    } catch {
      /* keeper costs assume untraded picks (capacity 1 everywhere) */
    }
    try {
      await ensureAdpLoaded(force);
    } catch {
      /* values will read as unavailable */
    }
    updateAdpSourceBadge();
    updatePickSourceBadge();
    ensureBoardOrder();
    resumeMockDraft();
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
  }
}

/** Start/Reset visibility + the status readout, kept in sync on every render. */
function renderMockDraftControls(): void {
  const startBtn = $('#startMockDraftBtn') as HTMLButtonElement | null;
  const resetBtn = $('#resetMockDraftBtn') as HTMLButtonElement | null;
  const statusEl = $('#mockDraftStatus');
  if (!startBtn || !resetBtn || !statusEl) return;

  const md = state.mockDraft;
  if (!md) {
    startBtn.hidden = false;
    startBtn.disabled = myRosterId() === null;
    startBtn.title = startBtn.disabled ? 'Claim your team on the Rosters tab first' : '';
    resetBtn.hidden = true;
    statusEl.hidden = true;
    return;
  }

  startBtn.hidden = true;
  resetBtn.hidden = false;
  statusEl.hidden = false;
  if (mockDraftRosterMismatch()) {
    statusEl.textContent = 'Mock draft: your league’s rosters changed — reset to continue.';
  } else if (!md.active) {
    statusEl.textContent = 'Mock draft complete.';
  } else {
    const slot = currentSlot();
    statusEl.textContent = slot
      ? `Mock draft: Round ${slot.round} — ${isMyTurn() ? 'your pick' : 'on the clock'}`
      : 'Mock draft in progress…';
  }
}

export function renderBoard(): void {
  renderMockDraftControls();
  const container = $('#boardContent')!;
  container.innerHTML = '';
  if (!state.rosters.length || !state.boardOrder) {
    container.appendChild(
      el('div', { class: 'empty-state' }, 'Load the Rosters tab first, then come back here.'),
    );
    return;
  }
  const noKeeperCost = state.rules.noKeeperCost;
  const noteEl = $('#boardNote');
  if (noteEl) {
    noteEl.textContent = noKeeperCost
      ? 'This league keeps players for free (taxi squad) — every round is open, and kept players are listed below instead.'
      : 'Drag a column header to reorder teams. Only keeper picks are filled in — everything else opens up on draft day.';
  }
  const playersMap = state.playersMap || {};
  const rosterById: Record<string, SleeperRoster> = {};
  state.rosters.forEach((r) => (rosterById[String(r.roster_id)] = r));
  const rounds = state.boardRounds || 15;
  const teamCount = state.rosters.length || 10;
  const trades = state.tradedPicks || [];

  // Flatten the mock draft's frozen slot/pick arrays into the same
  // round×roster cell shape `placements` already uses below, so the cell
  // loop can treat them uniformly. A mismatched-roster mock draft is left
  // out entirely — the banner below tells the manager to reset instead of
  // rendering picks against roster ids that may no longer exist.
  const mockMismatch = mockDraftRosterMismatch();
  const mockPlacements: Record<string, Record<number, string[]>> = {};
  if (state.mockDraft && !mockMismatch) {
    state.mockDraft.slots.forEach((slot, i) => {
      const pid = state.mockDraft!.picks[i];
      if (!pid) return;
      const rid = String(slot.rosterId);
      mockPlacements[rid] = mockPlacements[rid] || {};
      (mockPlacements[rid][slot.round] = mockPlacements[rid][slot.round] || []).push(pid);
    });
  }
  const pendingSlot = state.mockDraft?.active && !mockMismatch ? currentSlot() : null;

  if (mockMismatch) {
    container.appendChild(
      el(
        'div',
        { class: 'error-banner board-mock-mismatch' },
        'Your league’s rosters changed since this mock draft started, so it can’t continue safely. ',
        'Reset Draft to start a fresh one.',
      ),
    );
  }

  // pre-compute each roster's keeper placements: round -> { players: [...] }.
  // Keepers that cannotBeKept occupy no round — collected separately for the
  // alert area below instead. In taxi squad mode (noKeeperCost) no keeper
  // occupies a round at all — they're collected into taxiSquadByRoster and
  // shown as a summary list above the (fully open) grid instead.
  const placements: Record<string, Record<number, { players: KeeperCostItem[] }>> = {};
  const unkeepable: { rid: string; item: KeeperCostItem }[] = [];
  const taxiSquadByRoster: { rid: string; items: KeeperCostItem[] }[] = [];
  state.rosters.forEach((r) => {
    const rid = String(r.roster_id);
    const costs = getRosterKeeperCostsFor(r.roster_id);
    if (noKeeperCost) {
      if (costs.length) taxiSquadByRoster.push({ rid, items: costs });
      placements[rid] = {};
      return;
    }
    const byRound: Record<number, { players: KeeperCostItem[] }> = {};
    costs.forEach((c) => {
      if (c.cannotBeKept) {
        unkeepable.push({ rid, item: c });
      } else if (c.cost !== null) {
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
    const teamName = teamNameForRoster(roster.roster_id);
    const th = el(
      'th',
      {
        draggable: 'true',
        'data-roster-id': rid,
        tabindex: '0',
        role: 'button',
        'aria-label': `${teamName} column. Press left or right arrow to reorder.`,
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
        onkeydown: (e: Event) => {
          const ke = e as KeyboardEvent;
          if (ke.key === 'ArrowLeft') {
            ke.preventDefault();
            moveColumn(rid, -1);
          } else if (ke.key === 'ArrowRight') {
            ke.preventDefault();
            moveColumn(rid, 1);
          }
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
      const ridNum = roster.roster_id;
      const cellData = placements[rid] && placements[rid][round];
      const mockPicks = mockPlacements[rid] && mockPlacements[rid][round];
      const hasKeeperContent = !!(cellData && cellData.players && cellData.players.length);
      const hasMockContent = !!(mockPicks && mockPicks.length);
      const isPending =
        !!pendingSlot && pendingSlot.round === round && pendingSlot.rosterId === ridNum;
      const capacity = pickCapacity(trades, round, ridNum);
      const outgoing = trades.find((t) => t.round === round && t.rosterId === ridNum);
      const incoming = trades.filter((t) => t.round === round && t.ownerId === ridNum);
      const cellChildren: (HTMLElement | null)[] = [];
      if (hasKeeperContent) {
        const parts = cellData.players.map((c) => {
          const p = playersMap[c.playerId];
          const name = p ? `${p.first} ${p.last}`.trim() : c.playerId;
          const pos = p ? p.pos : '';
          const pickNum =
            c.consumedPick ?? exactPickForRoster(state.draft, ridNum, round, teamCount);
          let valEl: HTMLElement | null = null;
          if (c.hasAdp === false) {
            valEl = el(
              'span',
              { class: 'val-tag na', title: 'Not being drafted this year' },
              'no ADP',
            );
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
              pickNum !== null ? el('span', { class: 'pick-tag' }, `Pick ${pickNum}`) : null,
              valEl,
              c.bumped ? el('span', { class: 'board-warn bumped-tag' }, 'bumped') : null,
            ),
          );
        });
        // Multiple players in one cell is a valid, non-alarming state now —
        // it means this roster holds more than one pick that round (via
        // trade), not a collision. No cell-level warning needed here.
        cellChildren.push(el('div', null, parts));
      }
      if (hasMockContent) {
        // Additive, not exclusive with the keeper branch above: a cell can
        // legitimately hold both when a roster's trade-acquired capacity that
        // round exceeds its keeper count (buildMockDraftSlots fills the
        // remaining capacity with mock picks) — an else-if here would
        // silently drop the mock pick from the cell while still correctly
        // excluding that player from the rest of the simulation, which is
        // worse than showing it (confirmed live: capacity 2, 1 keeper).
        // Mock picks are visually distinct from real keepers (no cost/value
        // math applies, it's just "who got taken here in the sim").
        const parts = mockPicks.map((pid) => {
          const p = playersMap[pid];
          const name = p ? `${p.first} ${p.last}`.trim() : pid;
          const pos = p ? p.pos : '';
          return el(
            'div',
            { class: 'board-cell-player board-cell-mock' },
            el('div', { class: 'bp-name' }, name),
            el(
              'div',
              { class: 'bp-meta' },
              pos ? el('span', { class: 'pos-tag pos-' + pos }, pos) : null,
              el('span', { class: 'mock-tag' }, 'Mock'),
            ),
          );
        });
        cellChildren.push(el('div', null, parts));
      }
      if (!hasKeeperContent && !hasMockContent) {
        if (capacity === 0 && outgoing) {
          cellChildren.push(
            el(
              'span',
              { class: 'board-cell-traded', title: 'This round’s pick was traded away' },
              `→ ${teamNameForRoster(outgoing.ownerId)}`,
            ),
          );
        } else {
          const exactPick = exactPickForRoster(state.draft, ridNum, round, teamCount);
          cellChildren.push(
            el('span', { class: 'board-cell-empty' }, exactPick !== null ? `Pick ${exactPick}` : '—'),
          );
        }
      }
      if (incoming.length) {
        const fromNames = incoming.map((t) => teamNameForRoster(t.rosterId)).join(', ');
        cellChildren.push(
          el(
            'div',
            { class: 'board-cell-traded incoming-note' },
            `+${incoming.length} incoming from ${fromNames}`,
          ),
        );
      }
      if (isPending) {
        cellChildren.push(
          el(
            'button',
            {
              class: 'board-cell-pick-btn',
              type: 'button',
              onclick: () => openPickerForCurrentTurn(),
            },
            'Make your pick',
          ),
        );
      }
      const cellClasses =
        'board-cell' +
        (hasKeeperContent ? ' has-player' : '') +
        (hasMockContent ? ' has-mock-player' : '') +
        (isPending ? ' board-cell-pending' : '') +
        (!hasKeeperContent && !hasMockContent && capacity === 0 && outgoing
          ? ' is-traded-away'
          : '');
      tr.appendChild(el('td', { class: cellClasses }, ...cellChildren));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  if (unkeepable.length) {
    const lines = unkeepable.map(({ rid, item }) => {
      const teamName = teamNameForRoster(Number(rid));
      const p = playersMap[item.playerId];
      const name = p ? `${p.first} ${p.last}`.trim() : item.playerId;
      return el(
        'div',
        null,
        `${teamName}: ${name} cannot be kept — no available pick at round ${item.base} or any cheaper round.`,
      );
    });
    container.appendChild(el('div', { class: 'error-banner board-unkeepable' }, ...lines));
  }

  if (noKeeperCost && taxiSquadByRoster.length) {
    const rows = taxiSquadByRoster.map(({ rid, items }) => {
      const teamName = teamNameForRoster(Number(rid));
      const names = items
        .map((it) => {
          const p = playersMap[it.playerId];
          return p ? `${p.first} ${p.last}`.trim() : it.playerId;
        })
        .join(', ');
      return el('div', null, el('strong', null, `${teamName}: `), names);
    });
    container.appendChild(
      el(
        'div',
        { class: 'info-note board-taxi-squad' },
        el('div', null, el('strong', null, 'Taxi squad — kept for free, no picks spent:')),
        ...rows,
      ),
    );
  }

  const wrap = el('div', { class: 'table-scroll' }, table);
  container.appendChild(wrap);
}
