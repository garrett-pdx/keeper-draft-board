import { describe, it, expect } from 'vitest';
import {
  AdpSnapshotSchema,
  DraftSchema,
  LeagueSchema,
  LeaguesForUserSchema,
  PicksSchema,
  RostersSchema,
  TradedPicksSchema,
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

  it('captures scoring_settings.rec for ADP format selection, and tolerates its absence', () => {
    expect(
      LeagueSchema.parse({ league_id: '123', scoring_settings: { rec: 0.5, pass_td: 4 } })
        .scoring_settings?.rec,
    ).toBe(0.5);
    expect(LeagueSchema.parse({ league_id: '123' }).scoring_settings).toBeUndefined();
  });
});

describe('LeaguesForUserSchema', () => {
  it('parses an array of leagues for a user, matching the real endpoint shape', () => {
    const parsed = LeaguesForUserSchema.parse([
      {
        league_id: '1312235880743706624',
        name: 'Mudd Keeper League',
        season: '2026',
        total_rosters: 10,
      },
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
      {
        user_id: 'u1',
        display_name: 'garrett',
        avatar: 'abc',
        metadata: { team_name: 'The Team' },
      },
      { user_id: 'u2', display_name: 'other', avatar: null, metadata: null },
    ]);
    expect(parsed[0].metadata?.team_name).toBe('The Team');
    expect(parsed[1].avatar).toBeNull();
  });
});

describe('DraftSchema', () => {
  it('parses a pre-draft payload with a null draft_order and identity slot_to_roster_id', () => {
    const parsed = DraftSchema.parse({
      draft_id: '1312235880760479744',
      type: 'snake',
      draft_order: null,
      slot_to_roster_id: { '1': 1, '2': 2, '3': 3 },
      settings: { rounds: 14 },
    });
    expect(parsed.draft_order).toBeNull();
    expect(parsed.slot_to_roster_id).toEqual({ '1': 1, '2': 2, '3': 3 });
  });

  it('parses a completed draft with real draft_order and slot_to_roster_id maps', () => {
    const parsed = DraftSchema.parse({
      draft_id: '1257452519521517571',
      type: 'snake',
      draft_order: { user1: 6, user2: 8 },
      slot_to_roster_id: { '1': 9, '2': 2 },
      settings: { rounds: 14 },
    });
    expect(parsed.draft_order).toEqual({ user1: 6, user2: 8 });
    expect(parsed.slot_to_roster_id).toEqual({ '1': 9, '2': 2 });
  });

  it('tolerates draft_order and slot_to_roster_id being entirely absent', () => {
    const parsed = DraftSchema.parse({ draft_id: 'd1', settings: { rounds: 14 } });
    expect(parsed.draft_order).toBeUndefined();
    expect(parsed.slot_to_roster_id).toBeUndefined();
  });
});

describe('TradedPickSchema', () => {
  it('parses the real captured shape and maps to camelCase', () => {
    const parsed = TradedPicksSchema.parse([
      { round: 4, season: '2026', roster_id: 1, owner_id: 8, previous_owner_id: 1 },
      { round: 7, season: '2026', roster_id: 8, owner_id: 1, previous_owner_id: 8 },
    ]);
    expect(parsed).toEqual([
      { round: 4, season: '2026', rosterId: 1, ownerId: 8, previousOwnerId: 1 },
      { round: 7, season: '2026', rosterId: 8, ownerId: 1, previousOwnerId: 8 },
    ]);
  });

  it('tolerates a missing previous_owner_id', () => {
    const parsed = TradedPicksSchema.parse([
      { round: 4, season: '2026', roster_id: 1, owner_id: 8 },
    ]);
    expect(parsed[0].previousOwnerId).toBeNull();
  });

  it('parses an empty array (no trades this season)', () => {
    expect(TradedPicksSchema.parse([])).toEqual([]);
  });
});

describe('AdpSnapshotSchema', () => {
  it('parses the shape written by scripts/fetch-adp.mjs', () => {
    const parsed = AdpSnapshotSchema.parse({
      fetchedAt: '2026-07-06T00:00:00.000Z',
      attribution: 'Average Draft Position data provided by Fantasy Football Calculator',
      entries: [
        {
          teams: 10,
          format: 'half-ppr',
          meta: { totalDrafts: 394, startDate: '2026-06-30', endDate: '2026-07-05' },
          players: [{ name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: 1.5 }],
        },
      ],
    });
    expect(parsed.entries[0].players[0].adp).toBe(1.5);
  });

  it('tolerates a missing meta block and a null team', () => {
    const parsed = AdpSnapshotSchema.parse({
      fetchedAt: '2026-07-06T00:00:00.000Z',
      entries: [
        { teams: 10, format: 'ppr', players: [{ name: 'Free Agent', position: 'WR', adp: 200 }] },
      ],
    });
    expect(parsed.entries[0].meta).toBeUndefined();
    expect(parsed.entries[0].players[0].team).toBeUndefined();
  });

  it('rejects an entry missing the required players array', () => {
    expect(() =>
      AdpSnapshotSchema.parse({
        fetchedAt: '2026-07-06T00:00:00.000Z',
        entries: [{ teams: 10, format: 'ppr' }],
      }),
    ).toThrow();
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
