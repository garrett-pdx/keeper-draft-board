// A singleton bottom-sheet drawer for the full player outlook text. Built
// lazily on first open and appended to document.body — it's a top-level
// overlay independent of whichever roster card triggered it, so it can't live
// inside a card's DOM (renderRosters() rebuilds that tree on every change).
import { el } from './dom';

let scrimEl: HTMLElement | null = null;
let drawerEl: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let bodyEl: HTMLElement | null = null;

let dragging = false;
let dragStartY = 0;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeOutlookDrawer();
}

function onPointerDown(e: PointerEvent): void {
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
    closeOutlookDrawer();
  } else {
    drawerEl!.style.transform = '';
    scrimEl!.style.opacity = '';
  }
}

function ensureBuilt(): void {
  if (drawerEl) return;

  scrimEl = el('div', { class: 'outlook-scrim', onclick: () => closeOutlookDrawer() });
  scrimEl.hidden = true;

  titleEl = el('div', { class: 'outlook-drawer-title' });
  bodyEl = el('div', { class: 'outlook-drawer-body' });
  const handle = el('div', { class: 'outlook-drawer-handle', 'aria-hidden': 'true' });
  const closeBtn = el(
    'button',
    {
      class: 'outlook-drawer-close',
      'aria-label': 'Close outlook',
      onclick: () => closeOutlookDrawer(),
    },
    '×',
  );

  handle.addEventListener('pointerdown', onPointerDown);
  const header = el('div', { class: 'outlook-drawer-header' }, titleEl, closeBtn);
  header.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  drawerEl = el(
    'div',
    {
      class: 'outlook-drawer',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Player outlook',
    },
    handle,
    header,
    bodyEl,
    el('div', { class: 'outlook-drawer-attribution' }, 'Outlook via ESPN Fantasy Football'),
  );
  drawerEl.hidden = true;

  document.body.appendChild(scrimEl);
  document.body.appendChild(drawerEl);
}

export function openOutlookDrawer(name: string, outlook: string): void {
  ensureBuilt();
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  titleEl!.textContent = name;
  bodyEl!.textContent = outlook;
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

export function closeOutlookDrawer(): void {
  if (!drawerEl || drawerEl.hidden) return;
  scrimEl!.classList.remove('open');
  drawerEl!.classList.remove('open');
  drawerEl!.style.transform = '';
  scrimEl!.style.opacity = '';
  document.removeEventListener('keydown', onKeydown);
  closeTimer = setTimeout(() => {
    scrimEl!.hidden = true;
    drawerEl!.hidden = true;
  }, 260);
}
