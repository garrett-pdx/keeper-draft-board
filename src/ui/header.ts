import { state } from '../state';
import { $ } from './dom';

// Keep the always-visible ADP data-source badge in sync with state.adpSource, so
// the (undocumented) ADP source vs. rank-proxy fallback is never silent.
export function updateAdpSourceBadge(): void {
  const badge = $('#adpSourceBadge');
  if (!badge) return;
  if (!state.adpSource) {
    badge.setAttribute('hidden', '');
    return;
  }
  badge.removeAttribute('hidden');
  if (state.adpSource === 'adp') {
    badge.className = 'adp-badge adp-badge-live';
    badge.textContent = 'ADP · Sleeper projections';
    badge.title = 'Market value comes from Sleeper’s projection-derived ADP.';
  } else {
    badge.className = 'adp-badge adp-badge-proxy';
    badge.textContent = 'ADP · rank proxy';
    badge.title =
      'No ADP endpoint was available, so value uses Sleeper’s overall player ranking as a proxy.';
  }
}
