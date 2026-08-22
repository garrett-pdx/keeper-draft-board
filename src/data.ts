// Stateful, cache-aware data loaders. Each honors a `force` flag to bypass cache.
import { fetchAdpSnapshot, fetchRealAdpSnapshot } from './api/adpSnapshot';
import { fetchOutlookSnapshot } from './api/outlookSnapshot';
import { fetchJSON, sleeper } from './api/sleeper';
import {
  ADP_MAX_AGE_MS,
  LS_ADP_CACHE_PREFIX,
  LS_OUTLOOK_CACHE_PREFIX,
  LS_PLAYERS_CACHE,
  PLAYERS_MAX_AGE_MS,
  state,
} from './state';
import type { SleeperDraft } from './api/schemas';
import { matchAdpToPlayers, rankAdpEntries } from './domain/adp';
import {
  blendMarketMaps,
  describeValueEntry,
  matchValueToPlayers,
  pickValueEntry,
} from './domain/marketValue';
import { fetchValueSnapshot } from './api/valueSnapshot';
import { isSuperflexLeague, maxKeepersFromLeague } from './domain/leagueSettings';
import { buildLockedKeepers } from './domain/lockedKeepers';
import { buildPrevDraftMap, rosteredOwnersFromRosters } from './domain/prevKeepers';
import { espnKey, sleeperKey } from './domain/outlook';
import type { TradedPicksList } from './domain/tradedPicks';
import type { MarketSource, OutlookMap, PlayersMap, PrevDraftMap } from './types';

// ---------- players map (cached, slimmed) ----------
export async function ensurePlayersLoaded(force?: boolean): Promise<PlayersMap> {
  if (state.playersMap && !force) return state.playersMap;
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(LS_PLAYERS_CACHE) || 'null');
      if (cached && Date.now() - cached.ts < PLAYERS_MAX_AGE_MS) {
        state.playersMap = cached.data;
        return state.playersMap!;
      }
    } catch {
      /* ignore, refetch */
    }
  }
  const full = await sleeper.players();
  const slim: PlayersMap = {};
  for (const pid in full) {
    const p = full[pid];
    if (!p) continue;
    const fantasyPositions = p.fantasy_positions;
    const searchRank = p.search_rank;
    const espnId = typeof p.espn_id === 'string' ? Number(p.espn_id) : p.espn_id;
    slim[pid] = {
      id: pid,
      first: p.first_name || '',
      last: p.last_name || '',
      pos: (fantasyPositions && fantasyPositions[0]) || p.position || '—',
      team: p.team || 'FA',
      rank: typeof searchRank === 'number' ? searchRank : 9999,
      birthDate: p.birth_date || null,
      espnId: typeof espnId === 'number' && !isNaN(espnId) ? espnId : null,
    };
  }
  state.playersMap = slim;
  try {
    localStorage.setItem(LS_PLAYERS_CACHE, JSON.stringify({ ts: Date.now(), data: slim }));
  } catch {
    /* storage full — proceed without caching */
  }
  return slim;
}

// ---------- ADP (real data, snapshotted at build time — see domain/adp.ts) ----------
export async function ensureAdpLoaded(force?: boolean) {
  if (state.adpMap && !force) return { adpMap: state.adpMap, source: state.adpSource };
  // The source is part of the key, not just the payload: without it a cached
  // map built from the other source is handed back before the preference is
  // ever consulted, so switching sources appears to do nothing until the cache
  // expires.
  const cacheKey = `${LS_ADP_CACHE_PREFIX}${state.season}_${state.leagueId}_${state.rules.marketSource}`;
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached && Date.now() - cached.ts < ADP_MAX_AGE_MS) {
        state.adpMap = cached.data;
        state.adpRangeMap = cached.range || {};
        state.adpSource = cached.source;
        state.marketEntryLabel = cached.entryLabel ?? null;
        state.marketSourceCount = cached.sourceCount ?? null;
        return { adpMap: state.adpMap, source: state.adpSource };
      }
    } catch {
      /* ignore */
    }
  }

  const superflex = isSuperflexLeague(state.league?.roster_positions);
  let adpMap: Record<string, number> | null = null;
  let rangeMap: Record<string, { high: number | null; low: number | null }> = {};
  let source: MarketSource | null = null;

  // One source's worth of work, isolated so both paths below can use it: the
  // single-source path takes the first that succeeds, and the blend needs all
  // of them. Returns null rather than throwing on a snapshot that loads but
  // matches too little to trust.
  const REAL_SOURCES = ['value', 'adp', 'adp-real'] as const;
  type RealSource = (typeof REAL_SOURCES)[number];
  const loadOne = async (
    which: RealSource,
  ): Promise<{
    adp: Record<string, number>;
    range: Record<string, { high: number | null; low: number | null }>;
    label: string | null;
  } | null> => {
    if (which === 'value') {
      const snapshot = await fetchValueSnapshot();
      const entry = pickValueEntry(snapshot.entries, {
        teams: state.rosters.length || 10,
        recPoints: state.league?.scoring_settings?.rec,
        superflex,
      });
      const players = await ensurePlayersLoaded(false);
      const matched = matchValueToPlayers(entry, players);
      if (Object.keys(matched).length < 20) return null;
      // A value rank has no real draft-position spread.
      return { adp: matched, range: {}, label: describeValueEntry(entry) };
    }
    const snapshot = which === 'adp-real' ? await fetchRealAdpSnapshot() : await fetchAdpSnapshot();
    const ranked = rankAdpEntries(snapshot.entries, state.league?.scoring_settings?.rec, superflex);
    if (!ranked.length) return null;
    const players = await ensurePlayersLoaded(false);
    const matched = matchAdpToPlayers(ranked, players);
    if (Object.keys(matched.adp).length < 20) return null;
    // Neither ADP source has a league-size dimension — FFC returns
    // byte-identical data for 8/10/12/14, and the MFL snapshot doesn't filter
    // on FCOUNT — so an entry is described by scoring format. MFL's sample size
    // is its main caveat, so it's named outright rather than left for someone
    // to find in the JSON.
    const drafts = ranked[0].meta?.totalDrafts;
    const label =
      which === 'adp-real' && drafts
        ? `${ranked[0].format} · ${drafts} real drafts`
        : ranked[0].format;
    return { adp: matched.adp, range: matched.range, label };
  };

  const preferred = state.rules.marketSource;

  if (preferred === 'blend') {
    // Every source, not the first that answers — the whole point is to average
    // them. Each is allowed to fail independently; a blend of two is still a
    // blend. Below one, there is nothing to average and this falls through to
    // the single-source path rather than dressing one source up as a consensus.
    const loaded = await Promise.all(REAL_SOURCES.map((s) => loadOne(s).catch(() => null)));
    const available = loaded.filter((r): r is NonNullable<typeof r> => r !== null);
    if (available.length >= 2) {
      const { blended, sourceCount } = blendMarketMaps(available.map((r) => r.adp));
      adpMap = blended;
      // No range: high/low describe the spread of one source's real drafts, and
      // there is no honest way to attribute a spread to an average of three.
      rangeMap = {};
      source = 'blend';
      state.marketSourceCount = sourceCount;
      state.marketEntryLabel = `${available.length} sources averaged`;
    }
  }

  if (!adpMap) {
    // Whichever single source is asked for is tried first; the others are
    // fallbacks, so a single bad snapshot degrades to another real source
    // rather than straight to Sleeper's crude rank proxy. A 'blend' preference
    // that couldn't gather two sources lands here too, on the normal order.
    const attempts: RealSource[] = [
      ...REAL_SOURCES.filter((s) => s === preferred),
      ...REAL_SOURCES.filter((s) => s !== preferred),
    ];
    for (const attempt of attempts) {
      if (adpMap) break;
      try {
        const result = await loadOne(attempt);
        if (result) {
          adpMap = result.adp;
          rangeMap = result.range;
          source = attempt;
          state.marketSourceCount = null;
          state.marketEntryLabel = result.label;
        }
      } catch {
        /* try the next source, then the rank proxy */
      }
    }
  }

  if (adpMap) {
    state.adpMap = adpMap;
    state.adpRangeMap = rangeMap;
    state.adpSource = source;
  } else {
    const players = await ensurePlayersLoaded(false);
    const rankMap: Record<string, number> = {};
    for (const pid in players) rankMap[pid] = players[pid].rank;
    state.adpMap = rankMap;
    state.adpRangeMap = {}; // rank proxy has no real draft-position range to show
    state.adpSource = 'rank';
    state.marketEntryLabel = null;
    state.marketSourceCount = null;
  }
  try {
    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        ts: Date.now(),
        data: state.adpMap,
        range: state.adpRangeMap,
        source: state.adpSource,
        entryLabel: state.marketEntryLabel,
        sourceCount: state.marketSourceCount,
      }),
    );
  } catch {
    /* storage full — proceed without caching */
  }
  return { adpMap: state.adpMap, source: state.adpSource };
}

// ---------- player outlooks (ESPN, snapshotted at build time — see domain/outlook.ts) ----------
export async function ensureOutlookLoaded(force?: boolean): Promise<OutlookMap> {
  if (Object.keys(state.outlookMap).length && !force) return state.outlookMap;
  const cacheKey = LS_OUTLOOK_CACHE_PREFIX + state.season;
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached && Date.now() - cached.ts < PLAYERS_MAX_AGE_MS) {
        state.outlookMap = cached.data || {};
        return state.outlookMap;
      }
    } catch {
      /* ignore */
    }
  }

  const outlookMap: OutlookMap = {};
  try {
    const snapshot = await fetchOutlookSnapshot();
    // Indexed under both ids so a player matches on whichever the app knows.
    snapshot.players.forEach((p) => {
      outlookMap[espnKey(p.espnId)] = p.outlook;
      if (p.sleeperId) outlookMap[sleeperKey(p.sleeperId)] = p.outlook;
    });
  } catch {
    /* leave empty — outlook teasers just won't render */
  }
  state.outlookMap = outlookMap;
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: outlookMap }));
  } catch {
    /* storage full — proceed without caching */
  }
  return state.outlookMap;
}

// ---------- previous season draft (for keeper cost) ----------
// Keeper "same team last year" is matched on the manager's user_id, which is
// stable across seasons — roster_id can change year to year. We map each
// previous-season pick's roster_id -> previous owner user_id, storing that on
// the pick record; callers compare against the CURRENT roster's owner_id.
//
// Deciding which of those picks were actually KEPT is its own problem, because
// Sleeper's is_keeper flag misses any keeper drafted with a traded pick — see
// domain/prevKeepers.ts, which owns that verdict. This function's job is
// purely to gather the four inputs it needs and hand them over.
export async function ensurePrevDraftLoaded(force?: boolean): Promise<PrevDraftMap> {
  if (state.prevDraftLoaded && !force) return state.prevDraftMap!;
  state.prevDraftMap = {};
  state.prevDraftLoaded = true;
  const league = state.league;
  if (!league || !league.previous_league_id) {
    return state.prevDraftMap; // likely the league's first season
  }
  try {
    const prevLeagueId = league.previous_league_id;
    const prevLeague = await sleeper.league(prevLeagueId);
    if (!prevLeague || !prevLeague.draft_id) return state.prevDraftMap;

    // Everything below depends only on prevLeague, so it goes out in parallel
    // rather than as four serial round trips — this sits on the Rosters tab's
    // first paint (loadRosters awaits it before rendering), so the ordering is
    // user-visible. Each hop swallows its own failure: only `picks` is
    // essential, and the rest degrade to a narrower keeper verdict rather than
    // taking the whole map down with them.
    const [prevRosters, prevDraft, picks, seasonBeforeRosters] = await Promise.all([
      sleeper.rosters(prevLeagueId).catch(() => null),
      sleeper.draft(prevLeague.draft_id).catch(() => null),
      sleeper.draftPicks(prevLeague.draft_id),
      // The season BEFORE last, for the corroboration in buildPrevDraftMap. A
      // league in its second season simply has no such league, which must read
      // as "no inference", not as an error — hence its own catch and the
      // deliberate null rather than an empty array.
      prevLeague.previous_league_id
        ? sleeper.rosters(prevLeague.previous_league_id).catch(() => null)
        : Promise.resolve(null),
    ]);

    const prevRosterOwner: Record<string, string> = {};
    (prevRosters || []).forEach((r) => {
      if (r.owner_id) prevRosterOwner[String(r.roster_id)] = r.owner_id;
    });

    state.prevDraftMap = buildPrevDraftMap({
      picks,
      prevDraft,
      prevRosterOwner,
      rosteredOwnersByPlayer: rosteredOwnersFromRosters(seasonBeforeRosters),
      // The cap that governed the draft being read, which is not necessarily
      // this season's: state.rules.maxKeepers is user-editable up to 4 (which
      // would switch the cap off entirely) and, because this loader
      // short-circuits on prevDraftLoaded while Settings only re-renders,
      // reading it here would leave wasKeeper silently stale after an edit.
      maxKeepers: maxKeepersFromLeague(prevLeague.settings?.max_keepers) ?? state.rules.maxKeepers,
    });
  } catch {
    state.prevDraftMap = {};
  }
  return state.prevDraftMap;
}

// ---------- this season's draft (order + settings) ----------
// Also used to derive exact keeper pick numbers once the order is known — see
// domain/draftOrder.ts. Fetched once per session; failures leave state.draft
// null, which callers treat as "order not known" rather than throwing.
export async function ensureDraftOrderLoaded(force?: boolean): Promise<SleeperDraft | null> {
  if (state.draft && !force) return state.draft;
  state.draft = null;
  try {
    if (state.league && state.league.draft_id) {
      state.draft = await sleeper.draft(state.league.draft_id);
    }
  } catch {
    /* exact pick numbers unavailable; round-midpoint approximation used instead */
  }
  return state.draft;
}

// ---------- this season's locked keepers (Sleeper draft room) ----------
// Once the league's keeper deadline passes, the commissioner enters everyone's
// keepers into the draft room and they come back from the picks endpoint as
// is_keeper preassignments, while the draft is still 'pre_draft'. From that
// moment they outrank every in-app selection — see domain/lockedKeepers.ts for
// why their mere presence is the only available "deadline has passed" signal.
//
// A failure leaves the map null, which reads as "not locked yet" and falls back
// to in-app selections. That's the right way to fail: showing the picks people
// chose in the app is a far smaller wrong than showing a league with no keepers
// at all.
export async function ensureLockedKeepersLoaded(force?: boolean): Promise<void> {
  if (state.lockedKeepersLoaded && !force) return;
  state.lockedKeepersLoaded = true;
  state.lockedKeepers = null;
  try {
    if (state.league && state.league.draft_id) {
      const picks = await sleeper.draftPicks(state.league.draft_id);
      state.lockedKeepers = buildLockedKeepers(picks);
    }
  } catch {
    /* not locked as far as we can tell; in-app selections still drive the UI */
  }
}

// ---------- traded draft picks (this draft's season only) ----------
// Draft-scoped endpoint, not the league-wide one — the league-wide endpoint
// aggregates a league's entire multi-season trade history (confirmed live),
// while this one is already correctly scoped to just this draft's picks.
// Feeds keeper-cost resolution (a team's own round-N pick may have been
// traded away), not just board display — used from both loadRosters and
// loadBoard.
export async function ensureTradedPicksLoaded(force?: boolean): Promise<TradedPicksList> {
  if (state.tradedPicks && !force) return state.tradedPicks;
  state.tradedPicks = [];
  try {
    if (state.league && state.league.draft_id) {
      state.tradedPicks = await sleeper.tradedPicks(state.league.draft_id);
    }
  } catch {
    /* keeper costs fall back to capacity=1 everywhere, as if untraded */
  }
  return state.tradedPicks;
}

// ---------- draft round count ----------
// Last-resort round count when neither the draft's own settings nor the
// league's roster_positions can supply one. Shared by both readers below so
// they can't disagree about the same number.
const FALLBACK_DRAFT_ROUNDS = 15;

export async function ensureBoardRoundsLoaded(force?: boolean): Promise<number> {
  if (state.boardRounds && !force) return state.boardRounds;
  let rounds: number | null = null;
  try {
    const draft = await ensureDraftOrderLoaded(force);
    if (draft && draft.settings && draft.settings.rounds) {
      rounds = draft.settings.rounds;
    }
  } catch {
    /* fall through to estimate */
  }
  if (!rounds) rounds = roundsFromRosterPositions();
  state.boardRounds = rounds;
  return rounds;
}

function roundsFromRosterPositions(): number {
  return state.league && Array.isArray(state.league.roster_positions)
    ? state.league.roster_positions.length
    : FALLBACK_DRAFT_ROUNDS;
}

// Last round of the draft — keeper cost for players undrafted last year.
export function lastDraftRound(): number {
  return state.boardRounds || roundsFromRosterPositions();
}

// Does this player have real prior-season draft data?
export function hasPrevDraft(playerId: string): boolean {
  return !!(state.prevDraftMap && state.prevDraftMap[playerId]);
}

// re-export so callers have one data entrypoint
export { fetchJSON };
