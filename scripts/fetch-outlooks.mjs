#!/usr/bin/env node
// Pulls real, editorial "season outlook" paragraphs from ESPN's public fantasy
// football API and writes a static snapshot to public/outlook-snapshot.json,
// served as-is by the app (same-origin, no CORS problem) and matched against
// Sleeper's player dictionary at runtime via each player's espn_id — see
// src/domain/outlook.ts.
//
// This is an UNDOCUMENTED ESPN endpoint (no official API, no terms page for
// it specifically) discovered the same way the open-source espn-api/ffscrapr
// libraries did: it's what fantasy.espn.com's own frontend calls, and it
// happens to send permissive CORS headers (confirmed live: it reflects
// whatever Origin sends the request, unlike Fantasy Football Calculator's ADP
// API which hard-blocks cross-origin browser calls). It could technically be
// called live from the browser, but this is fetched at CI time anyway, same
// cadence as ADP, to avoid hitting a third-party endpoint on every page load
// and to keep the app's runtime network surface limited to Sleeper + this
// same-origin snapshot (see CLAUDE.md's "Player outlook pipeline" section).
//
// No API key, no signup, no cost — but being undocumented, low, infrequent
// request volume (once daily, ~1200 players total) is used deliberately to
// stay a good citizen of a public endpoint we don't have a support contract
// for.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESPN's fantasy "slot id" per position — confirmed live against real data:
// QB=0, RB=2, WR=4, TE=6, DEF=16, K=17.
const POSITION_SLOTS = { QB: 0, RB: 2, WR: 4, TE: 6, DEF: 16, K: 17 };
const YEAR = new Date().getUTCFullYear();
const BASE = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${YEAR}/segments/0/leaguedefaults/1`;
const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'outlook-snapshot.json',
);

async function fetchOne(position, slotId) {
  const filter = {
    players: {
      filterSlotIds: { value: [slotId] },
      limit: 2000,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };
  const res = await fetch(`${BASE}?view=kona_player_info`, {
    headers: { 'X-Fantasy-Filter': JSON.stringify(filter) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${position}`);
  const data = await res.json();
  if (!Array.isArray(data.players)) {
    throw new Error(`Unexpected response shape for ${position}`);
  }
  return data.players
    .map((entry) => entry.player)
    .filter((p) => p && p.id && p.seasonOutlook && p.seasonOutlook.trim())
    .map((p) => ({ espnId: p.id, name: p.fullName, outlook: p.seasonOutlook.trim() }));
}

/**
 * ESPN id -> Sleeper id.
 *
 * Sleeper's own player dictionary carries an `espn_id`, but it is far too
 * sparse to rely on: measured live, only ~35% of the top 200 fantasy players
 * have one, and the gaps are the biggest names on the board (Bijan Robinson,
 * Gibbs, Ja'Marr Chase, Puka Nacua). Matching outlooks on that field alone left
 * roughly 70% of draftable players with no outlook at all.
 *
 * FantasyCalc publishes BOTH ids on every row (verified 198/198), so it's used
 * as the primary bridge, with Sleeper's own espn_id filling in anyone
 * FantasyCalc doesn't rank. Reconciled here at CI time rather than in the
 * browser so runtime stays a direct lookup with no extra fetch.
 */
async function buildIdBridge() {
  const bridge = new Map();
  try {
    // Both QB formats: the two lists rank slightly different player pools.
    for (const numQbs of [1, 2]) {
      const rows = await (
        await fetch(
          `https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=${numQbs}&numTeams=10&ppr=0.5`,
        )
      ).json();
      for (const row of rows) {
        const { sleeperId, espnId } = row.player ?? {};
        if (sleeperId && espnId) bridge.set(String(espnId), String(sleeperId));
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch (err) {
    console.error(`FantasyCalc id bridge unavailable (${err.message}) — falling back to Sleeper`);
  }
  try {
    const players = await (await fetch('https://api.sleeper.app/v1/players/nfl')).json();
    for (const [sleeperId, p] of Object.entries(players)) {
      if (p?.espn_id == null) continue;
      const key = String(p.espn_id);
      if (!bridge.has(key)) bridge.set(key, sleeperId);
    }
  } catch (err) {
    console.error(`Sleeper player dictionary unavailable (${err.message})`);
  }
  return bridge;
}

async function main() {
  const byEspnId = new Map();
  for (const [position, slotId] of Object.entries(POSITION_SLOTS)) {
    try {
      const players = await fetchOne(position, slotId);
      players.forEach((p) => byEspnId.set(p.espnId, p));
      console.log(`fetched ${position}: ${players.length} players with an outlook`);
    } catch (err) {
      console.error(`skipping ${position}: ${err.message}`);
    }
    // Be a good citizen of an undocumented endpoint — small, spaced-out
    // requests rather than a burst.
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!byEspnId.size) {
    console.error('No outlooks fetched at all — leaving any existing snapshot in place.');
    process.exit(1);
  }
  const bridge = await buildIdBridge();
  const players = [...byEspnId.values()].map((p) => ({
    ...p,
    sleeperId: bridge.get(String(p.espnId)) ?? null,
  }));
  const resolved = players.filter((p) => p.sleeperId).length;
  console.log(
    `resolved a Sleeper id for ${resolved}/${players.length} outlooks (bridge size ${bridge.size})`,
  );

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    attribution: 'Player outlooks provided by ESPN Fantasy Football',
    players,
  };
  await writeFile(OUT_PATH, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Wrote ${snapshot.players.length} player outlooks to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
