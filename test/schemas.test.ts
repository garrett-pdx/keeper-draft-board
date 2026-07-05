import { describe, it, expect } from 'vitest';
import {
  LeagueSchema,
  PicksSchema,
  RostersSchema,
  UsersSchema,
} from '../src/api/schemas';

describe('LeagueSchema', () => {
  it('parses a valid league and strips unknown keys', () => {
    const parsed = LeagueSchema.parse({
      league_id: '123',
      name: 'My League',
      season: '2026',
      draft_id: 'd1',
      previous_league_id: null,
      roster_positions: ['QB', 'RB', 'RB', 'WR'],
      total_rosters: 10, // unknown-to-us key
    });
    expect(parsed.league_id).toBe('123');
    expect(parsed.roster_positions).toHaveLength(4);
    expect('total_rosters' in parsed).toBe(false);
  });

  it('rejects a payload missing the required league_id', () => {
    expect(() => LeagueSchema.parse({ name: 'No id' })).toThrow();
  });

  it('tolerates a missing/undocumented draft_id', () => {
    expect(LeagueSchema.parse({ league_id: '123' }).draft_id).toBeUndefined();
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
