import { describe, it, expect } from 'vitest';
import {
  buildPrevDraftMap,
  rosteredOwnersFromRosters,
  type PrevDraftPick,
  type PrevKeeperInput,
} from '../src/domain/prevKeepers';
import { getRosterKeeperCosts } from '../src/domain/keeperCost';
import type { SleeperDraft } from '../src/api/schemas';

// Roster 1 sits on slot 1, roster 2 on slot 2 — so a pick by roster 1 with
// draft_slot 2 was made with capital acquired from roster 2.
const DRAFT: SleeperDraft = {
  type: 'snake',
  draft_order: { ownerA: 1 },
  slot_to_roster_id: { '1': 1, '2': 2 },
};
const OWNERS = { '1': 'ownerA', '2': 'ownerB' };

function pick(over: Partial<PrevDraftPick> & { player_id: string }): PrevDraftPick {
  return { round: 5, roster_id: 1, draft_slot: 1, ...over };
}

function build(over: Partial<PrevKeeperInput> & { picks: PrevDraftPick[] }) {
  return buildPrevDraftMap({
    prevDraft: DRAFT,
    prevRosterOwner: OWNERS,
    rosteredOwnersByPlayer: {},
    maxKeepers: 2,
    ...over,
  });
}

describe('buildPrevDraftMap', () => {
  it('always trusts Sleeper’s own is_keeper flag', () => {
    const map = build({ picks: [pick({ player_id: 'p1', is_keeper: true })] });
    expect(map.p1.wasKeeper).toBe(true);
  });

  it('records round, roster and the stable owner id for every pick', () => {
    const map = build({ picks: [pick({ player_id: 'p1', round: 7, roster_id: 2 })] });
    expect(map.p1).toEqual({ round: 7, rosterId: 2, ownerId: 'ownerB', wasKeeper: false });
  });

  it('does NOT treat an ordinary pick made from an acquired slot as a keeper', () => {
    // The 12 false positives: acquired slot, but the manager never held him.
    const map = build({
      picks: [pick({ player_id: 'p1', draft_slot: 2 })],
      rosteredOwnersByPlayer: { p1: new Set(['ownerB']) }, // held by someone else
    });
    expect(map.p1.wasKeeper).toBe(false);
  });

  it('treats an acquired-slot pick as a keeper when the same manager already held him', () => {
    // The Nabers/Daniels shape: Sleeper can't flag it, corroboration can.
    const map = build({
      picks: [pick({ player_id: 'p1', draft_slot: 2 })],
      rosteredOwnersByPlayer: { p1: new Set(['ownerA']) },
    });
    expect(map.p1.wasKeeper).toBe(true);
  });

  it('never infers from a pick made on the roster’s own slot', () => {
    const map = build({
      picks: [pick({ player_id: 'p1', draft_slot: 1 })],
      rosteredOwnersByPlayer: { p1: new Set(['ownerA']) },
    });
    expect(map.p1.wasKeeper).toBe(false);
  });

  it('refuses a corroborated candidate once real keepers already fill the cap', () => {
    // The 2024 Jakobi Meyers shape: corroborates, but the roster already has
    // two is_keeper picks, so a third keeper is impossible under league rules.
    const map = build({
      picks: [
        pick({ player_id: 'k1', is_keeper: true }),
        pick({ player_id: 'k2', is_keeper: true }),
        pick({ player_id: 'p1', draft_slot: 2 }),
      ],
      rosteredOwnersByPlayer: { p1: new Set(['ownerA']) },
    });
    expect(map.k1.wasKeeper).toBe(true);
    expect(map.k2.wasKeeper).toBe(true);
    expect(map.p1.wasKeeper).toBe(false);
  });

  it('admits corroborated candidates that exactly fit the free slots', () => {
    const map = build({
      picks: [pick({ player_id: 'k1', is_keeper: true }), pick({ player_id: 'p1', draft_slot: 2 })],
      rosteredOwnersByPlayer: { p1: new Set(['ownerA']) },
    });
    expect(map.p1.wasKeeper).toBe(true);
  });

  it('admits NONE when corroborated candidates outnumber the free slots', () => {
    // Deliberately refuses to guess rather than inventing a tie-break.
    const map = build({
      picks: [
        pick({ player_id: 'k1', is_keeper: true }),
        pick({ player_id: 'p1', draft_slot: 2, round: 2 }),
        pick({ player_id: 'p2', draft_slot: 2, round: 12 }),
      ],
      rosteredOwnersByPlayer: { p1: new Set(['ownerA']), p2: new Set(['ownerA']) },
    });
    expect(map.p1.wasKeeper).toBe(false);
    expect(map.p2.wasKeeper).toBe(false);
  });

  it('counts the cap per roster, not league-wide', () => {
    const map = build({
      picks: [
        pick({ player_id: 'k1', roster_id: 1, is_keeper: true }),
        pick({ player_id: 'k2', roster_id: 1, is_keeper: true }),
        pick({ player_id: 'p1', roster_id: 2, draft_slot: 1 }),
      ],
      rosteredOwnersByPlayer: { p1: new Set(['ownerB']) },
    });
    expect(map.p1.wasKeeper).toBe(true); // roster 2's own slots are untouched
  });

  it('disables inference entirely when the season-before data is unavailable', () => {
    const map = build({
      picks: [pick({ player_id: 'p1', draft_slot: 2 }), pick({ player_id: 'k1', is_keeper: true })],
      rosteredOwnersByPlayer: null,
    });
    expect(map.p1.wasKeeper).toBe(false);
    expect(map.k1.wasKeeper).toBe(true); // is_keeper still works
  });

  it('disables inference when the prev-season owner map is empty', () => {
    // Without owner ids there is nothing to join on, and roster_id across a
    // two-season gap is noise.
    const map = build({
      picks: [pick({ player_id: 'p1', draft_slot: 2 })],
      prevRosterOwner: {},
      rosteredOwnersByPlayer: { p1: new Set(['ownerA']) },
    });
    expect(map.p1.wasKeeper).toBe(false);
  });

  it('never corroborates a pick whose roster has no owner (orphan team)', () => {
    const map = build({
      picks: [pick({ player_id: 'p1', roster_id: 2, draft_slot: 1 })],
      prevRosterOwner: { '1': 'ownerA' }, // roster 2 unclaimed
      rosteredOwnersByPlayer: { p1: new Set(['ownerA']) },
    });
    expect(map.p1.wasKeeper).toBe(false);
  });

  it('degrades to is_keeper alone when the previous draft is unavailable', () => {
    const map = build({
      picks: [pick({ player_id: 'p1', draft_slot: 2 }), pick({ player_id: 'k1', is_keeper: true })],
      prevDraft: null,
      rosteredOwnersByPlayer: { p1: new Set(['ownerA']) },
    });
    expect(map.p1.wasKeeper).toBe(false);
    expect(map.k1.wasKeeper).toBe(true);
  });

  it('skips picks with no player', () => {
    expect(Object.keys(build({ picks: [{ round: 1, roster_id: 1, draft_slot: 1 }] }))).toEqual([]);
  });
});

describe('rosteredOwnersFromRosters', () => {
  it('maps each player to every owner holding them', () => {
    const out = rosteredOwnersFromRosters([
      { owner_id: 'ownerA', players: ['p1', 'p2'] },
      { owner_id: 'ownerB', players: ['p3'] },
    ]);
    expect(out!.p1).toEqual(new Set(['ownerA']));
    expect(out!.p3).toEqual(new Set(['ownerB']));
  });

  it('returns null for missing rosters, which callers read as “no inference”', () => {
    expect(rosteredOwnersFromRosters(null)).toBeNull();
  });

  it('tolerates unclaimed teams and null player lists', () => {
    const out = rosteredOwnersFromRosters([
      { owner_id: null, players: ['p1'] },
      { owner_id: 'ownerA', players: null },
    ]);
    expect(out).toEqual({});
  });
});

describe('a corroborated keeper flows through to an inflated cost', () => {
  it('charges a round more the second year, exactly like an is_keeper one', () => {
    const prevDraftMap = buildPrevDraftMap({
      picks: [{ player_id: 'p1', round: 5, roster_id: 1, draft_slot: 2 }],
      prevDraft: DRAFT,
      prevRosterOwner: OWNERS,
      rosteredOwnersByPlayer: { p1: new Set(['ownerA']) },
      maxKeepers: 2,
    });
    expect(prevDraftMap.p1.wasKeeper).toBe(true);

    const [item] = getRosterKeeperCosts({
      keeperIds: ['p1'],
      prevDraftMap,
      playersMap: {
        p1: {
          id: 'p1',
          first: 'A',
          last: 'B',
          pos: 'RB',
          team: 'SF',
          rank: 10,
          birthDate: null,
          espnId: null,
        },
      },
      adpMap: { p1: 20 },
      ownerId: 'ownerA', // same manager keeping again
      rosterId: 1,
      lastRound: 15,
      teamCount: 10,
      inflationRounds: 1,
    });
    expect(item.base).toBe(5);
    expect(item.cost).toBe(4); // inflated toward round 1
  });
});
