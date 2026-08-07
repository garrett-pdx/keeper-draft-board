import { describe, it, expect } from 'vitest';
import { espnKey, outlookFor, sleeperKey } from '../src/domain/outlook';
import type { OutlookMap } from '../src/types';

const map: OutlookMap = {
  [sleeperKey('4984')]: 'Sleeper-keyed outlook',
  [espnKey(3918298)]: 'ESPN-keyed outlook',
  [espnKey(99)]: 'ESPN-only outlook',
};

describe('outlookFor', () => {
  it('prefers the Sleeper id, which is the better-covered key', () => {
    // Sleeper's own espn_id is missing for ~2/3 of the top 200, so the
    // CI-resolved Sleeper id is what actually reaches most players.
    expect(outlookFor('4984', 3918298, map)).toBe('Sleeper-keyed outlook');
  });

  it('falls back to the ESPN id for a player the bridge could not resolve', () => {
    expect(outlookFor(null, 99, map)).toBe('ESPN-only outlook');
    expect(outlookFor('unknown-sleeper-id', 99, map)).toBe('ESPN-only outlook');
  });

  it('returns null when neither id matches', () => {
    expect(outlookFor('nope', 12345, map)).toBeNull();
    expect(outlookFor(null, null, map)).toBeNull();
    expect(outlookFor(undefined, undefined, map)).toBeNull();
  });

  it('never confuses a Sleeper id with a numerically equal ESPN id', () => {
    // The namespaced keys exist precisely so "99" as a Sleeper id cannot pick
    // up the outlook stored for ESPN id 99.
    expect(outlookFor('99', null, map)).toBeNull();
  });

  it('returns null against an empty map', () => {
    expect(outlookFor('4984', 3918298, {})).toBeNull();
  });
});
