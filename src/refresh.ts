// Cross-tab refresh coordination.
//
// Lives outside src/ui/ because it belongs to no single tab: it decides how the
// three data tabs refresh *together*, which is a different question from how any
// one of them loads. Takes its loaders as arguments rather than importing them,
// so the ordering and force-flag rules below are unit-testable without a DOM.

/**
 * How long a tab's data may sit before merely looking at it refreshes it.
 *
 * Refreshing on *every* tab click is the obvious reading of "refresh when you
 * open a tab", but it turns flipping between tabs — which people do constantly
 * while weighing keepers — into a network round trip each time, stalling on
 * data fetched seconds ago. Two minutes is long enough that browsing stays
 * instant, short enough that a tab you come back to reflects other managers'
 * moves.
 */
export const TAB_STALE_MS = 2 * 60 * 1000;

/** Never loaded counts as stale, so a first visit always loads. */
export function isTabStale(loadedAt: Date | null, now: number = Date.now()): boolean {
  return !loadedAt || now - loadedAt.getTime() > TAB_STALE_MS;
}

export interface RefreshTargets {
  rosters: (force: boolean) => Promise<void>;
  draft: (force: boolean) => Promise<void>;
  board: (force: boolean) => Promise<void>;
}

/** Which tabs, if any, failed to refresh. Empty means everything succeeded. */
export type RefreshOutcome = Array<keyof RefreshTargets>;

const ORDER: Array<keyof RefreshTargets> = ['rosters', 'draft', 'board'];

/**
 * Refresh all three data tabs, hitting the network once per resource.
 *
 * Only the FIRST tab is forced, which is the whole trick. All three loaders sit
 * on the same cache-aware `ensure*` loaders in data.ts, so forcing every one of
 * them would re-download Sleeper's multi-megabyte player dictionary three times
 * over, plus the ADP and outlook snapshots, to produce byte-identical results.
 * The rosters pass refreshes every shared resource; the other two then find
 * warm state and simply re-render against it.
 *
 * Rosters goes first because it is the superset — it loads players, last
 * season's draft, this season's draft order, traded picks, ADP, outlooks and
 * the shared keeper list. Order is therefore load-bearing, not cosmetic.
 *
 * One tab failing must not strand the other two: each is isolated so a dead
 * ADP snapshot still leaves you with refreshed rosters. Callers get back the
 * list of tabs that failed; the tabs themselves render their own error banners.
 */
export async function refreshAll(targets: RefreshTargets): Promise<RefreshOutcome> {
  const failed: RefreshOutcome = [];
  for (const tab of ORDER) {
    try {
      await targets[tab](tab === 'rosters');
    } catch {
      failed.push(tab);
    }
  }
  return failed;
}
