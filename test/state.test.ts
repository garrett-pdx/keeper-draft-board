import { describe, it, expect, beforeEach } from 'vitest';
import {
  state,
  toggleKeeper,
  keeperListFor,
  ensureBoardOrder,
  markBoardOrderCustomized,
  saveBoardOrder,
} from '../src/state';
import { DEFAULT_LEAGUE_RULES } from '../src/types';
import type { SleeperRoster } from '../src/types';

const ROSTER = 1;

// Node's test environment has no Web Storage API; state.ts only needs the
// tiny synchronous subset toggleKeeper's persistence path uses.
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

describe('toggleKeeper', () => {
  beforeEach(() => {
    state.keepers = {};
    state.rules = { ...DEFAULT_LEAGUE_RULES, maxKeepers: 2 };
    state.leagueId = 'test-league';
  });

  it('allows up to the default maxKeepers (2)', () => {
    expect(toggleKeeper(ROSTER, 'p1')).toBe(true);
    expect(toggleKeeper(ROSTER, 'p2')).toBe(true);
    expect(keeperListFor(ROSTER)).toEqual(['p1', 'p2']);
  });

  it('rejects a 3rd keeper at the default maxKeepers', () => {
    toggleKeeper(ROSTER, 'p1');
    toggleKeeper(ROSTER, 'p2');
    expect(toggleKeeper(ROSTER, 'p3')).toBe(false);
    expect(keeperListFor(ROSTER)).toEqual(['p1', 'p2']);
  });

  it('allows up to a configured higher maxKeepers', () => {
    state.rules.maxKeepers = 4;
    expect(toggleKeeper(ROSTER, 'p1')).toBe(true);
    expect(toggleKeeper(ROSTER, 'p2')).toBe(true);
    expect(toggleKeeper(ROSTER, 'p3')).toBe(true);
    expect(toggleKeeper(ROSTER, 'p4')).toBe(true);
    expect(toggleKeeper(ROSTER, 'p5')).toBe(false);
    expect(keeperListFor(ROSTER)).toHaveLength(4);
  });

  it('toggling an existing keeper off always succeeds regardless of the max', () => {
    toggleKeeper(ROSTER, 'p1');
    toggleKeeper(ROSTER, 'p2');
    expect(toggleKeeper(ROSTER, 'p1')).toBe(true);
    expect(keeperListFor(ROSTER)).toEqual(['p2']);
  });
});

function roster(id: number): SleeperRoster {
  return { roster_id: id, owner_id: `owner${id}`, players: [] };
}

describe('ensureBoardOrder', () => {
  beforeEach(() => {
    state.leagueId = 'board-order-league';
    state.rosters = [roster(3), roster(1), roster(2)];
    state.draft = null;
    localStorage.removeItem('kdb_board_order_' + state.leagueId);
    localStorage.removeItem('kdb_board_order_custom_' + state.leagueId);
  });

  it('falls back to the rosters’ own order before the draft order is known', () => {
    ensureBoardOrder();
    expect(state.boardOrder).toEqual(['3', '1', '2']);
  });

  it('auto-sorts by real draft slot once known, with no manual reorder yet', () => {
    state.draft = {
      type: 'snake',
      draft_order: { ownerA: 1 },
      slot_to_roster_id: { '1': 2, '2': 3, '3': 1 },
    };
    ensureBoardOrder();
    expect(state.boardOrder).toEqual(['2', '3', '1']); // slot 1 -> roster 2, slot 2 -> roster 3, slot 3 -> roster 1
  });

  it('re-sorts by slot on every call as long as nothing has been manually reordered', () => {
    ensureBoardOrder(); // pre-order: roster_id order
    expect(state.boardOrder).toEqual(['3', '1', '2']);
    state.draft = {
      type: 'snake',
      draft_order: { ownerA: 1 },
      slot_to_roster_id: { '1': 1, '2': 2, '3': 3 },
    };
    ensureBoardOrder(); // order becomes known on a later load — should self-correct
    expect(state.boardOrder).toEqual(['1', '2', '3']);
  });

  it('never overwrites a manual reorder, even after the real draft order becomes known', () => {
    ensureBoardOrder();
    state.boardOrder = ['2', '1', '3'];
    markBoardOrderCustomized();
    saveBoardOrder();
    state.draft = {
      type: 'snake',
      draft_order: { ownerA: 1 },
      slot_to_roster_id: { '1': 1, '2': 2, '3': 3 },
    };
    ensureBoardOrder();
    expect(state.boardOrder).toEqual(['2', '1', '3']);
  });

  it('still drops stale ids and appends new ones once customized', () => {
    ensureBoardOrder();
    state.boardOrder = ['2', '1', '3'];
    markBoardOrderCustomized();
    saveBoardOrder();
    state.rosters = [roster(1), roster(2), roster(4)]; // roster 3 gone, roster 4 new
    ensureBoardOrder();
    expect(state.boardOrder).toEqual(['2', '1', '4']);
  });
});
