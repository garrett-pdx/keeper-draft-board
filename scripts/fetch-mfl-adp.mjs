#!/usr/bin/env node
// Pulls real-draft ADP from MyFantasyLeague and writes public/adp-real-snapshot.json.
//
// Why a second ADP source at all: Fantasy Football Calculator's ADP is derived
// from mock drafts run on its own site. MFL's can be filtered down to drafts
// that actually happened in leagues someone paid to host (2026: $99.95-$109.95
// per league), which is a different and arguably better-motivated population —
// nobody mock-drafts a $100 league. The two disagree enough to be worth having
// both; neither is strictly better, so this is a per-league setting alongside
// FFC and FantasyCalc rather than a replacement (see CLAUDE.md's "Market value
// sources").
//
// The filters are the whole point of this source:
//
//     IS_KEEPER=N   redraft leagues only. Keeper-league ADP is a POST-keeper
//                   board — the best players are kept, not drafted, so they
//                   barely appear (measured: Gibbs in 19% of keeper drafts,
//                   rookie Jeremiyah Love in 93%). That prices exactly the
//                   players the keeper metric is deciding about, so it is the
//                   wrong input here despite the league being a keeper league.
//     IS_MOCK=0     real drafts only, which FFC cannot express at all.
//     PERIOD=ALL    the season to date. PERIOD=RECENT is near-empty this early
//                   (9 drafts vs 91 on the same filters).
//     IS_PPR=1      MFL's PPR flag is binary, no half-PPR. The real-draft pool
//                   is ~98% PPR anyway (231 of 236 drafts), so asking for it
//                   explicitly costs ~5 drafts and makes the `ppr` format label
//                   below honest rather than approximate.
//     CUTOFF=5      MFL's own docs: below 5% "the results may be unpredicatble".
//
// Deliberately NOT filtered by FCOUNT. It works — unlike FFC's `teams`
// parameter, which is a no-op — but at this sample size it costs far more than
// it buys: FCOUNT=10 drops 236 drafts to 38, and 38 drafts is where the noise
// wins (a 36-draft slice had Josh Allen first overall). Revisit if MFL's volume
// grows enough that a 10-team-only cut clears a few hundred drafts.
//
// Terms: "Access to this data is provided free to anyone to use in almost any
// way" (https://api.myfantasyleague.com/2026/api_info). The one access pattern
// MFL forbids is calling the API "via Javascript from web pages outside the
// myfantasyleague.com domain" — which is exactly why this runs in CI and the
// browser only ever reads our own static snapshot, same as the FFC path.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const YEAR = new Date().getUTCFullYear();
const BASE = `https://api.myfantasyleague.com/${YEAR}/export`;
const ADP_QUERY = 'TYPE=adp&IS_KEEPER=N&IS_MOCK=0&PERIOD=ALL&IS_PPR=1&CUTOFF=5&JSON=1';

// MFL asks registered clients to send the User-Agent they registered. We're
// unregistered (one request a day is nowhere near the unregistered limit), but
// identifying the client is still the polite thing to do and makes this
// traffic legible in their logs if it ever needs explaining.
const USER_AGENT = 'keeper-draft-board/1.0 (+https://github.com/garrett-pdx/keeper-draft-board)';

const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'adp-real-snapshot.json',
);

// MFL spells nine teams differently from Sleeper, and one of them matters more
// than the rest: team defenses are matched to Sleeper by team abbreviation
// (their names can't be matched — MFL calls them "Bills, Buffalo", Sleeper
// splits city/nickname across first/last), so an unmapped code silently drops
// that defense rather than mispricing it. Normalizing here keeps the snapshot
// in Sleeper's vocabulary so domain/adp.ts needs no MFL-specific knowledge.
const TEAM_ALIASES = {
  GBP: 'GB',
  JAC: 'JAX',
  KCC: 'KC',
  LVR: 'LV',
  NEP: 'NE',
  NOS: 'NO',
  SFO: 'SF',
  TBB: 'TB',
};

// MFL leagues frequently start IDP, so its ADP set carries defensive players
// (measured: 275 of 704 rows were DE/LB/DT/S/CB). This app is offense-only;
// keeping them would put players on the board that no roster slot can hold.
//
// QB is excluded for a different and much less comfortable reason: MFL's ADP
// export has no QB-count or superflex filter (its parameters are PERIOD,
// FCOUNT, IS_PPR, IS_KEEPER, IS_MOCK, CUTOFF, DETAILS — that's all of them),
// so this pool silently blends 1QB and superflex leagues. Measured against FFC
// on the same day, QBs in the top 40 picks:
//
//     FFC half-ppr (1QB)    1 QB    Allen 22.8
//     MFL real drafts       8 QBs   Allen 4.02, Maye 16.97, Jackson 17.07
//     FFC 2qb               17 QBs  Allen 1.4,  Maye 5.9,   Jackson 5.9
//
// MFL sits between the two markets because it *is* both of them averaged
// together. Every QB here is therefore mispriced for a 1QB league, and this
// app treats the superflex split as a hard partition precisely because the two
// markets aren't comparable (see rankAdpEntries). Since the blend can't be
// undone from outside — MFL exposes no way to ask for one market — the QBs are
// dropped rather than fed into the keeper metric wrong. A QB shows no ADP under
// this source, which the app already renders honestly, and which is the same
// call domain/adp.ts makes for a QB missing from every 1QB format.
const OFFENSE_POSITIONS = new Set(['RB', 'WR', 'TE', 'PK', 'DEF']);
const EXCLUDED_POSITIONS = ['QB'];

// "Chase, Ja'Marr" -> "Ja'Marr Chase"; "Bills, Buffalo" -> "Buffalo Bills".
// Only the first comma splits — a name carrying its own suffix ("Walker III,
// Kenneth") keeps it, and normalizePlayerName strips it downstream.
function flipName(name) {
  const idx = name.indexOf(', ');
  if (idx === -1) return name.trim();
  return `${name.slice(idx + 2).trim()} ${name.slice(0, idx).trim()}`.trim();
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = await res.json();
  if (data.error) throw new Error(`MFL error for ${url}: ${data.error.$t ?? data.error}`);
  return data;
}

// MFL's ADP rows carry only a player id, so the name/position/team dictionary
// has to be fetched alongside it. (Its `stats_global_id` looked like a way to
// join to Sleeper by id and skip name matching entirely, but it isn't: Sleeper
// populates `stats_id` for only 2,980 of 12,218 players — legacy veterans —
// so it matched 64 of 397. Name matching is the reliable path here.)
async function fetchPlayerDictionary() {
  const data = await getJson(`${BASE}?TYPE=players&JSON=1`);
  const rows = data.players?.player;
  if (!Array.isArray(rows)) throw new Error('Unexpected shape for the MFL players export');
  const byId = new Map();
  for (const p of rows) byId.set(p.id, p);
  return byId;
}

async function fetchAdp(players) {
  const data = await getJson(`${BASE}?${ADP_QUERY}`);
  const adp = data.adp;
  const rows = adp?.player;
  if (!Array.isArray(rows)) throw new Error('Unexpected shape for the MFL adp export');

  const out = [];
  let unresolved = 0;
  let skipped = 0;
  let qbs = 0;
  for (const row of rows) {
    const player = players.get(row.id);
    if (!player) {
      unresolved++;
      continue;
    }
    const position = (player.position || '').toUpperCase();
    if (!OFFENSE_POSITIONS.has(position)) {
      if (EXCLUDED_POSITIONS.includes(position)) qbs++;
      else skipped++;
      continue;
    }
    const average = Number(row.averagePick);
    if (!(average > 0)) continue;
    const team = player.team ? TEAM_ALIASES[player.team] || player.team : null;
    out.push({
      name: flipName(player.name),
      position,
      // MFL parks unrostered players on a pseudo-team; null reads as "unknown"
      // downstream, where 'FA' would be matched against as a real abbreviation.
      team: team === 'FA' ? null : team,
      adp: average,
      // MFL's min/max are pick numbers, so its minPick is the *earliest* he
      // went — which is FFC's `high`. Verified against both sources live.
      high: Number(row.minPick) || null,
      low: Number(row.maxPick) || null,
    });
  }
  console.log(
    `resolved ${out.length} players (skipped ${skipped} IDP, ${qbs} QB, ${unresolved} unresolved ids) from ${adp.totalDrafts} drafts`,
  );

  const timestamp = Number(adp.timestamp);
  return {
    // MFL exposes no half-PPR market, and this pool was requested as PPR — so
    // the label is the literal scoring of the drafts behind it, which is what
    // rankAdpEntries sorts on.
    format: 'ppr',
    meta: {
      totalDrafts: Number(adp.totalDrafts) || 0,
      startDate: null, // MFL reports no window start; PERIOD=ALL means season-to-date
      endDate: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : null,
      // Recorded so the file explains its own gap: a reader who notices there
      // isn't a single quarterback in here shouldn't have to guess whether
      // that's a bug. See EXCLUDED_POSITIONS above for why.
      excludedPositions: EXCLUDED_POSITIONS,
    },
    players: out,
  };
}

async function main() {
  const players = await fetchPlayerDictionary();
  const entry = await fetchAdp(players);
  if (entry.players.length < 50) {
    // A near-empty entry is worse than a stale one: it would pass the snapshot
    // through to the app, fail the match threshold, and silently demote the
    // board to Sleeper's rank proxy.
    throw new Error(`Only ${entry.players.length} players resolved — refusing to write`);
  }
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    attribution:
      'Average Draft Position data from real, non-mock redraft leagues hosted by MyFantasyLeague (https://www.myfantasyleague.com)',
    entries: [entry],
  };
  await writeFile(OUT_PATH, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Wrote ${entry.players.length} players to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
