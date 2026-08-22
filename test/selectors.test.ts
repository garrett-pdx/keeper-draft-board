import { describe, it, expect, beforeEach } from 'vitest';
import {
  allKeeperIdsWithTeam,
  getRosterKeeperCostsFor,
  mockDraftDoubleUpAllowedFor,
  mockDraftRoundWeights,
} from '../src/selectors';
import { MUDD_MANAGERS } from '../src/domain/draftTendencies';
import { state } from '../src/state';
import type { MockDraftState } from '../src/state';
import { DEFAULT_LEAGUE_RULES } from '../src/types';
import type { PlayersMap, PrevDraftMap } from '../src/types';

// state.ts reads localStorage on some paths; nothing here writes, but the
// module still needs the global to exist under Node.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

function player(id: string, rank: number): PlayersMap[string] {
  return {
    id,
    first: 'Player',
    last: id.toUpperCase(),
    pos: 'RB',
    team: 'SEA',
    rank,
    birthDate: null,
    espnId: null,
  };
}

describe('allKeeperIdsWithTeam', () => {
  beforeEach(() => {
    state.leagueId = 'selectors-league';
    state.rules = { ...DEFAULT_LEAGUE_RULES, maxKeepers: 2 };
    state.rosters = [{ roster_id: 1, owner_id: 'owner1', players: [] }];
    state.users = [{ user_id: 'owner1', display_name: 'Team One' }];
    state.playersMap = { p1: player('p1', 1), p2: player('p2', 2) };
    state.adpMap = {};
    state.boardRounds = 15;
    state.draft = null;
    state.tradedPicks = [];
    state.prevDraftMap = null;
    state.keepers = {};
  });

  it('omits a selection that cannot actually be kept', () => {
    // Both keepers were drafted in round 1 last year, and the roster holds one
    // round-1 pick. The better-ranked one is displaced toward round 1, has
    // nowhere left to go, and comes back cannotBeKept — it never occupies a
    // pick, so it really will be in the draft pool. Tagging it KEPT on the
    // Draft List contradicted the Board, which lists it as unkeepable.
    // Reachable with no traded picks at all, which is why it matters.
    const prev: PrevDraftMap = {
      p1: { round: 1, rosterId: 1, ownerId: 'owner1', wasKeeper: false },
      p2: { round: 1, rosterId: 1, ownerId: 'owner1', wasKeeper: false },
    };
    state.prevDraftMap = prev;
    state.keepers = { 1: ['p1', 'p2'] };

    const costs = getRosterKeeperCostsFor(1);
    expect(costs.find((c) => c.playerId === 'p1')!.cannotBeKept).toBe(true);
    expect(costs.find((c) => c.playerId === 'p2')!.cannotBeKept).toBe(false);

    const kept = allKeeperIdsWithTeam();
    expect(kept.has('p1')).toBe(false);
    expect([...kept.keys()]).toEqual(['p2']);
  });

  it('includes every keeper that resolved, tagged with its team', () => {
    state.prevDraftMap = {
      p1: { round: 3, rosterId: 1, ownerId: 'owner1', wasKeeper: false },
      p2: { round: 7, rosterId: 1, ownerId: 'owner1', wasKeeper: false },
    };
    state.keepers = { 1: ['p1', 'p2'] };

    const kept = allKeeperIdsWithTeam();
    expect(kept.get('p1')).toBe('Team One');
    expect(kept.get('p2')).toBe('Team One');
  });

  it('is empty when no keepers are selected', () => {
    expect(allKeeperIdsWithTeam().size).toBe(0);
  });

  it('still lists taxi-squad keepers, which spend no pick but are held', () => {
    state.rules = { ...state.rules, noKeeperCost: true };
    state.prevDraftMap = {
      p1: { round: 1, rosterId: 1, ownerId: 'owner1', wasKeeper: false },
      p2: { round: 1, rosterId: 1, ownerId: 'owner1', wasKeeper: false },
    };
    state.keepers = { 1: ['p1', 'p2'] };

    // No round is contested in taxi-squad mode, so neither is cannotBeKept.
    expect([...allKeeperIdsWithTeam().keys()].sort()).toEqual(['p1', 'p2']);
  });
});

describe('mockDraftRoundWeights / mockDraftDoubleUpAllowedFor — tendency quorum', () => {
  function rostersFor(displayNames: string[]) {
    return displayNames.map((_name, i) => ({
      roster_id: i + 1,
      owner_id: `owner${i + 1}`,
      players: [],
    }));
  }
  function usersFor(displayNames: string[]) {
    return displayNames.map((name, i) => ({ user_id: `owner${i + 1}`, display_name: name }));
  }

  beforeEach(() => {
    state.leagueId = 'tendency-league';
    state.rules = { ...DEFAULT_LEAGUE_RULES };
    state.mockDraft = null;
  });

  it('without quorum, round weights are flat (no positional lean leaks in)', () => {
    const strangers = Array.from({ length: 10 }, (_, i) => `Stranger${i}`);
    state.rosters = rostersFor(strangers);
    state.users = usersFor(strangers);

    const weights = mockDraftRoundWeights(1);
    expect(weights).toEqual({ RB: 1, WR: 1, QB: 1, TE: 1 });
  });

  it('with quorum met (5+ known Mudd managers), round 1 leans RB over WR', () => {
    const names = [...MUDD_MANAGERS.slice(0, 5), 'Stranger1', 'Stranger2'];
    state.rosters = rostersFor(names);
    state.users = usersFor(names);

    const weights = mockDraftRoundWeights(1);
    expect(weights.RB).toBeGreaterThan(weights.WR);
    expect(weights.RB).toBeGreaterThan(weights.QB);
  });

  it('without quorum, mockDraftDoubleUpAllowedFor always returns false', () => {
    const strangers = Array.from({ length: 10 }, (_, i) => `Stranger${i}`);
    state.rosters = rostersFor(strangers);
    state.users = usersFor(strangers);
    state.mockDraft = {
      active: true,
      rounds: 1,
      slotOrderRosterIds: [1],
      claimedRosterId: 1,
      seed: 999,
      slots: [],
      picks: [],
    };

    const allowed = mockDraftDoubleUpAllowedFor(1);
    expect(allowed('QB')).toBe(false);
    expect(allowed('TE')).toBe(false);
  });

  it('with quorum, a same-seed-and-roster verdict is stable across calls (reload-safety)', () => {
    const names = [...MUDD_MANAGERS.slice(0, 5), 'Stranger1', 'Stranger2'];
    state.rosters = rostersFor(names);
    state.users = usersFor(names);
    const mockDraft: MockDraftState = {
      active: true,
      rounds: 1,
      slotOrderRosterIds: [1],
      claimedRosterId: 1,
      seed: 424242,
      slots: [],
      picks: [],
    };
    state.mockDraft = mockDraft;

    const first = mockDraftDoubleUpAllowedFor(1);
    const second = mockDraftDoubleUpAllowedFor(1);
    expect(first('QB')).toBe(second('QB'));
    expect(first('TE')).toBe(second('TE'));
  });

  it('a manager not in the profile table (a Stranger holding a Mudd-quorum seat) never doubles up', () => {
    const names = [...MUDD_MANAGERS.slice(0, 5), 'Stranger1', 'Stranger2'];
    state.rosters = rostersFor(names);
    state.users = usersFor(names);
    state.mockDraft = {
      active: true,
      rounds: 1,
      slotOrderRosterIds: [1],
      claimedRosterId: 1,
      seed: 1,
      slots: [],
      picks: [],
    };

    // Stranger1 is roster_id 6 (index 5) in `names`.
    const allowed = mockDraftDoubleUpAllowedFor(6);
    expect(allowed('QB')).toBe(false);
    expect(allowed('TE')).toBe(false);
  });
});
