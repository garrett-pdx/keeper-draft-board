# Keeper Draft Board

**Live demo:** https://garrett-pdx.github.io/keeper-draft-board/

A local, static web app for running a fantasy football **keeper draft** off the
[Sleeper](https://sleeper.com) API. Pull your league's rosters, pick your keepers, see a
computed keeper **value** metric, and lay it all out on a draggable draft board.

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

Then enter your **Sleeper username** to look up your leagues (or paste a league ID
directly — see "Or paste a league ID directly" on the setup screen) and a season.

### Scripts

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Start the Vite dev server                         |
| `npm run build`     | Type-check and build the static site into `dist/` |
| `npm run preview`   | Serve the production build locally                |
| `npm test`          | Run the Vitest unit tests                         |
| `npm run typecheck` | `tsc --noEmit`                                    |
| `npm run lint`      | ESLint                                            |
| `npm run format`    | Prettier (write)                                  |

## The four tabs

- **Rosters & Keepers** — one card per team, players grouped by position. Each player shows
  its keeper-cost round, a surplus-value badge, and a star toggle (max keepers/team is
  configurable — see Settings). Teams are sorted by best available keeper value;
  same-manager repeat keepers are flagged.
- **Draft List** — every draftable player sorted by ADP, with search + position filter.
  Keepers are greyed out and tagged with the keeping team.
- **Draft Board** — a grid, one column per team (drag or arrow-key the header to reorder,
  order persisted), one row per round. Keeper picks are placed at their cost round, tagged
  with the exact overall pick number once this season's draft order is known, with value +
  bumped-round warnings. Open cells flag rounds affected by a trade (`→ team` on the giving
  side, `+N incoming from team` on the receiving side). Players who can't be kept at all
  (see below) are excluded from the grid and listed in an alert underneath it.
- **Settings** — configurable league rules (max keepers per team, same-manager inflation
  rounds), with a one-click "Reset to Mudd League defaults" shortcut back to this app's
  original, calibrated rules.

## Keeper rules (configurable — defaults are the Mudd Keeper League's actual rules)

Encoded in `src/domain/` and covered by tests in `test/`:

- Each team keeps **up to N** players (default 2, adjustable 1–4 in Settings).
- A kept player costs the **round they were drafted last year**.
- If the **same manager** keeps the **same player** two years running, the cost climbs
  **N rounds** (default 1, adjustable in Settings), floored at round 1. Matched on the
  manager's stable `owner_id`, not `roster_id` (roster ids can change between seasons).
- A player kept by a **different** team last year does **not** inflate.
- **Undrafted last year** → cost = the **final round** of the draft.
- **Pick capacity, not a flat "1 slot per round."** A team's actual number of picks in a
  round defaults to 1 but is adjusted by traded picks — down for a pick traded away, up for
  one acquired. If more keepers want a round than the team has capacity for, the
  better-ranked keeper(s) bump toward round 1 (more expensive), cascading through rounds
  that are themselves over capacity. A keeper bumped past round 1 with no capacity left
  anywhere **cannot be kept at all** — a hard failure surfaced in the UI, not just a
  warning. When a team holds _more than one_ pick in a round, no bump happens as long as
  picks ≥ keepers wanting that round — the keeper(s) simply consume the worst (least
  valuable) of the held picks once the real draft order is known, leaving the better one
  open for the live draft.
- **Same-round collision / capacity tie-break** — the better-ranked player(s) bump toward
  round 1 first (more expensive), worst-ranked keeps the round. _This tie-break rule itself
  was chosen by us, not specified by the league, and is fixed (not configurable) — only how
  many keepers can collide changes with the max-keepers setting and any trades._

## The value metric

`surplus = pickValue(marketPick) − pickValue(costPick)`, where
`pickValue(pick) = 100 × 0.965^(pick−1)`.

- `marketPick` = the player's current ADP pick number.
- `costPick` = the keeper's **exact pick number**, once this season's real snake draft
  order has been set by the commissioner — otherwise the **midpoint pick** of the
  keeper's cost round, as a graceful fallback. A small badge next to the ADP source
  ("Pick #s · exact draft order") appears once the exact order is in use.
- Exponential decay weights early-round surplus more heavily. Tune `VALUE_DECAY` in
  `src/domain/value.ts`.
- Players with no current ADP get a sentinel value so they're never recommended, and
  render as a dashed "no ADP" badge.

## ADP data source (important caveat)

**Sleeper has no official public ADP endpoint.** ADP is derived from an _undocumented_
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
