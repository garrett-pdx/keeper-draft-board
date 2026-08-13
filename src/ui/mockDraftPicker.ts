// A singleton bottom-sheet drawer for making a mock-draft pick — mechanically
// modeled on outlookDrawer.ts (scrim, slide-up sheet, swipe-down-to-dismiss,
// Escape, document.body-appended so it survives renderBoard() rebuilding its
// own tree), but repurposed for action instead of read-only display: rows are
// real tap/keyboard targets, and closing restores focus (overlay.ts's
// lastFocused pattern, which outlookDrawer.ts itself doesn't do).
//
// Takes the "on pick" action as a callback rather than importing
// src/mockDraft.ts directly, the same way keeperControls.ts takes an onChange
// callback rather than importing rosters.ts back — src/mockDraft.ts is the
// only module that needs to know about both sides.
import { mockDraftAvailablePlayerIds } from '../selectors';
import { state } from '../state';
import { el } from './dom';

let scrimEl: HTMLElement | null = null;
let drawerEl: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let searchEl: HTMLInputElement | null = null;
let posFilterEl: HTMLSelectElement | null = null;
let listEl: HTMLElement | null = null;

let dragging = false;
let dragStartY = 0;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let lastFocused: Element | null = null;
let onPickCallback: ((playerId: string) => void) | null = null;

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeMockDraftPicker();
}

function onPointerDown(e: PointerEvent): void {
  // The header wraps the close button too, so a pointerdown originating on
  // it would otherwise start a drag and capture the pointer on the header —
  // which hijacks the click that was about to fire on the button (confirmed
  // live: a real click closed nothing, while a synthetic dispatchEvent did,
  // isolating this as a capture issue rather than a handler-wiring one).
  if ((e.target as HTMLElement).closest('.outlook-drawer-close')) return;
  dragging = true;
  dragStartY = e.clientY;
  drawerEl!.classList.add('dragging');
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging) return;
  const dy = Math.max(0, e.clientY - dragStartY);
  drawerEl!.style.transform = `translateY(${dy}px)`;
  scrimEl!.style.opacity = String(Math.max(0, 1 - dy / 300));
}

function onPointerUp(): void {
  if (!dragging) return;
  dragging = false;
  drawerEl!.classList.remove('dragging');
  const dy = drawerEl!.style.transform
    ? Number(/translateY\((\d+(?:\.\d+)?)px\)/.exec(drawerEl!.style.transform)?.[1] || 0)
    : 0;
  const threshold = drawerEl!.offsetHeight * 0.25;
  if (dy > threshold) {
    closeMockDraftPicker();
  } else {
    drawerEl!.style.transform = '';
    scrimEl!.style.opacity = '';
  }
}

function pick(playerId: string): void {
  onPickCallback?.(playerId);
}

function renderList(): void {
  if (!listEl) return;
  const search = searchEl!.value.trim().toLowerCase();
  const posFilter = posFilterEl!.value;
  const playersMap = state.playersMap || {};
  const adpMap = state.adpMap || {};

  let rows = mockDraftAvailablePlayerIds()
    .map((pid) => ({ pid, p: playersMap[pid], adp: pid in adpMap ? adpMap[pid] : 9999 }))
    .filter((r) => !!r.p);
  if (posFilter) rows = rows.filter((r) => r.p.pos === posFilter);
  if (search) {
    rows = rows.filter((r) => `${r.p.first} ${r.p.last}`.toLowerCase().includes(search));
  }
  rows.sort((a, b) => a.adp - b.adp);
  rows = rows.slice(0, 200);

  listEl.innerHTML = '';
  if (!rows.length) {
    listEl.appendChild(el('div', { class: 'mock-picker-empty' }, 'No players match your filters.'));
    return;
  }
  for (const r of rows) {
    const name = `${r.p.first} ${r.p.last}`.trim();
    const row = el(
      'div',
      {
        class: 'mock-picker-row',
        role: 'button',
        tabindex: '0',
        'aria-label': `Draft ${name}, ${r.p.pos}, ${r.p.team}`,
        onclick: () => pick(r.pid),
        onkeydown: (e: Event) => {
          const ke = e as KeyboardEvent;
          if (ke.key === 'Enter' || ke.key === ' ') {
            ke.preventDefault();
            pick(r.pid);
          }
        },
      },
      el('span', { class: 'mock-picker-adp mono' }, r.adp >= 9999 ? '—' : r.adp.toFixed(1)),
      el(
        'div',
        { class: 'mock-picker-info' },
        el('div', { class: 'mock-picker-name' }, name),
        el('div', { class: 'mock-picker-sub' }, r.p.team),
      ),
      el('span', { class: 'pos-tag pos-' + r.p.pos }, r.p.pos),
    );
    listEl.appendChild(row);
  }
}

function ensureBuilt(): void {
  if (drawerEl) return;

  scrimEl = el('div', { class: 'outlook-scrim', onclick: () => closeMockDraftPicker() });
  scrimEl.hidden = true;

  titleEl = el('div', { class: 'outlook-drawer-title' });
  searchEl = el('input', {
    type: 'search',
    class: 'mock-picker-search',
    placeholder: 'Search players…',
    oninput: renderList,
  }) as HTMLInputElement;
  posFilterEl = el(
    'select',
    { class: 'mock-picker-pos-filter', onchange: renderList },
    el('option', { value: '' }, 'All positions'),
    ...POSITIONS.map((pos) => el('option', { value: pos }, pos)),
  ) as HTMLSelectElement;
  listEl = el('div', { class: 'mock-picker-list' });

  const handle = el('div', { class: 'outlook-drawer-handle', 'aria-hidden': 'true' });
  const closeBtn = el(
    'button',
    {
      class: 'outlook-drawer-close',
      'aria-label': 'Close player picker',
      onclick: () => closeMockDraftPicker(),
    },
    '×',
  );

  handle.addEventListener('pointerdown', onPointerDown);
  const header = el('div', { class: 'outlook-drawer-header' }, titleEl, closeBtn);
  header.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  const filters = el('div', { class: 'mock-picker-filters' }, searchEl, posFilterEl);

  drawerEl = el(
    'div',
    {
      class: 'outlook-drawer mock-picker-drawer',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Make your mock draft pick',
    },
    handle,
    header,
    filters,
    listEl,
  );
  drawerEl.hidden = true;

  document.body.appendChild(scrimEl);
  document.body.appendChild(drawerEl);
}

export function openMockDraftPicker(roundLabel: string, onPick: (playerId: string) => void): void {
  ensureBuilt();
  onPickCallback = onPick;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  lastFocused = document.activeElement;
  titleEl!.textContent = roundLabel;
  searchEl!.value = '';
  posFilterEl!.value = '';
  renderList();
  drawerEl!.style.transform = '';
  scrimEl!.style.opacity = '';
  scrimEl!.hidden = false;
  drawerEl!.hidden = false;
  // Force layout before adding the open class so the slide-in transition runs.
  void drawerEl!.offsetHeight;
  scrimEl!.classList.add('open');
  drawerEl!.classList.add('open');
  document.addEventListener('keydown', onKeydown);
}

export function closeMockDraftPicker(): void {
  if (!drawerEl || drawerEl.hidden) return;
  scrimEl!.classList.remove('open');
  drawerEl!.classList.remove('open');
  drawerEl!.style.transform = '';
  scrimEl!.style.opacity = '';
  document.removeEventListener('keydown', onKeydown);
  onPickCallback = null;
  if (lastFocused instanceof HTMLElement && document.contains(lastFocused)) lastFocused.focus();
  lastFocused = null;
  closeTimer = setTimeout(() => {
    scrimEl!.hidden = true;
    drawerEl!.hidden = true;
  }, 260);
}
