import { describe, it, expect } from 'vitest';
import {
  EMPTY_SHARED_KEEPERS,
  lockedTeamsFor,
  mergeSharedKeepers,
  withTeamKeepers,
  withoutTeamKeepers,
} from '../src/domain/keeperShare';
import type { SharedKeepers, SharedKeeperTeam } from '../src/api/schemas';

function team(playerIds: string[], savedBy = 'u1', savedByName = 'Gurret'): SharedKeeperTeam {
  return { playerIds, savedBy, savedByName, savedAt: '2026-08-01T00:00:00.000Z' };
}

const shared: SharedKeepers = {
  version: 1,
  leagues: {
    L1: {
      '1': team(['p1', 'p2'], 'u1', 'Gurret'),
      '2': team(['p3'], 'u2', 'malstol'),
    },
    L2: { '1': team(['other']) },
  },
};

describe('lockedTeamsFor', () => {
  it('returns only the requested league’s teams', () => {
    expect(Object.keys(lockedTeamsFor(shared, 'L1'))).toEqual(['1', '2']);
  });

  it('returns empty for an unknown league, a null league, or no shared doc', () => {
    expect(lockedTeamsFor(shared, 'nope')).toEqual({});
    expect(lockedTeamsFor(shared, null)).toEqual({});
    expect(lockedTeamsFor(null, 'L1')).toEqual({});
  });
});

describe('mergeSharedKeepers', () => {
  it('lets saved picks win over local ones', () => {
    const { keepers } = mergeSharedKeepers({
      shared,
      leagueId: 'L1',
      localKeepers: { '1': ['stale'], '2': ['also-stale'] },
      editingRosterId: null,
    });
    expect(keepers['1']).toEqual(['p1', 'p2']);
    expect(keepers['2']).toEqual(['p3']);
  });

  it('keeps local picks for teams nobody has saved yet', () => {
    const { keepers } = mergeSharedKeepers({
      shared,
      leagueId: 'L1',
      localKeepers: { '7': ['mine'] },
      editingRosterId: null,
    });
    expect(keepers['7']).toEqual(['mine']);
  });

  it('preserves in-progress local edits for the roster being edited', () => {
    const { keepers, locks } = mergeSharedKeepers({
      shared,
      leagueId: 'L1',
      localKeepers: { '1': ['in-progress'] },
      editingRosterId: 1,
    });
    expect(keepers['1']).toEqual(['in-progress']);
    // ...and that team reads as unlocked while it's being edited
    expect(locks['1']).toBeUndefined();
    expect(locks['2']).toBeDefined();
  });

  it('reports a lock for every saved team, carrying who saved it', () => {
    const { locks } = mergeSharedKeepers({
      shared,
      leagueId: 'L1',
      localKeepers: {},
      editingRosterId: null,
    });
    expect(locks['2'].savedBy).toBe('u2');
    expect(locks['2'].savedByName).toBe('malstol');
  });

  it('falls back to local-only when there is no shared doc', () => {
    const { keepers, locks } = mergeSharedKeepers({
      shared: null,
      leagueId: 'L1',
      localKeepers: { '1': ['mine'] },
      editingRosterId: null,
    });
    expect(keepers).toEqual({ '1': ['mine'] });
    expect(locks).toEqual({});
  });

  it('does not mutate the local keepers it was handed', () => {
    const local = { '1': ['stale'] };
    mergeSharedKeepers({ shared, leagueId: 'L1', localKeepers: local, editingRosterId: null });
    expect(local['1']).toEqual(['stale']);
  });
});

describe('withTeamKeepers', () => {
  it('replaces one team without disturbing the others', () => {
    const next = withTeamKeepers(shared, 'L1', 1, team(['new'], 'u1', 'Gurret'));
    expect(next.leagues.L1['1'].playerIds).toEqual(['new']);
    expect(next.leagues.L1['2'].playerIds).toEqual(['p3']);
    expect(next.leagues.L2['1'].playerIds).toEqual(['other']);
  });

  it('does not mutate the input doc', () => {
    withTeamKeepers(shared, 'L1', 1, team(['new']));
    expect(shared.leagues.L1['1'].playerIds).toEqual(['p1', 'p2']);
  });

  it('creates the league entry when saving into an empty doc', () => {
    const next = withTeamKeepers(EMPTY_SHARED_KEEPERS, 'L9', 3, team(['x']));
    expect(next.leagues.L9['3'].playerIds).toEqual(['x']);
  });

  it('handles a null doc as an empty one', () => {
    expect(withTeamKeepers(null, 'L9', 3, team(['x'])).leagues.L9['3'].playerIds).toEqual(['x']);
  });
});

describe('withoutTeamKeepers', () => {
  it('removes just the named team', () => {
    const next = withoutTeamKeepers(shared, 'L1', 1);
    expect(next.leagues.L1['1']).toBeUndefined();
    expect(next.leagues.L1['2']).toBeDefined();
  });

  it('does not mutate the input doc', () => {
    withoutTeamKeepers(shared, 'L1', 1);
    expect(shared.leagues.L1['1']).toBeDefined();
  });

  it('is a no-op for a team that was never saved', () => {
    expect(withoutTeamKeepers(shared, 'L1', 9).leagues.L1).toEqual(shared.leagues.L1);
  });
});
