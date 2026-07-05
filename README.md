# Keeper Draft Board

A local, static web app for running a fantasy football **keeper draft** off the
[Sleeper](https://sleeper.com) API. Pull your league's rosters, pick up to two keepers per
team, see a computed keeper **value** metric, and lay it all out on a draggable draft board.

- **No backend.** Everything runs in the browser. Your keeper picks are saved only in
  `localStorage` — nothing is uploaded anywhere. The only network calls are read-only GETs
  to Sleeper's public API (plus Google Fonts).
- **Static.** Builds to a plain `dist/` you can host anywhere (e.g. GitHub Pages).
- **Vanilla + typed.** Vite + TypeScript, vanilla DOM, near-zero runtime dependencies.

## Quick start

```bash
npm install
npm run dev        # dev server at http://localhost:5173
```

Then enter your **Sleeper league ID** (the number in your league URL,
`sleeper.com/leagues/<LEAGUE_ID>/team`) and a season.

### Scripts

| Command             | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | Start the Vite dev server                          |
| `npm run build`     | Type-check and build the static site into `dist/`  |
| `npm run preview`   | Serve the production build locally                 |
| `npm test`          | Run the Vitest unit tests                          |
| `npm run typecheck` | `tsc --noEmit`                                      |
| `npm run lint`      | ESLint                                             |
| `npm run format`    | Prettier (write)                                   |

## The three tabs

- **Rosters & Keepers** — one card per team, players grouped by position. Each player shows
  its keeper-cost round, a surplus-value badge, and a star toggle (max 2 keepers/team).
  Teams are sorted by best available keeper value; same-manager repeat keepers are flagged.
- **Draft List** — every draftable player sorted by ADP, with search + position filter.
  Keepers are greyed out and tagged with the keeping team.
- **Draft Board** — a grid, one draggable column per team (order persisted), one row per
  round. Keeper picks are placed at their cost round, with value + collision warnings.

## Keeper rules (this league)

Encoded in `src/domain/` and covered by tests in `test/`:

- Each team keeps **up to 2** players.
- A kept player costs the **round they were drafted last year**.
- If the **same manager** keeps the **same player** two years running, the cost climbs
  **one round** (floored at round 1). Matched on the manager's stable `owner_id`, not
  `roster_id` (roster ids can change between seasons).
- A player kept by a **different** team last year does **not** inflate.
- **Undrafted last year** → cost = the **final round** of the draft.
- **Same-round collision** (a team's two keepers land on the same round) → the
  better-ranked player bumps up one round. _This tie-break was chosen by us, not specified
  by the league — confirm before treating as final._

## The value metric

`surplus = pickValue(marketPick) − pickValue(costPick)`, where
`pickValue(pick) = 100 × 0.965^(pick−1)`.

- `marketPick` = the player's current ADP pick number.
- `costPick` = the midpoint pick of the keeper's cost round.
- Exponential decay weights early-round surplus more heavily. Tune `VALUE_DECAY` in
  `src/domain/value.ts`.
- Players with no current ADP get a sentinel value so they're never recommended, and
  render as a dashed "no ADP" badge.

## ADP data source (important caveat)

**Sleeper has no official public ADP endpoint.** ADP is derived from an *undocumented*
projections endpoint (`/projections/nfl/<season>/<week>`), reading a dropoff-adjusted PPR
field — directionally reasonable, but not a true consensus ADP. If fewer than 20 players
resolve, the app falls back to Sleeper's overall player ranking as a proxy and says so in
the UI. See `HANDOFF.md` for detail.

## Project layout

See `CLAUDE.md` for the module map and contributor conventions. In short: pure,
state-free, unit-tested logic lives in `src/domain/`; `src/ui/` renders it; `src/state.ts`
holds the single source of truth; `src/api/sleeper.ts` is the only place that talks to the
network.

## License

MIT — see [LICENSE](LICENSE).
