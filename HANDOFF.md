# HANDOFF.md — Keeper Draft Board

Status of the project at handoff, what's known-good, what's risky, and what to do next.
Pair this with `CLAUDE.md` (conventions) and the source `keeper-draft-board.html`.

## Current state: working, feature-complete for v1

All requested features are built and syntax-clean:

- Setup screen takes a Sleeper league ID + season, validates against the API, remembers
  it in localStorage, auto-resumes on reload.
- **Rosters & Keepers** tab: roster cards, keeper toggles (2 max, enforced), keeper-cost
  round tags, surplus-value badges, best-two-candidates outline, same-manager "inflated"
  highlight, teams sorted by best keeper value.
- **Draft List** tab: ADP-sorted board, search + position filter, keepers greyed out.
- **Draft Board** tab: draggable team columns (order persisted), round rows, keepers
  placed at cost round, per-cell value + collision warnings.
- Every tab has a Refresh button + "last updated" timestamp + loading state. Refresh does
  a genuine fresh API pull (force-busts caches).

The user's real league ID for testing: **1312235880743706624**.

## Biggest risk: ADP data source (READ THIS FIRST)

**Sleeper has no official, documented public ADP endpoint.** The app derives ADP from the
undocumented projections endpoint:

```
https://api.sleeper.app/projections/nfl/<season>/<week>?season_type=regular&position[]=...
```

`extractAdp()` scans each player's stats object for an ADP-like field. The field that
actually exists there is **`adp_dd_ppr`** (and `pos_adp_dd_ppr`) — a _dropoff-adjusted PPR
ADP_ projection, confirmed via the `sleeper-go` type definitions. This is NOT a true
consensus/market ADP; it's Sleeper's own projected value metric. Implications:

- The numbers are directionally reasonable but may not match what a manager sees as "ADP"
  in the Sleeper draft UI.
- If the endpoint returns fewer than 20 ADP-bearing players, the app **silently falls
  back** to Sleeper's `search_rank` (overall player rank) as an ADP proxy, and labels this
  in the note above the roster grid (`state.adpSource === 'rank'`).

**Action for next agent:** verify against the live API with the real league what
`projections/nfl/2026/1` actually returns for `adp_dd_ppr` coverage. If it's thin or
absent for 2026, consider:

1. The `players/nfl/research/regular/<season>/<week>` endpoint (ownership/roster %, not
   ADP, but another signal), or
2. Pulling ADP from an actual mock-draft ADP source, or
3. Making the ADP source explicit/user-selectable rather than silent fallback.
   Whatever you choose, keep the `adpSource` labeling honest in the UI.

## Fixed during review (was a latent bug)

**Cross-season "same team" matching now uses `owner_id`, not `roster_id`.** Sleeper
roster_ids are not guaranteed stable between seasons, so the original
`prev.rosterId === rosterId` check could silently fail to detect a same-manager repeat
keeper (breaking the cost-inflation rule). `ensurePrevDraftLoaded` now also fetches the
previous league's rosters to map `prev roster_id → owner user_id`, and
`sameManagerLastYear()` compares stable owner ids (falling back to raw roster_id only if
owner ids are unavailable). Verify this against the real league — it's correct in theory
but hasn't been checked against live two-season data.

## Known limitations / open questions

1. **`is_keeper` dependency.** Cost inflation only fires if last season's draft picks have
   `is_keeper: true` set. Some leagues add keepers in a way that doesn't populate this
   field. If inflation doesn't show where the user expects, this is the likely cause.
   Confirm with the user's actual 2025 draft data.
2. **Collision tie-break is an assumption.** When two keepers share a cost round, the
   better-ranked one bumps up. The league never specified which player bumps — confirm.
3. **Draft List capped at 400 rows** for DOM performance (`renderDraft` slice). Deep
   sleepers past 400 are reachable only via search. Fine for now; revisit if needed.
4. **Draft round count** comes from the prior draft's settings via
   `ensureBoardRoundsLoaded`, falling back to `roster_positions.length` then a hardcoded 14. Confirm the real draft is 14 rounds; the "undrafted → last round" rule depends on it.
5. **No handling for co-owned or orphan (unowned) teams** beyond showing "Unclaimed team".
6. **Values recompute on every render** — cheap at this scale (10 teams) but not memoized.

## How this was verified

No in-file test harness. Pure functions were extracted to Node scripts and asserted:

- **Keeper cost rules** (straight pick, 2nd consecutive keep bumps a round, round-1 floor,
  different-team no-bump, undrafted → null-then-last-round): all pass.
- **Surplus value** (elite-cheap = big +, deep steal = small +, undrafted-but-has-ADP =
  big +, no-ADP = −99, overpriced keeper = negative, collision bump reduces value): all pass.
- **Inflation detection** (same-team repeat keeper, straight pick, different team, round-1,
  no prev data): all pass.
- **Curve comparison** (exp decay at several constants vs Jimmy-Johnson power vs log
  decline) — drove the `VALUE_DECAY = 0.965` choice. Exp decay preserves the early-round
  premium the user wanted while keeping late rounds non-zero.

Recommended: add a small `?test` mode or a separate `test.mjs` that imports the pure
functions, so this is repeatable rather than throwaway.

## Suggested next steps (priority order)

1. **Validate ADP live** against league 1312235880743706624 for season 2026 (see risk
   section). This is the single most important verification.
2. **Validate the owner_id cross-season fix and `is_keeper`** against the real 2025→2026
   data — confirm inflation highlights appear on the right players.
3. Confirm the two league-rule assumptions with the user (collision tie-break, 14 rounds).
4. Extract pure functions into a testable module / add a repeatable test path.
5. Consider an explicit ADP-source selector instead of silent rank fallback.
6. Nice-to-haves: export/print the draft board, per-position value tiers (VORP-style,
   since value dropoff is position-dependent), an "optimal keeper pair" auto-suggestion
   that accounts for collisions rather than just top-2 by individual value.

## API endpoints in use (all public, read-only, no auth)

```
GET /v1/league/<id>                         league meta (season, previous_league_id, draft_id)
GET /v1/league/<id>/users                   team names, owner_ids, avatars
GET /v1/league/<id>/rosters                 players per team, owner_id
GET /v1/players/nfl                          ~5MB player dictionary (cached ~20h)
GET /v1/draft/<draft_id>                     draft settings (rounds)
GET /v1/draft/<draft_id>/picks               last season's picks (round, roster_id, is_keeper)
GET /projections/nfl/<season>/<week>?...     ADP proxy (adp_dd_ppr) — UNDOCUMENTED, see risk
```

Rate limit: stay under ~1000 calls/min (Sleeper guidance). The app is nowhere near this;
the players dictionary is the only heavy call and is cached.
