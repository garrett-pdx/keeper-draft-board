import { z } from 'zod';

// Runtime validation for the Sleeper responses we consume. Schemas are lenient
// on purpose: Sleeper's API is only partly documented (and its ADP/projections
// endpoint is undocumented), so we validate the fields we rely on and tolerate
// anything else. Unknown keys are stripped by default.

export const LeagueSchema = z.object({
  league_id: z.string(),
  name: z.string().optional(),
  season: z.string().optional(),
  draft_id: z.string().nullish(),
  previous_league_id: z.string().nullish(),
  roster_positions: z.array(z.string()).optional(),
  total_rosters: z.number().optional(), // team count; used by the username→league picker list
});
export type SleeperLeague = z.infer<typeof LeagueSchema>;

// GET /v1/user/<user_id>/leagues/nfl/<season> returns the same shape as a
// single league fetch (verified live against the Sleeper API), so this is a
// plain alias rather than a distinct schema.
export const LeaguesForUserSchema = z.array(LeagueSchema);

export const UserSchema = z.object({
  user_id: z.string(),
  display_name: z.string().optional(),
  avatar: z.string().nullish(),
  metadata: z.object({ team_name: z.string().optional() }).nullish(),
});
export type SleeperUser = z.infer<typeof UserSchema>;
export const UsersSchema = z.array(UserSchema);

// GET /v1/user/<username> — the single-user lookup used by the username→league
// picker. Distinct from UserSchema above: that one models a league member (has
// `metadata.team_name`), this models the standalone account lookup response.
export const UserLookupSchema = z.object({
  user_id: z.string(),
  username: z.string().optional(),
  display_name: z.string().optional(),
  avatar: z.string().nullish(),
});
export type SleeperUserLookup = z.infer<typeof UserLookupSchema>;

export const RosterSchema = z.object({
  roster_id: z.number(),
  owner_id: z.string().nullable(), // orphan/unclaimed teams can have a null owner
  players: z.array(z.string()).nullish(),
});
export type SleeperRoster = z.infer<typeof RosterSchema>;
export const RostersSchema = z.array(RosterSchema);

export const DraftSchema = z.object({
  draft_id: z.string().optional(),
  type: z.string().optional(), // only trust pick math when this is 'snake'
  // draft_order: user_id -> slot. Sleeper sets this to null (with a default
  // identity slot_to_roster_id) until the commissioner actually sets the
  // order — see hasKnownDraftOrder in domain/draftOrder.ts.
  draft_order: z.record(z.string(), z.number()).nullish(),
  slot_to_roster_id: z.record(z.string(), z.number()).nullish(), // slot -> roster_id
  settings: z.object({ rounds: z.number().optional() }).nullish(),
});
export type SleeperDraft = z.infer<typeof DraftSchema>;

export const PickSchema = z.object({
  player_id: z.string().nullish(),
  round: z.number(),
  roster_id: z.number(),
  is_keeper: z.boolean().nullish(),
});
export const PicksSchema = z.array(PickSchema);

// The players dictionary is ~5MB / ~11k entries and is cached ~20h. We keep it
// as a typed shape and slim it defensively rather than running per-entry schema
// validation on every field (a needless per-load cost). See ensurePlayersLoaded.
export interface RawPlayer {
  first_name?: string;
  last_name?: string;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  search_rank?: number | null;
}
export type PlayersResponse = Record<string, RawPlayer | null>;
