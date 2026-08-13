import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AdpSnapshotSchema } from '../src/api/schemas';
import { matchAdpToPlayers } from '../src/domain/adp';
import type { PlayersMap } from '../src/types';

// These assert against the committed public/adp-real-snapshot.json rather than
// a fixture, because the risk being guarded is drift between what
// scripts/fetch-mfl-adp.mjs writes and what the app can read. A fixture would
// keep passing while the real file rotted. CI regenerates this daily, so a
// change in MFL's own shape surfaces here.
const snapshotPath = path.join(__dirname, '..', 'public', 'adp-real-snapshot.json');
const raw = JSON.parse(readFileSync(snapshotPath, 'utf8'));

describe('the committed MFL ADP snapshot', () => {
  it('parses against AdpSnapshotSchema', () => {
    const parsed = AdpSnapshotSchema.parse(raw);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].players.length).toBeGreaterThan(50);
  });

  it('keeps excludedPositions through the parse', () => {
    // zod strips undeclared keys silently, so a field can vanish between the
    // generator and the app without anything failing. This is the same trap
    // numTeams/ppr fell into on the value snapshot.
    const parsed = AdpSnapshotSchema.parse(raw);
    expect(parsed.entries[0].meta?.excludedPositions).toEqual(['QB']);
  });

  it('prices no quarterbacks', () => {
    // MFL blends 1QB and superflex leagues with no way to ask for one, so every
    // QB it reports is wrong for a 1QB league. Dropping them is deliberate —
    // see scripts/fetch-mfl-adp.mjs.
    const positions = new Set(raw.entries[0].players.map((p: { position: string }) => p.position));
    expect(positions.has('QB')).toBe(false);
    expect(positions.has('RB')).toBe(true);
  });

  it('carries no IDP rows', () => {
    const positions = new Set(raw.entries[0].players.map((p: { position: string }) => p.position));
    for (const idp of ['DE', 'LB', 'DT', 'S', 'CB']) expect(positions.has(idp)).toBe(false);
  });

  it("uses Sleeper's team abbreviations, not MFL's", () => {
    // MFL spells nine teams differently. An unmapped code doesn't throw, it
    // just silently fails to match — worst for defenses, which are matched to
    // Sleeper by abbreviation alone.
    const teams = new Set(raw.entries[0].players.map((p: { team: string | null }) => p.team));
    for (const mflOnly of ['GBP', 'JAC', 'KCC', 'LVR', 'NEP', 'NOS', 'SFO', 'TBB', 'FA']) {
      expect(teams.has(mflOnly)).toBe(false);
    }
  });

  it('writes names first-last, not MFL’s "Last, First"', () => {
    for (const p of raw.entries[0].players) expect(p.name).not.toContain(', ');
  });
});

describe('matchAdpToPlayers on MFL-shaped rows', () => {
  const playersMap: PlayersMap = {
    p1: {
      id: 'p1',
      first: 'Brandon',
      last: 'Aubrey',
      pos: 'K',
      team: 'DAL',
      rank: 1,
      birthDate: null,
      espnId: null,
    },
    p2: {
      id: 'p2',
      first: 'Seattle',
      last: 'Seahawks',
      pos: 'DEF',
      team: 'SEA',
      rank: 2,
      birthDate: null,
      espnId: null,
    },
    p3: {
      id: 'p3',
      first: 'Kenneth',
      last: 'Walker',
      pos: 'RB',
      team: 'SEA',
      rank: 3,
      birthDate: null,
      espnId: null,
    },
  };

  it('matches the positions and names the MFL generator emits', () => {
    const { adp } = matchAdpToPlayers(
      [
        {
          format: 'ppr',
          players: [
            // MFL says PK where Sleeper says K.
            { name: 'Brandon Aubrey', position: 'PK', team: 'DAL', adp: 143 },
            // Defenses can't match by name in either direction — MFL flips to
            // "Seattle Seahawks", Sleeper splits city/nickname — so the team
            // abbreviation is the join, which is why normalizing it matters.
            { name: 'Seattle Seahawks', position: 'DEF', team: 'SEA', adp: 105.05 },
            // A suffix MFL keeps inside its "Last, First" surname field and the
            // generator therefore carries through verbatim.
            { name: 'Kenneth Walker III', position: 'RB', team: 'SEA', adp: 41.2 },
          ],
        },
      ],
      playersMap,
    );
    expect(adp.p1).toBe(143);
    expect(adp.p2).toBe(105.05);
    expect(adp.p3).toBe(41.2);
  });
});
