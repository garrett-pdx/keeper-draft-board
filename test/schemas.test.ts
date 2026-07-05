import { describe, it, expect } from 'vitest';
import {
  LeagueSchema,
  LeaguesForUserSchema,
  PicksSchema,
  RostersSchema,
  UserLookupSchema,
  UsersSchema,
} from '../src/api/schemas';

describe('LeagueSchema', () => {
  it('parses a valid league, keeps total_rosters, and strips truly unknown keys', () => {
    const parsed = LeagueSchema.parse({
      league_id: '123',
      name: 'My League',
      season: '2026',
      draft_id: 'd1',
      previous_league_id: null,
      roster_positions: ['QB', 'RB', 'RB', 'WR'],
      total_rosters: 10,
      bracket_id: 'unknown-to-us-field', // genuinely unmodeled key
    });
    expect(parsed.league_id).toBe('123');
    expect(parsed.roster_positions).toHaveLength(4);
    expect(parsed.total_rosters).toBe(10);
    expect('bracket_id' in parsed).toBe(false);
  });

  it('rejects a payload missing the required league_id', () => {
    expect(() => LeagueSchema.parse({ name: 'No id' })).toThrow();
  });

  it('tolerates a missing/undocumented draft_id', () => {
    expect(LeagueSchema.parse({ league_id: '123' }).draft_id).toBeUndefined();
  });

  it('tolerates a missing total_rosters (optional)', () => {
    expect(LeagueSchema.parse({ league_id: '123' }).total_rosters).toBeUndefined();
  });
});

describe('LeaguesForUserSchema', () => {
  it('parses an array of leagues for a user, matching the real endpoint shape', () => {
    const parsed = LeaguesForUserSchema.parse([
      { league_id: '1312235880743706624', name: 'Mudd Keeper League', season: '2026', total_rosters: 10 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].total_rosters).toBe(10);
  });

  it('parses an empty array (user has no leagues that season)', () => {
    expect(LeaguesForUserSchema.parse([])).toEqual([]);
  });
});

describe('UserLookupSchema', () => {
  it('parses a real-shaped single-user lookup response', () => {
    const parsed = UserLookupSchema.parse({
      user_id: '483459259485384704',
      username: 'sleeperuser',
      display_name: 'SleeperUser',
      avatar: null,
    });
    expect(parsed.user_id).toBe('483459259485384704');
    expect(parsed.avatar).toBeNull();
  });

  it('rejects a payload missing the required user_id', () => {
    expect(() => UserLookupSchema.parse({ username: 'no-id' })).toThrow();
  });
});

describe('RostersSchema', () => {
  it('accepts a null owner (orphan team) and a missing players list', () => {
    const parsed = RostersSchema.parse([{ roster_id: 4, owner_id: null }]);
    expect(parsed[0].owner_id).toBeNull();
    expect(parsed[0].players ?? null).toBeNull();
  });

  it('rejects a roster missing roster_id', () => {
    expect(() => RostersSchema.parse([{ owner_id: 'u1' }])).toThrow();
  });
});

describe('UsersSchema', () => {
  it('parses users with nested team_name metadata', () => {
    const parsed = UsersSchema.parse([
      { user_id: 'u1', display_name: 'garrett', avatar: 'abc', metadata: { team_name: 'The Team' } },
      { user_id: 'u2', display_name: 'other', avatar: null, metadata: null },
    ]);
    expect(parsed[0].metadata?.team_name).toBe('The Team');
    expect(parsed[1].avatar).toBeNull();
  });
});

describe('PicksSchema', () => {
  it('handles null player_id and missing is_keeper', () => {
    const parsed = PicksSchema.parse([
      { player_id: '4046', round: 3, roster_id: 7, is_keeper: true },
      { player_id: null, round: 3, roster_id: 8 },
    ]);
    expect(parsed[0].is_keeper).toBe(true);
    expect(parsed[1].player_id ?? null).toBeNull();
    expect(parsed[1].is_keeper ?? null).toBeNull();
  });

  it('rejects a pick with a non-numeric round', () => {
    expect(() => PicksSchema.parse([{ player_id: 'x', round: '3', roster_id: 1 }])).toThrow();
  });
});
