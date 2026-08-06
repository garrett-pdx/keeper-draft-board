import { describe, it, expect } from 'vitest';
import {
  EMPTY_SHARED_KEEPERS,
  lockedTeamsFor,
  mergeSharedKeepers,
  samePicks,
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
  // Signed in as nobody in particular unless a test says otherwise.
  const base = { shared, leagueId: 'L1', editingRosterId: null, myRosterId: null };

  it('lets saved picks win over local ones', () => {
    const { keepers } = mergeSharedKeepers({
      ...base,
      localKeepers: { '1': ['stale'], '2': ['also-stale'] },
    });
    expect(keepers['1']).toEqual(['p1', 'p2']);
    expect(keepers['2']).toEqual(['p3']);
  });

  it('keeps your own local picks while your team is absent from the shared doc', () => {
    const { keepers } = mergeSharedKeepers({
      ...base,
      localKeepers: { '7': ['mine'] },
      myRosterId: 7,
    });
    expect(keepers['7']).toEqual(['mine']);
  });

  it('drops another team’s local picks once they withdraw from the shared doc', () => {
    // Team 2 previously saved, so an earlier sync mirrored their picks into this
    // browser's localStorage. They've since withdrawn, and the shared doc is
    // authoritative — those picks must not linger as phantom keepers.
    const afterWithdrawal: SharedKeepers = {
      version: 1,
      leagues: { L1: { '1': team(['p1', 'p2']) } },
    };
    const { keepers, locks } = mergeSharedKeepers({
      ...base,
      shared: afterWithdrawal,
      localKeepers: { '1': ['p1', 'p2'], '2': ['p3'] },
      myRosterId: 1,
    });
    expect(keepers['2']).toBeUndefined();
    expect(locks['2']).toBeUndefined();
  });

  it('lets a save made on another device replace your own stale local picks', () => {
    const { keepers } = mergeSharedKeepers({
      ...base,
      localKeepers: { '1': ['picked-here-but-never-saved'] },
      myRosterId: 1,
    });
    expect(keepers['1']).toEqual(['p1', 'p2']);
  });

  it('preserves in-progress local edits for the roster being edited', () => {
    const { keepers } = mergeSharedKeepers({
      ...base,
      localKeepers: { '1': ['in-progress'] },
      editingRosterId: 1,
      myRosterId: 1,
    });
    expect(keepers['1']).toEqual(['in-progress']);
  });

  it('still reports the edited team as locked for the league', () => {
    // Editing changes what this browser may alter, not what the league sees:
    // the previously-saved picks stay committed until they're saved again.
    const { locks } = mergeSharedKeepers({
      ...base,
      localKeepers: { '1': ['in-progress'] },
      editingRosterId: 1,
      myRosterId: 1,
    });
    expect(locks['1']).toBeDefined();
    expect(locks['1'].playerIds).toEqual(['p1', 'p2']);
  });

  it('empties the edited team when its local selection is cleared', () => {
    const { keepers } = mergeSharedKeepers({
      ...base,
      localKeepers: {},
      editingRosterId: 1,
      myRosterId: 1,
    });
    expect(keepers['1']).toBeUndefined();
  });

  it('reports a lock for every saved team, carrying who saved it', () => {
    const { locks } = mergeSharedKeepers({ ...base, localKeepers: {} });
    expect(locks['2'].savedBy).toBe('u2');
    expect(locks['2'].savedByName).toBe('malstol');
  });

  it('falls back to your own local picks when there is no shared doc', () => {
    const { keepers, locks } = mergeSharedKeepers({
      ...base,
      shared: null,
      localKeepers: { '1': ['mine'] },
      myRosterId: 1,
    });
    expect(keepers).toEqual({ '1': ['mine'] });
    expect(locks).toEqual({});
  });

  it('does not mutate the local keepers it was handed', () => {
    const local = { '1': ['stale'] };
    mergeSharedKeepers({ ...base, localKeepers: local, myRosterId: 1 });
    expect(local['1']).toEqual(['stale']);
  });
});

describe('samePicks', () => {
  it('matches regardless of order', () => {
    expect(samePicks(team(['a', 'b']), ['b', 'a'])).toBe(true);
  });

  it('rejects a different set, a different length, or a missing team', () => {
    expect(samePicks(team(['a', 'b']), ['a', 'c'])).toBe(false);
    expect(samePicks(team(['a', 'b']), ['a'])).toBe(false);
    expect(samePicks(undefined, [])).toBe(false);
  });

  it('matches two empty selections on a team that saved none', () => {
    expect(samePicks(team([]), [])).toBe(true);
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
