import { describe, it, expect } from 'vitest';
import { isTabStale, refreshAll, TAB_STALE_MS, type RefreshTargets } from '../src/refresh';

/** Records every loader call as "tab:force" so order and flags are both visible. */
function spyTargets(failing: Partial<Record<keyof RefreshTargets, boolean>> = {}) {
  const calls: string[] = [];
  const make =
    (tab: keyof RefreshTargets) =>
    async (force: boolean): Promise<void> => {
      calls.push(`${tab}:${force}`);
      if (failing[tab]) throw new Error(`${tab} blew up`);
    };
  const targets: RefreshTargets = {
    rosters: make('rosters'),
    draft: make('draft'),
    board: make('board'),
  };
  return { calls, targets };
}

describe('refreshAll', () => {
  it('forces only the rosters pass, so each resource is fetched once', async () => {
    // Every loader shares the same cache-aware ensure* loaders, so forcing all
    // three would re-download the player dictionary and snapshots three times
    // to produce identical results.
    const { calls, targets } = spyTargets();
    await refreshAll(targets);
    expect(calls).toEqual(['rosters:true', 'draft:false', 'board:false']);
  });

  it('refreshes rosters first, since it is the superset that warms the rest', async () => {
    const { calls, targets } = spyTargets();
    await refreshAll(targets);
    expect(calls[0]).toBe('rosters:true');
  });

  it('reports no failures when every tab succeeds', async () => {
    const { targets } = spyTargets();
    await expect(refreshAll(targets)).resolves.toEqual([]);
  });

  it('keeps going when one tab fails, and names it', async () => {
    // A dead ADP snapshot should still leave you with refreshed rosters rather
    // than stranding the whole refresh.
    const { calls, targets } = spyTargets({ draft: true });
    await expect(refreshAll(targets)).resolves.toEqual(['draft']);
    expect(calls).toEqual(['rosters:true', 'draft:false', 'board:false']);
  });

  it('still refreshes the other tabs when the forced rosters pass fails', async () => {
    const { calls, targets } = spyTargets({ rosters: true });
    await expect(refreshAll(targets)).resolves.toEqual(['rosters']);
    expect(calls).toEqual(['rosters:true', 'draft:false', 'board:false']);
  });

  it('never rejects, even if every tab fails', async () => {
    const { targets } = spyTargets({ rosters: true, draft: true, board: true });
    await expect(refreshAll(targets)).resolves.toEqual(['rosters', 'draft', 'board']);
  });
});

describe('isTabStale', () => {
  const now = new Date('2026-08-07T12:00:00Z').getTime();
  const agedBy = (ms: number) => new Date(now - ms);

  it('treats a tab that has never loaded as stale, so a first visit loads it', () => {
    expect(isTabStale(null, now)).toBe(true);
  });

  it('leaves a just-loaded tab alone', () => {
    // The point of the whole policy: flipping between tabs must not fire a
    // network round trip for data fetched seconds ago.
    expect(isTabStale(agedBy(0), now)).toBe(false);
    expect(isTabStale(agedBy(5_000), now)).toBe(false);
  });

  it('refreshes once the data is older than the window', () => {
    expect(isTabStale(agedBy(TAB_STALE_MS + 1), now)).toBe(true);
  });

  it('does not refresh exactly at the boundary', () => {
    expect(isTabStale(agedBy(TAB_STALE_MS), now)).toBe(false);
  });

  it('treats a future timestamp as fresh rather than stale', () => {
    // Clock skew shouldn't produce a refresh loop.
    expect(isTabStale(new Date(now + 60_000), now)).toBe(false);
  });
});
