import { describe, it, expect } from 'vitest';
import {
  initialRulesForLeague,
  isSuperflexLeague,
  maxKeepersFromLeague,
  positionFilterSlots,
  slotStartsPosition,
  startablePositions,
  suggestedRulesFromLeague,
} from '../src/domain/leagueSettings';
import { DEFAULT_LEAGUE_RULES } from '../src/types';

describe('isSuperflexLeague', () => {
  it('detects an explicit SUPER_FLEX slot', () => {
    expect(isSuperflexLeague(['QB', 'RB', 'WR', 'SUPER_FLEX', 'BN'])).toBe(true);
  });

  it('detects a plain 2QB lineup with no SUPER_FLEX slot', () => {
    // Confirmed live on a real Sleeper league: starters are QB,QB,... with no
    // SUPER_FLEX anywhere, so a SUPER_FLEX-only check would miss it entirely.
    expect(isSuperflexLeague(['QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'])).toBe(true);
  });

  it('does not treat a single-QB lineup as superflex', () => {
    expect(isSuperflexLeague(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'BN'])).toBe(
      false,
    );
  });

  it('is false for missing or empty roster positions', () => {
    expect(isSuperflexLeague(null)).toBe(false);
    expect(isSuperflexLeague(undefined)).toBe(false);
    expect(isSuperflexLeague([])).toBe(false);
  });
});

describe('maxKeepersFromLeague', () => {
  it('passes through a normal allowance', () => {
    expect(maxKeepersFromLeague(2)).toBe(2);
  });

  it('clamps above this app’s UI cap', () => {
    expect(maxKeepersFromLeague(9)).toBe(4);
  });

  it('returns null for values this app can’t express or trust', () => {
    // 0 means "keepers off" on Sleeper, which isn't a cap — leave it to the user.
    expect(maxKeepersFromLeague(0)).toBeNull();
    expect(maxKeepersFromLeague(null)).toBeNull();
    expect(maxKeepersFromLeague(undefined)).toBeNull();
    expect(maxKeepersFromLeague(NaN)).toBeNull();
  });
});

describe('suggestedRulesFromLeague', () => {
  it('derives only the keeper allowance', () => {
    const s = suggestedRulesFromLeague({ settings: { max_keepers: 1 } });
    expect(s).toEqual({ maxKeepers: 1 });
  });

  it('suggests nothing when Sleeper has nothing to say', () => {
    expect(suggestedRulesFromLeague({ settings: {} })).toEqual({});
    expect(suggestedRulesFromLeague({})).toEqual({});
    expect(suggestedRulesFromLeague(null)).toEqual({});
  });

  it('never infers the taxi-squad rule from Sleeper settings', () => {
    // Sleeper's taxi squad is a dynasty rookie-stash concept, unrelated to this
    // app's "keepers cost no draft pick" rule despite the shared nickname.
    const s = suggestedRulesFromLeague({
      settings: { max_keepers: 2, taxi_slots: 4 },
    } as never);
    expect(s).not.toHaveProperty('noKeeperCost');
  });

  it('never infers inflation rounds, which Sleeper does not model', () => {
    const s = suggestedRulesFromLeague({ settings: { max_keepers: 3 } });
    expect(s).not.toHaveProperty('inflationRounds');
  });
});

describe('initialRulesForLeague', () => {
  it('layers Sleeper’s allowance over this app’s defaults', () => {
    expect(initialRulesForLeague({ settings: { max_keepers: 1 } })).toEqual({
      ...DEFAULT_LEAGUE_RULES,
      maxKeepers: 1,
    });
  });

  it('falls back to plain defaults when Sleeper says nothing', () => {
    expect(initialRulesForLeague(null)).toEqual(DEFAULT_LEAGUE_RULES);
  });
});

// A Mudd-shaped lineup: no kicker slot, three generic FLEX spots.
const MUDD = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'DEF', 'BN', 'BN'];

describe('startablePositions', () => {
  it('omits a position the league has no slot for', () => {
    const startable = startablePositions(MUDD);
    expect(startable.sort()).toEqual(['DEF', 'QB', 'RB', 'TE', 'WR']);
    expect(startable).not.toContain('K');
  });

  it('omits both DEF and K when the lineup starts neither', () => {
    expect(startablePositions(['QB', 'RB', 'WR', 'TE', 'FLEX']).sort()).toEqual([
      'QB',
      'RB',
      'TE',
      'WR',
    ]);
  });

  it('credits flex slots with every position they can start', () => {
    // No dedicated TE slot, but a FLEX can start one, so TE is startable.
    expect(startablePositions(['QB', 'RB', 'FLEX']).sort()).toEqual(['QB', 'RB', 'TE', 'WR']);
  });

  it('returns nothing for an unknown lineup, so callers filter nothing', () => {
    expect(startablePositions(null)).toEqual([]);
    expect(startablePositions([])).toEqual([]);
  });
});

describe('positionFilterSlots', () => {
  it('dedupes the lineup in order, keeping a FLEX entry and dropping bench slots', () => {
    expect(positionFilterSlots(MUDD)).toEqual(['QB', 'RB', 'WR', 'TE', 'FLEX', 'DEF']);
  });

  it('surfaces a superflex slot as its own filter option', () => {
    expect(positionFilterSlots(['QB', 'RB', 'WR', 'SUPER_FLEX', 'BN'])).toEqual([
      'QB',
      'RB',
      'WR',
      'SUPER_FLEX',
    ]);
  });

  it('never offers BN or IR', () => {
    expect(positionFilterSlots(['BN', 'IR', 'QB'])).toEqual(['QB']);
  });

  it('returns nothing for an unknown lineup, so the UI keeps its default list', () => {
    expect(positionFilterSlots(null)).toEqual([]);
  });
});

describe('slotStartsPosition', () => {
  it('treats an empty slot as "all positions"', () => {
    expect(slotStartsPosition('QB', '')).toBe(true);
    expect(slotStartsPosition('DEF', '')).toBe(true);
  });

  it('matches an exact slot to just its own position', () => {
    expect(slotStartsPosition('QB', 'QB')).toBe(true);
    expect(slotStartsPosition('RB', 'QB')).toBe(false);
  });

  it('matches a FLEX slot to every position it can start', () => {
    expect(slotStartsPosition('RB', 'FLEX')).toBe(true);
    expect(slotStartsPosition('WR', 'FLEX')).toBe(true);
    expect(slotStartsPosition('TE', 'FLEX')).toBe(true);
    expect(slotStartsPosition('QB', 'FLEX')).toBe(false);
    expect(slotStartsPosition('DEF', 'FLEX')).toBe(false);
  });

  it('lets SUPER_FLEX take a quarterback where plain FLEX cannot', () => {
    expect(slotStartsPosition('QB', 'SUPER_FLEX')).toBe(true);
  });

  it('matches nothing for a slot it has never heard of', () => {
    expect(slotStartsPosition('QB', 'NONSENSE')).toBe(false);
  });
});
