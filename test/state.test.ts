import { describe, it, expect, beforeEach } from 'vitest';
import { state, toggleKeeper, keeperListFor } from '../src/state';

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
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

describe('toggleKeeper', () => {
  beforeEach(() => {
    state.keepers = {};
    state.rules = { maxKeepers: 2, inflationRounds: 1 };
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
