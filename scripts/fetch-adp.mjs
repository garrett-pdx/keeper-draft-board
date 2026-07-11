#!/usr/bin/env node
// Pulls real, crowd-sourced ADP data from Fantasy Football Calculator's public
// REST API and writes a static snapshot to public/adp-snapshot.json, served
// as-is by the app (same-origin, no CORS issue) and matched against Sleeper's
// player dictionary at runtime — see src/domain/adp.ts.
//
// This can only run server-side: FFC's API sends no CORS headers, so a direct
// browser fetch() from the deployed site fails (confirmed live). Refreshed
// twice weekly by .github/workflows/refresh-adp.yml (Monday and Friday).
//
// FFC's terms (https://help.fantasyfootballcalculator.com/article/42-adp-rest-api):
// free for personal/commercial use, attribution requested (see index.html's
// footer), data updates ~daily on their end — don't call this too frequently.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEAM_COUNTS = [8, 10, 12, 14];
const FORMATS = ['standard', 'half-ppr', 'ppr'];
const YEAR = new Date().getUTCFullYear();
const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'adp-snapshot.json',
);

async function fetchOne(format, teams) {
  const url = `https://fantasyfootballcalculator.com/api/v1/adp/${format}?teams=${teams}&year=${YEAR}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = await res.json();
  if (data.status !== 'Success' || !Array.isArray(data.players)) {
    throw new Error(`Unexpected response shape for ${url}`);
  }
  return {
    teams,
    format,
    meta: {
      totalDrafts: data.meta?.total_drafts ?? 0,
      startDate: data.meta?.start_date ?? null,
      endDate: data.meta?.end_date ?? null,
    },
    players: data.players.map((p) => ({
      name: p.name,
      position: p.position,
      team: p.team ?? null,
      adp: p.adp,
      high: p.high ?? null,
      low: p.low ?? null,
    })),
  };
}

async function main() {
  const entries = [];
  for (const format of FORMATS) {
    for (const teams of TEAM_COUNTS) {
      try {
        const entry = await fetchOne(format, teams);
        entries.push(entry);
        console.log(
          `fetched ${format} / ${teams} teams: ${entry.players.length} players (${entry.meta.totalDrafts} drafts)`,
        );
      } catch (err) {
        console.error(`skipping ${format} / ${teams} teams: ${err.message}`);
      }
      // Be polite — FFC's own docs ask us not to hammer the API.
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (!entries.length) {
    console.error('No ADP entries fetched at all — leaving any existing snapshot in place.');
    process.exit(1);
  }
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    attribution:
      'Average Draft Position data provided by Fantasy Football Calculator (https://fantasyfootballcalculator.com)',
    entries,
  };
  await writeFile(OUT_PATH, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Wrote ${entries.length} entries to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
