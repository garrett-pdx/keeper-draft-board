// The position-filter <select> shared by the Draft List and the mock draft
// picker. Both need the same thing — this league's own starting slots, FLEX
// included — and neither is a natural home for it, so it lives here rather
// than one importing the other.
import { positionFilterSlots } from '../domain/leagueSettings';
import { state } from '../state';
import { el } from './dom';

/**
 * What each slot is called in the dropdown. Flex slots spell out what they
 * cover, since "FLEX" alone doesn't say which positions are eligible and that
 * varies by league.
 */
const SLOT_LABELS: Record<string, string> = {
  FLEX: 'FLEX (RB/WR/TE)',
  SUPER_FLEX: 'SUPERFLEX (QB/RB/WR/TE)',
  WRRB_FLEX: 'WR/RB FLEX',
  REC_FLEX: 'REC FLEX (WR/TE)',
};

/** Used only when the league's lineup isn't known yet — same list as before. */
const FALLBACK_SLOTS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export function positionFilterLabel(slot: string): string {
  return SLOT_LABELS[slot] || slot;
}

/**
 * Rebuild a position filter's options from the league's own lineup.
 *
 * Driving this off `roster_positions` is what drops kickers from a league with
 * no `K` slot and adds a FLEX entry to one that has flex spots — the option's
 * value is the *slot* name, which `slotStartsPosition` turns back into the set
 * of positions to match, so exact and flex slots need no special-casing at the
 * call site.
 *
 * Keeps the current selection when it's still on offer and falls back to "All
 * positions" when it isn't, so a stale filter can never leave the list showing
 * nothing with no visible reason.
 */
export function syncPositionFilterOptions(select: HTMLSelectElement): void {
  const slots = positionFilterSlots(state.league?.roster_positions);
  const options = slots.length ? slots : FALLBACK_SLOTS;
  const previous = select.value;

  select.innerHTML = '';
  select.appendChild(el('option', { value: '' }, 'All positions'));
  for (const slot of options) {
    select.appendChild(el('option', { value: slot }, positionFilterLabel(slot)));
  }
  select.value = options.includes(previous) ? previous : '';
}
