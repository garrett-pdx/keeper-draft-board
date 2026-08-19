// The header's market-source badge, made actionable: tap it to switch which
// market prices every keeper, without a trip to the Settings tab.
//
// Built the same way as outlookDrawer.ts — a lazily-created singleton appended
// to document.body — but anchored under the badge rather than a bottom sheet,
// since it is a two-item choice rather than a body of text. It deliberately
// owns no state of its own: the current source is read from state.rules and
// applied through settings.ts's applyMarketSource, so this and the Settings
// dropdown can never disagree about what is selected or what switching does.
import { state } from '../state';
import type { MarketSource } from '../types';
import { $, el } from './dom';
import {
  applyMarketSource,
  MARKET_SOURCE_HINTS,
  MARKET_SOURCE_LABELS,
  SELECTABLE_MARKET_SOURCES,
} from './settings';

let menu: HTMLElement | null = null;

/**
 * The sources to offer: the two on general offer, plus the league's own if it
 * is on one that is no longer selectable.
 *
 * Same rule syncMarketSourceOptions applies to the Settings dropdown, and for
 * the same reason — a league configured before 'adp' was withdrawn still runs
 * on it, and a menu that omitted it would show neither option marked current,
 * implying the app was on something it isn't.
 */
function offeredSources(): MarketSource[] {
  const current = state.rules.marketSource;
  return SELECTABLE_MARKET_SOURCES.includes(current)
    ? SELECTABLE_MARKET_SOURCES
    : [...SELECTABLE_MARKET_SOURCES, current];
}

function onDocumentPointerDown(e: Event): void {
  const target = e.target as Node;
  if (menu?.contains(target)) return;
  if ($('#adpSourceBadge')?.contains(target)) return; // its own handler toggles
  closeMarketSourceMenu();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeMarketSourceMenu();
    ($('#adpSourceBadge') as HTMLElement | null)?.focus();
  }
}

export function closeMarketSourceMenu(): void {
  if (!menu) return;
  menu.remove();
  menu = null;
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onKeyDown, true);
  $('#adpSourceBadge')?.setAttribute('aria-expanded', 'false');
}

function choose(source: MarketSource): void {
  closeMarketSourceMenu();
  void applyMarketSource(source);
}

export function openMarketSourceMenu(): void {
  closeMarketSourceMenu();
  const badge = $('#adpSourceBadge');
  if (!badge) return;
  const current = state.rules.marketSource;

  menu = el('div', {
    class: 'badge-menu',
    role: 'menu',
    'aria-label': 'Market data source',
  }) as HTMLElement;
  menu.appendChild(el('div', { class: 'badge-menu-title' }, 'Price players off'));
  for (const source of offeredSources()) {
    const isCurrent = source === current;
    const label = SELECTABLE_MARKET_SOURCES.includes(source)
      ? MARKET_SOURCE_LABELS[source]
      : `${MARKET_SOURCE_LABELS[source]} (no longer offered)`;
    menu.appendChild(
      el(
        'button',
        {
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': isCurrent ? 'true' : 'false',
          class: `badge-menu-item${isCurrent ? ' is-current' : ''}`,
          onclick: () => choose(source),
        },
        el('span', { class: 'badge-menu-check' }, isCurrent ? '✓' : ''),
        el(
          'span',
          null,
          el('span', { class: 'badge-menu-label' }, label),
          el('span', { class: 'badge-menu-hint' }, MARKET_SOURCE_HINTS[source]),
        ),
      ),
    );
  }
  document.body.appendChild(menu);

  // Anchored in viewport coordinates against position: fixed, so it stays put
  // under a sticky header without needing a scroll listener. Clamped to the
  // right edge because the badge sits near it on a wide screen and the menu is
  // wider than the badge.
  const r = badge.getBoundingClientRect();
  const width = menu.offsetWidth;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  menu.style.left = `${Math.round(left)}px`;

  badge.setAttribute('aria-expanded', 'true');
  (menu.querySelector('.badge-menu-item.is-current') as HTMLElement | null)?.focus();
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
}

export function wireMarketSourceMenu(): void {
  const badge = $('#adpSourceBadge');
  if (!badge) return;
  badge.setAttribute('aria-haspopup', 'menu');
  badge.setAttribute('aria-expanded', 'false');
  badge.addEventListener('click', () => {
    if (menu) closeMarketSourceMenu();
    else openMarketSourceMenu();
  });
}
