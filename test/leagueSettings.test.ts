import { describe, it, expect } from 'vitest';
import {
  initialRulesForLeague,
  isSuperflexLeague,
  maxKeepersFromLeague,
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
