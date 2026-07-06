# CLAUDE.md — Keeper Draft Board

Context and conventions for working on this project. Read this first.

## What this is

A **local, static, no-backend web app** for running a fantasy football keeper draft off
the Sleeper API. It is built with **Vite + TypeScript**, vanilla DOM (no UI framework),
and ships as a static site (deployable to GitHub Pages). `npm run dev` to develop,
`npm run build` to produce a static `dist/`.

The user's league is on **Sleeper** (10-team keeper league). The app pulls rosters and
last season's draft results live from Sleeper's public read-only API, plus a real ADP
snapshot refreshed twice weekly (see "ADP data pipeline" below), lets the user pick
keepers, computes a keeper "value" metric, and renders a draggable draft board.

> History: this started as a single self-contained `keeper-draft-board.html`. It was
> migrated to the modular Vite/TS structure below (the pure logic extracted and covered
> by tests) without changing behavior or the Sleeper endpoints used.

## Hard constraints (do not break these)

- **Static, no backend.** All persistence is `localStorage`. Never introduce a server
  component, and never send the user's data anywhere except read-only GETs to Sleeper.
  The build output must be a static site. The one exception is ADP: it's fetched at
  **CI/build time** (never at runtime, never in the browser) from Fantasy Football
  Calculator and baked into a static asset — see "ADP data pipeline" below for why.
- **Keep runtime dependencies near-zero.** Dev tooling (Vite, Vitest, ESLint, Prettier,
  TypeScript) is welcome; think hard before adding a _runtime_ dependency — prefer writing
  it by hand. The only external runtime requests are Google Fonts and the Sleeper API (ADP
  is same-origin at runtime — see below). The one sanctioned runtime dep is **zod**, used
  only to validate Sleeper responses and our own generated ADP snapshot at the fetch
  boundary (`src/api/schemas.ts`). Don't reach for more without a similarly strong reason.
- **Vanilla DOM, no UI framework.** Build DOM with the local `el(tag, attrs, ...children)`
  helper (`src/ui/dom.ts`), not innerHTML string concatenation (except the deliberate
  `html:` escape hatch in `el`). Keep using `el`.
- **Keep domain logic pure and state-free.** Everything in `src/domain/` must be a pure
  function of its arguments (no `state`, no DOM, no `localStorage`) so it stays testable.
  Bridge global state to the domain via `src/selectors.ts`.

## Architecture (modules)

```
index.html            # markup only (setup screen + app shell); loads src/main.ts
scripts/
  fetch-adp.mjs       # CI-only Node script: pulls real ADP from Fantasy Football
                      #   Calculator, writes public/adp-snapshot.json (run by
                      #   .github/workflows/refresh-adp.yml, Mon + Fri)
public/
  adp-snapshot.json   # generated, committed — served same-origin, matched at
                      #   runtime against Sleeper's player dictionary
src/
  main.ts             # bootstrap: tab switching + init() wiring
  state.ts            # the single `state` object, constants, localStorage persistence
  selectors.ts        # state-aware wrappers that feed the pure domain layer
  data.ts             # cache-aware "ensure*" loaders (honor a `force` flag)
  util.ts             # formatTime, displayNameFor
  types.ts            # shared data shapes + (loosely-typed) Sleeper payloads
  styles.css          # the dark "night game" theme (CSS custom properties in :root)
  api/
    sleeper.ts        # fetchJSON + endpoint helpers (each validates its response)
    adpSnapshot.ts    # fetchAdpSnapshot — reads public/adp-snapshot.json (same-origin)
    schemas.ts        # zod schemas for Sleeper responses + our own ADP snapshot
  domain/             # PURE, state-free, unit-tested:
    value.ts          #   pickValue, marketPickFor, keeperSurplusValue, VALUE_DECAY
                      #   (keeperSurplusValue takes an optional exact pick number that
                      #   overrides the round-midpoint approximation when known)
    keeperCost.ts     #   sameManagerLastYear, potentialKeeperCost, isInflatedForRoster,
                      #   getRosterKeeperCosts (capacity-aware assignment: same-round
                      #   collisions AND traded-away/acquired picks, cascading toward
                      #   round 1, cannotBeKept on exhaustion)
    draftOrder.ts     #   hasKnownDraftOrder, slotForRoster, exactPickNumber,
                      #   exactPickForRoster — snake-draft exact pick number math
    tradedPicks.ts    #   pickCapacity, heldPickOriginalOwners — how many picks a team
                      #   actually holds per round, adjusted by trades
    adp.ts            #   normalizePlayerName, matchAdpToPlayers (name/position/team
                      #   matching against Sleeper's player dict, entries tried in
                      #   priority order so a player missing from one format can still
                      #   match from another), rankAdpEntries (snapshot entries ranked
                      #   by closest team-count + scoring-format for this league)
  ui/
    dom.ts            # $, $all, el, setSpin
    header.ts         # updateAdpSourceBadge, updatePickSourceBadge (visible data-source
                      #   indicators; the pick badge is hidden until an exact order is known)
    setup.ts          # setup screen: username→league picker (handleFindLeagues,
                      #   handleConfirmLeague, toggleManualEntry) + manual league-ID
                      #   fallback (handleLoadLeague), both routed through the shared
                      #   commitLeagueAndEnter(); enterApp, showSetupScreen
    rosters.ts        # loadRosters + renderRosters + renderTeamCard
    draft.ts          # loadDraft + renderDraft
    board.ts          # loadBoard + renderBoard (draggable grid)
    settings.ts       # renderSettings + wireSettingsEvents — the Settings tab
test/                 # Vitest specs mirroring src/domain/
```

Layering: `ui/*` and `data.ts` read/write `state`; `selectors.ts` bridges `state` into the
pure `domain/*` functions; `domain/*` and `api/sleeper.ts`'s pure parts import no state.

## The four tabs

- **Rosters & Keepers** (`#panel-rosters`): one card per team, players grouped by
  position, each position group sorted by potential keeper value descending. Each player
  shows a keeper-cost round tag, a surplus-value badge, and a star toggle (max
  keepers/team per `state.rules.maxKeepers`, enforced). Teams are sorted by their best
  available keeper value, descending. Same-manager repeat keepers get an amber
  "inflated" highlight.
- **Draft List** (`#panel-draft`): every draftable player, sorted by ADP, with search +
  position filter. Keepers are greyed out and tagged with the keeping team.
- **Draft Board** (`#panel-board`): a grid, one column per team (drag-or-arrow-key headers
  to reorder, persisted; headers are keyboard-focusable and refocus themselves after a
  move since re-render rebuilds the table). Only keeper picks are filled in, placed at
  their cost round, tagged with the exact overall pick number once this season's draft
  order is known. Open cells show a traded-away/incoming-pick note (`→ {team}` /
  `+N incoming from {team}`) for rounds affected by a trade. Shows value + bumped-round
  warnings per cell; unkeepable players are excluded from the grid and listed in an
  alert below it.
- **Settings** (`#panel-settings`): configurable league rules (max keepers, inflation
  rounds) with a "Reset to Mudd League defaults" shortcut. Auto-saves per league on
  change; re-renders every currently-loaded tab so numbers update immediately.

## Domain rules (configurable per-league; defaults are the Mudd Keeper League's actual

## rules, since this app is built primarily for that league — see `DEFAULT_LEAGUE_RULES`)

- Each team keeps **up to `state.rules.maxKeepers`** players (default 2, UI-capped 1–4).
- A kept player costs the **round they were drafted last year**.
- If the **same manager** keeps the **same player** two years running, the cost climbs
  **`state.rules.inflationRounds`** (default 1), floored at round 1. Matched on `owner_id`
  (user_id), NOT roster_id — roster_ids can shift between seasons. See `sameManagerLastYear`.
- A player kept by a _different_ team last year does NOT inflate.
- **Undrafted last year** → cost = the **final round** of the draft (`lastDraftRound()`).
- **Pick capacity, not a flat "1 slot per round."** A team's actual number of picks in a
  round defaults to 1 but is adjusted by traded picks (`src/domain/tradedPicks.ts`:
  `pickCapacity`) — down for a pick traded away, up for one acquired. If more keepers want
  a round than the team has capacity for (including zero, i.e. their own pick was traded
  away with nothing acquired), the better-ranked keeper(s) are displaced **toward round 1
  (more expensive)**, cascading through rounds that are themselves over capacity, using the
  same rank-based tie-break either way (see below). **A keeper displaced past round 1 with
  no capacity left anywhere cannot be kept at all** — `KeeperCostItem.cannotBeKept`, a hard
  failure surfaced in the UI (not just a warning). When a team holds _more than one_ pick in
  a round, no bump happens at all as long as picks ≥ keepers wanting that round — the
  keeper(s) simply consume the worst (least valuable) of the held picks once the real draft
  order is known (`consumedPick`), leaving the better one open for the live draft.
- **Same-round collision / capacity tie-break**: the better-ranked player(s) bump toward
  round 1 first (more expensive), worst-ranked keeps the round. NOTE: this tie-break rule
  was _not_ specified by the league and was chosen by us — the rule itself is fixed (not
  user-configurable), only the _capacity per round_ (affected by `maxKeepers` and trades)
  changes how many keepers can collide.

## ADP data pipeline

Real ADP was investigated thoroughly (see git history) — Sleeper has no official ADP
endpoint, and every free real-ADP source we found (Fantasy Football Calculator, MyFantasy­
League) sends no CORS headers a browser will accept from this app's origin (confirmed
live: direct `fetch()` calls fail with `net::ERR_FAILED`). Paid sources (FantasyPros)
were ruled out — no paid API keys in a static, no-backend app with no way to keep them
secret. So real ADP can only be fetched **server-side, at CI/build time**, never at
runtime:

- `scripts/fetch-adp.mjs` pulls a small matrix (`teams` × `8,10,12,14`, `format` ×
  `standard,half-ppr,ppr`) from Fantasy Football Calculator's public REST API (free for
  personal/commercial use, attribution requested — see the footer credit in `index.html`)
  and writes `public/adp-snapshot.json`.
- `.github/workflows/refresh-adp.yml` runs it on a schedule (Monday + Friday) and
  `workflow_dispatch`, committing the snapshot to `main` if it changed — which then
  triggers the normal `deploy.yml` (any push to `main`) to rebuild and redeploy.
- At runtime, `ensureAdpLoaded` (`src/data.ts`) fetches this snapshot same-origin (no
  CORS problem — it's our own static asset), ranks this league's entries via
  `rankAdpEntries` (nearest team count, then nearest scoring format from the league's
  `scoring_settings.rec`), and matches FFC's name-keyed players against Sleeper's
  id-keyed player dictionary via `matchAdpToPlayers`, which tries the ranked entries in
  priority order. **A lower-sample format can genuinely omit real players present in
  another** — confirmed live: FFC's half-ppr set (394 drafts) is missing ~38 players,
  including Alvin Kamara and Puka Nacua, that are present in its ppr set (995 drafts)
  for the same league size. So a player missing from the closest-format entry still
  gets matched from the next-closest one rather than showing "no ADP" — only a player
  missing from *every* ranked entry falls through. Two other confirmed real-data
  quirks handled in `matchAdpToPlayers`: FFC uses `"PK"` where Sleeper uses `"K"`, and
  team defenses can't be name-matched at all (FFC: "Denver Defense"; Sleeper:
  first/last = city/nickname) so those are matched by team abbreviation instead.
  Ambiguous name+position collisions are skipped, not guessed at. If fewer than 20
  players end up matched across all entries, this falls back to Sleeper's overall
  player rank as a proxy (`state.adpSource === 'rank'`), same as before.

## The value metric

`surplus = pickValue(marketPick) − pickValue(costPick)` where
`pickValue(pick) = 100 × VALUE_DECAY^(pick−1)`, `VALUE_DECAY = 0.965`.

- `marketPick` = the player's current ADP pick number (real resolution).
- `costPick` = the keeper's **exact overall pick number**, when this season's real snake
  draft order is known (`hasKnownDraftOrder`/`exactPickForRoster` in
  `src/domain/draftOrder.ts`); otherwise the **round midpoint** approximation
  (`round×teams − teams/2`). The exact-order signal is `draft_order !== null` on the
  Sleeper draft object — `slot_to_roster_id` alone is not sufficient, since Sleeper
  populates it with a default identity placeholder before the commissioner actually sets
  the order. This must always degrade gracefully to the midpoint approximation, never
  silently produce a wrong number.
- Exponential decay chosen deliberately so early-round surplus outweighs late-round
  surplus. **Tune `VALUE_DECAY` in one place** — the top of `src/domain/value.ts`.
- Players with no current ADP → `NO_ADP_VALUE` (−99), so they never get recommended and
  render as a dashed "no ADP" badge.

## Coding conventions

- Prettier + ESLint enforce style (2-space indent, semicolons, single quotes). Run
  `npm run format` / `npm run lint`. `const`/`let`, never `var`.
- Functions are small and single-purpose. Keep the "ensure*" loaders idempotent and
  cache-aware; they all honor the `force` flag.
- Comments explain _why_, not _what_. Keep the domain-rule comments accurate if you
  change the math — they're the spec.
- When adding UI, reuse the CSS custom properties and existing badge/tag classes rather
  than introducing new colors.

## Testing

Pure logic in `src/domain/` is covered by Vitest specs in `test/`. Run `npm test` (or
`npm run test:watch`). If you change keeper math, update/extend the matching spec so the
documented rules stay enforced. Before pushing, the full gate is: `npm run lint`,
`npm run typecheck`, `npm test`, `npm run build` — the same steps CI runs.
