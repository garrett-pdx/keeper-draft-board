# CLAUDE.md — Keeper Draft Board

Context and conventions for working on this project. Read this first.

## What this is

A **local, static, no-backend web app** for running a fantasy football keeper draft off
the Sleeper API. It is built with **Vite + TypeScript**, vanilla DOM (no UI framework),
and ships as a static site (deployable to GitHub Pages). `npm run dev` to develop,
`npm run build` to produce a static `dist/`.

The user's league is on **Sleeper** (10-team keeper league). The app pulls rosters, ADP,
and last season's draft results live from Sleeper's public read-only API, lets the user
pick keepers, computes a keeper "value" metric, and renders a draggable draft board.

> History: this started as a single self-contained `keeper-draft-board.html`. It was
> migrated to the modular Vite/TS structure below (the pure logic extracted and covered
> by tests) without changing behavior or the Sleeper endpoints used.

## Hard constraints (do not break these)

- **Static, no backend.** All persistence is `localStorage`. Never introduce a server
  component, and never send the user's data anywhere except read-only GETs to Sleeper.
  The build output must be a static site.
- **Keep runtime dependencies near-zero.** Dev tooling (Vite, Vitest, ESLint, Prettier,
  TypeScript) is welcome; think hard before adding a *runtime* dependency — prefer writing
  it by hand. The only external runtime requests are Google Fonts and the Sleeper API.
  The one sanctioned runtime dep is **zod**, used only to validate Sleeper responses at the
  fetch boundary (`src/api/schemas.ts`). Don't reach for more without a similarly strong reason.
- **Vanilla DOM, no UI framework.** Build DOM with the local `el(tag, attrs, ...children)`
  helper (`src/ui/dom.ts`), not innerHTML string concatenation (except the deliberate
  `html:` escape hatch in `el`). Keep using `el`.
- **Keep domain logic pure and state-free.** Everything in `src/domain/` must be a pure
  function of its arguments (no `state`, no DOM, no `localStorage`) so it stays testable.
  Bridge global state to the domain via `src/selectors.ts`.

## Architecture (modules)

```
index.html            # markup only (setup screen + app shell); loads src/main.ts
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
    schemas.ts        # zod schemas for Sleeper responses; inferred payload types
  domain/             # PURE, state-free, unit-tested:
    value.ts          #   pickValue, marketPickFor, keeperSurplusValue, VALUE_DECAY
                      #   (keeperSurplusValue takes an optional exact pick number that
                      #   overrides the round-midpoint approximation when known)
    keeperCost.ts     #   sameManagerLastYear, potentialKeeperCost, isInflatedForRoster,
                      #   getRosterKeeperCosts (N-way collision handling)
    draftOrder.ts     #   hasKnownDraftOrder, slotForRoster, exactPickNumber,
                      #   exactPickForRoster — snake-draft exact pick number math
    adp.ts            #   extractAdp
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
- **Draft Board** (`#panel-board`): a grid, one column per team (drag headers to reorder,
  persisted), one row per round. Only keeper picks are filled in, placed at their cost
  round. Shows value + collision warnings per cell.
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
- A player kept by a *different* team last year does NOT inflate.
- **Undrafted last year** → cost = the **final round** of the draft (`lastDraftRound()`).
- **Same-round collision** (two or more keepers land on the same cost round): the
  better-ranked player(s) bump up a round each, cascading if that creates a new collision
  one round up; the worst-ranked keeper in the group keeps the round. If a bump chain hits
  round 1 while still colliding, it's marked `unresolvedCollision` rather than going
  negative. NOTE: this tie-break rule was *not* specified by the league and was chosen by
  us — the rule itself is fixed (not user-configurable), only the *number of keepers* that
  can collide is affected by `maxKeepers`.

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
  surplus (see HANDOFF.md for the curve comparison that led here). **Tune `VALUE_DECAY`
  in one place** — the top of `src/domain/value.ts`.
- Players with no current ADP → `NO_ADP_VALUE` (−99), so they never get recommended and
  render as a dashed "no ADP" badge.

## Coding conventions

- Prettier + ESLint enforce style (2-space indent, semicolons, single quotes). Run
  `npm run format` / `npm run lint`. `const`/`let`, never `var`.
- Functions are small and single-purpose. Keep the "ensure*" loaders idempotent and
  cache-aware; they all honor the `force` flag.
- Comments explain *why*, not *what*. Keep the domain-rule comments accurate if you
  change the math — they're the spec.
- When adding UI, reuse the CSS custom properties and existing badge/tag classes rather
  than introducing new colors.

## Testing

Pure logic in `src/domain/` is covered by Vitest specs in `test/`. Run `npm test` (or
`npm run test:watch`). If you change keeper math, update/extend the matching spec so the
documented rules stay enforced. Before pushing, the full gate is: `npm run lint`,
`npm run typecheck`, `npm test`, `npm run build` — the same steps CI runs.
