#!/usr/bin/env node
// Pulls FantasyCalc's redraft player values and writes public/value-snapshot.json.
//
// FantasyCalc publishes *trade values*, not ADP — there is no ADP endpoint and
// `maybeAdp` is null on every row (verified live, 198 redraft + 474 dynasty).
// So `overallRank` here answers "how good is this player", where ADP answers
// "what does it cost to get him". The app treats the rank as an implied market
// pick; see src/domain/marketValue.ts and CLAUDE.md's "Market value sources".
//
// Fetched at CI time like the ADP snapshot: api.fantasycalc.com sends no CORS
// headers, so the deployed site can't call it directly (confirmed live).
//
// A full matrix is stored (team count x scoring x QB count) so a league is
// always priced against its own shape rather than a nominal one. Measured live
// against numTeams=10&ppr=0.5, as mean/max shift in rank position across ~198
// players:
//
//     teams 8/12/14 vs 10   mean 0.25-0.64, max 3-4   <- small but real
//     ppr 0 / 1     vs 0.5  mean 0.19-0.24, max 3     <- small but real
//     numQbs 2      vs 1    mean 25.25,     max 103   <- dominant
//
// QB count dominates and is a hard partition at runtime; the other two shift
// players by well under a slot on average. They're kept anyway because they DO
// vary — unlike Fantasy Football Calculator's `teams` parameter, which returns
// byte-identical data for 8/10/12/14 and is therefore genuinely nothing to
// store (re-verified; see CLAUDE.md's "ADP data pipeline").
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.fantasycalc.com/values/current';
const TEAM_COUNTS = [8, 10, 12, 14];
const PPR_VALUES = [0, 0.5, 1];
const QB_COUNTS = [1, 2];

const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'value-snapshot.json',
);

async function fetchOne(numQbs, numTeams, ppr) {
  const url = `${API}?isDynasty=false&numQbs=${numQbs}&numTeams=${numTeams}&ppr=${ppr}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error(`Unexpected response shape for ${url}`);

  // Keyed by Sleeper id, which FantasyCalc supplies on every row — so matching
  // is an exact id lookup at runtime, with none of the name-normalisation
  // guesswork the ADP snapshot needs.
  const players = [];
  for (const row of data) {
    const id = row?.player?.sleeperId;
    const rank = row?.overallRank;
    if (!id || typeof rank !== 'number' || rank <= 0) continue;
    // Only id + rank: `value` is never read by the app, and at 24 entries the
    // bytes matter more than the curiosity.
    players.push({ id: String(id), rank });
  }
  if (!players.length) throw new Error(`No rows carried a sleeperId for ${url}`);
  return { numQbs, numTeams, ppr, players };
}

async function main() {
  const entries = [];
  for (const numQbs of QB_COUNTS) {
    for (const numTeams of TEAM_COUNTS) {
      for (const ppr of PPR_VALUES) {
        try {
          const entry = await fetchOne(numQbs, numTeams, ppr);
          entries.push(entry);
          console.log(
            `fetched ${numQbs}QB / ${numTeams}tm / ${ppr}ppr: ${entry.players.length} players`,
          );
        } catch (err) {
          console.error(`skipping ${numQbs}QB / ${numTeams}tm / ${ppr}ppr: ${err.message}`);
        }
        // Be polite — this is a free API and the matrix is 24 requests.
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  if (!entries.length) {
    console.error('No value entries fetched at all — leaving any existing snapshot in place.');
    process.exit(1);
  }
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    attribution: 'Player values provided by FantasyCalc (https://fantasycalc.com)',
    entries,
  };
  await writeFile(OUT_PATH, JSON.stringify(snapshot) + '\n');
  console.log(`Wrote ${entries.length} entries to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
