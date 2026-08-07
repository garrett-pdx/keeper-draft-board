import { describe, it, expect } from 'vitest';
import { refreshAll, type RefreshTargets } from '../src/refresh';

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
