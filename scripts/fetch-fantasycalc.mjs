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
// Only TWO entries are stored, because only one parameter genuinely changes the
// data. Measured live against numTeams=10&ppr=0.5, as mean/max shift in rank
// position across ~198 players:
//
//     teams 8/12/14 vs 10   mean 0.25-0.64, max 3-4   <- noise
//     ppr 0 / 1     vs 0.5  mean 0.19-0.24, max 3     <- noise
//     numQbs 2      vs 1    mean 25.25,     max 103   <- the real dimension
//
// Team count and scoring move players less than a single slot on average, so a
// format matrix would be 24 near-identical copies. Superflex is the split that
// matters, exactly as with the ADP snapshot.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.fantasycalc.com/values/current';
// Representative values for the dimensions that don't meaningfully vary.
const NOMINAL_TEAMS = 10;
const NOMINAL_PPR = 0.5;
const QB_COUNTS = [1, 2];

const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'value-snapshot.json',
);

async function fetchOne(numQbs) {
  const url = `${API}?isDynasty=false&numQbs=${numQbs}&numTeams=${NOMINAL_TEAMS}&ppr=${NOMINAL_PPR}`;
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
    players.push({ id: String(id), rank, value: row.value ?? null });
  }
  if (!players.length) throw new Error(`No rows carried a sleeperId for ${url}`);
  return { numQbs, players };
}

async function main() {
  const entries = [];
  for (const numQbs of QB_COUNTS) {
    try {
      const entry = await fetchOne(numQbs);
      entries.push(entry);
      console.log(`fetched ${numQbs}QB: ${entry.players.length} players`);
    } catch (err) {
      console.error(`skipping ${numQbs}QB: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
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
  await writeFile(OUT_PATH, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Wrote ${entries.length} entries to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
