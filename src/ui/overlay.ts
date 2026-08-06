// A blocking "working on it" overlay, for the handful of actions that talk to
// the league's shared list and must not be interrupted halfway.
//
// Shown only for things the manager deliberately started (save, withdraw, a
// tapped Refresh). Background polling stays silent on purpose — a modal that
// flashes up every minute on its own would be far worse than no feedback.
import { el } from './dom';

let overlay: HTMLElement | null = null;
let label: HTMLElement | null = null;
let lastFocused: Element | null = null;

function build(): void {
  label = el('div', { class: 'busy-label' });
  overlay = el(
    'div',
    {
      class: 'busy-overlay',
      // assertive: this replaces the page for its duration, so a screen reader
      // should say so now rather than after whatever it was already reading.
      role: 'alert',
      'aria-live': 'assertive',
      'aria-busy': 'true',
    },
    el('div', { class: 'busy-card' }, el('div', { class: 'busy-spinner' }), label),
  );
  document.body.appendChild(overlay);
}

/** Swallow keys so Tab can't walk focus into the page behind the scrim. */
function trapKeys(e: KeyboardEvent): void {
  if (e.key === 'Tab') e.preventDefault();
}

export function showBusy(message: string): void {
  if (!overlay) build();
  lastFocused = document.activeElement;
  label!.textContent = message;
  overlay!.classList.add('open');
  document.addEventListener('keydown', trapKeys, true);
}

export function hideBusy(): void {
  if (!overlay) return;
  overlay.classList.remove('open');
  document.removeEventListener('keydown', trapKeys, true);
  // Hand focus back to whatever the manager was on, so a save doesn't dump
  // keyboard users at the top of the document.
  if (lastFocused instanceof HTMLElement && document.contains(lastFocused)) lastFocused.focus();
  lastFocused = null;
}
