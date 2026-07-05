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
    keeperCost.ts     #   sameManagerLastYear, potentialKeeperCost, isInflatedForRoster,
                      #   getRosterKeeperCosts (collision handling)
    adp.ts            #   extractAdp
  ui/
    dom.ts            # $, $all, el, setSpin
    header.ts         # updateAdpSourceBadge (visible ADP-source indicator)
    setup.ts          # setup screen: handleLoadLeague, enterApp, showSetupScreen
    rosters.ts        # loadRosters + renderRosters + renderTeamCard
    draft.ts          # loadDraft + renderDraft
    board.ts          # loadBoard + renderBoard (draggable grid)
test/                 # Vitest specs mirroring src/domain/
```

Layering: `ui/*` and `data.ts` read/write `state`; `selectors.ts` bridges `state` into the
pure `domain/*` functions; `domain/*` and `api/sleeper.ts`'s pure parts import no state.

## The three tabs

- **Rosters & Keepers** (`#panel-rosters`): one card per team, players grouped by
  position. Each player shows a keeper-cost round tag, a surplus-value badge, and a
  star toggle (max 2 keepers/team, enforced). Teams are sorted by their best available
  keeper value, descending. Same-manager repeat keepers get an amber "inflated" highlight.
- **Draft List** (`#panel-draft`): every draftable player, sorted by ADP, with search +
  position filter. Keepers are greyed out and tagged with the keeping team.
- **Draft Board** (`#panel-board`): a grid, one column per team (drag headers to reorder,
  persisted), one row per round. Only keeper picks are filled in, placed at their cost
  round. Shows value + collision warnings per cell.

## Domain rules (this league's keeper rules — encoded in the math functions)

- Each team keeps **up to 2** players.
- A kept player costs the **round they were drafted last year**.
- If the **same manager** keeps the **same player** two years running, the cost climbs
  **one round** (round 3 → round 2), floored at round 1. Matched on `owner_id` (user_id),
  NOT roster_id — roster_ids can shift between seasons. See `sameManagerLastYear`.
- A player kept by a *different* team last year does NOT inflate.
- **Undrafted last year** → cost = the **final round** of the draft (`lastDraftRound()`).
- **Same-round collision** (two keepers land on the same cost round): the better-ranked
  player bumps up one round. NOTE: this tie-break rule was *not* specified by the league
  and was chosen by us. Confirm with the user before treating it as final.

## The value metric

`surplus = pickValue(marketPick) − pickValue(costPick)` where
`pickValue(pick) = 100 × VALUE_DECAY^(pick−1)`, `VALUE_DECAY = 0.965`.

- `marketPick` = the player's current ADP pick number (real resolution).
- `costPick` = midpoint pick of the keeper's cost round (`round×teams − teams/2`).
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
