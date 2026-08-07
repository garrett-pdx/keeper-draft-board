# Keeper Draft Board

**Live demo:** https://garrett-pdx.github.io/keeper-draft-board/

A local, static web app for running a fantasy football **keeper draft** off the
[Sleeper](https://sleeper.com) API. Pull your league's rosters, pick your keepers, see a
computed keeper **value** metric, and lay it all out on a draggable draft board.

- **No server to run.** Everything runs in the browser. Settings and draft-board layout
  live in `localStorage`; the only network calls are read-only GETs to Sleeper's public
  API (plus Google Fonts).
- **Keeper picks are shared league-wide**, so one manager's saved picks show up locked on
  everyone else's device. That needs somewhere shared to put them, so it's the one thing
  this app writes anywhere — a single GitHub Gist. It's **optional**: build without a Gist
  configured and the app is purely local, exactly as it was before the feature existed.
  See [Shared keeper picks](#shared-keeper-picks).
- **Static.** Builds to a plain `dist/` you can host anywhere (e.g. GitHub Pages).
- **Vanilla + typed.** Vite + TypeScript, vanilla DOM, near-zero runtime dependencies
  (just `zod`, to validate everything at the fetch boundary).

## Quick start

```bash
npm install
npm run dev        # dev server at http://localhost:5173
```

Then enter your **Sleeper username** to look up your leagues (or paste a league ID
directly — see "Or paste a league ID directly" on the setup screen) and a season.

### Scripts

| Command                  | What it does                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| `npm run dev`            | Start the Vite dev server                                             |
| `npm run build`          | Type-check and build the static site into `dist/`                     |
| `npm run preview`        | Serve the production build locally                                    |
| `npm test`               | Run the Vitest unit tests                                             |
| `npm run typecheck`      | `tsc --noEmit`                                                        |
| `npm run lint`           | ESLint                                                                |
| `npm run format`         | Prettier (write)                                                      |
| `npm run fetch-adp`      | Refresh `public/adp-snapshot.json` from Fantasy Football Calculator   |
| `npm run fetch-outlooks` | Refresh `public/outlook-snapshot.json` from ESPN's public fantasy API |

Before pushing, the full gate is what CI runs: `npm run lint`, `npm run typecheck`,
`npm test`, `npm run build`.

## The four tabs

- **Rosters & Keepers** — one condensed tile per team; tap to expand into the full roster,
  and tap a player for a detail panel led by a season-outlook teaser (tap that for the full
  text in a bottom drawer). Each player shows its keeper-cost round, a surplus-value badge,
  and a star toggle (max keepers/team is configurable — see Settings). Teams are sorted by
  last season's finish, the defending champion gets a gold tile, and same-manager repeat
  keepers are flagged. With keeper sharing on, only **your** team's stars are interactive —
  every other team's are a read-only indicator, with a 🔒 on any team that has locked in.
- **Draft List** — every draftable player sorted by ADP, with search + position filter.
  Keepers are greyed out and tagged with the keeping team.
- **Draft Board** — a grid, one column per team (drag or arrow-key the header to reorder,
  order persisted), one row per round. Keeper picks are placed at their cost round, tagged
  with the exact overall pick number once this season's draft order is known, with value +
  bumped-round warnings. Open cells flag rounds affected by a trade (`→ team` on the giving
  side, `+N incoming from team` on the receiving side). Players who can't be kept at all
  (see below) are excluded from the grid and listed in an alert underneath it. In
  "no keeper cost" leagues no keeper ever occupies a cell — every round stays open and each
  team's kept players are listed in a summary panel above the grid instead.
- **Settings** — configurable league rules (max keepers per team, same-manager inflation
  rounds, and a "no keeper cost / taxi squad" toggle), with a one-click "Reset to Mudd
  League defaults" shortcut back to this app's original, calibrated rules. When Sleeper's
  own settings disagree with what's set here, it says so and offers a one-click "Use
  Sleeper's settings" — see [League settings import](#league-settings-import).

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
- **"No keeper cost" (taxi squad) mode**, off by default. For leagues where keepers don't
  cost a draft pick at all: every rule above about cost rounds, inflation, collisions and
  capacity is skipped entirely, and value becomes simply "how good is this player" since
  there's no cost to weigh it against. Max keepers still applies as the squad-size cap.

## League settings import

Sleeper already knows some of what this app asks you for, so the **first** time you load a
league its rules are seeded from Sleeper's own config. Only `settings.max_keepers` is
derived — confirmed across three real leagues (2, 2, and 1, where this app's default is 2,
so the third was simply wrong before).

Two deliberate limits: it only seeds a league you've **never configured here** (silently
overwriting a commissioner's deliberate choice because Sleeper disagrees would be worse
than being out of date — when they differ, Settings shows a hint and a button instead), and
the taxi-squad toggle is **never** inferred from Sleeper's `taxi_slots`, which is a dynasty
rookie-stash concept unrelated to this app's "keepers cost no pick" rule despite the shared
nickname. Inflation rounds have no Sleeper equivalent at all. Both stay manual.

## Shared keeper picks

Keeper picks are shared league-wide so one manager's saved picks show up, locked, on every
other manager's device — the one thing here that genuinely can't be done with
`localStorage` alone. It's a single JSON file in a **GitHub Gist**, read and written over
plain `fetch()`.

Pick your team once (learned automatically from the username you looked up, or chosen from
a prompt on the Rosters tab), star your keepers, and hit **Save & lock keepers**. Everyone
else sees them locked, with who saved them and when. You can **Edit** or **Withdraw** your
own at any time. The page polls every 60s while visible, so the board keeps up with the
league without anyone hitting Refresh.

**Setup is build-time and optional.** `VITE_KEEPER_GIST_ID` / `VITE_KEEPER_GIST_TOKEN` come
from GitHub Actions (`vars.KEEPER_GIST_ID` / `secrets.KEEPER_GIST_TOKEN`); for local dev put
them in a gitignored `.env.local`. With no Gist ID configured the feature is simply off. A
Gist ID with no token is a supported **read-only** mode.

> **Security, stated plainly.** A static site with no backend has nowhere to hide a write
> credential — the token ships in the public JS bundle, and anyone who opens devtools can
> read it. Use a fine-grained PAT scoped to **gists only**, on an account with nothing else
> of value. Worst case someone overwrites the keepers gist, which Gist revision history
> makes recoverable. That's an accepted tradeoff for a private tool used by ~10 friends,
> not an oversight. There is deliberately **no in-app field for the token** — a token box
> invites pasting credentials into a page that already ships one.

Identity is **honor-system**: Sleeper has no OAuth for third-party apps, so there's no way
to prove who's at the keyboard. Someone could pick the wrong team. Fine for a private
league; don't grow this into something public without real auth.

Two failure modes are handled deliberately rather than left to chance. Writes are
read-modify-write-**verify** with bounded, jittered retries — the Gist API has no
compare-and-swap, so a client that gets overwritten by a simultaneous save notices on
read-back and re-applies its change, converging with both managers' picks intact. And an
**expired token degrades to read-only instead of taking the league down**: reads drop the
rejected credential and retry unauthenticated, so everyone still sees the locked-in picks
and only saving stops, with the UI naming who to contact.

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

## ADP data source

Real, crowd-sourced ADP comes from [Fantasy Football
Calculator](https://fantasyfootballcalculator.com) — Sleeper has no official ADP
endpoint (verified by GraphQL introspection: 240 query fields, none of them ADP), and
every free real-ADP API we could find (including FFC's) sends no CORS headers, so it
can't be called live from a browser. Instead, a scheduled GitHub Actions workflow
(`.github/workflows/refresh-adp.yml`, **daily**) runs `scripts/fetch-adp.mjs`
server-side and commits a static snapshot (`public/adp-snapshot.json`) that the app
fetches same-origin and matches against Sleeper's player dictionary by name (see
`src/domain/adp.ts`). If fewer than 20 players match for your league's format, the app
falls back to Sleeper's overall player ranking as a proxy and says so in the UI.

**Superflex / 2QB is a separate market, not a variant.** The snapshot carries FFC's `2qb`
set alongside the 1QB formats, and a league draws from one or the other — never a blend.
Starting a second QB reprices the position entirely (Josh Allen: **25.6** in half-PPR,
**1.4** in 2QB), so a mispriced fallback would be worse than showing nothing. Detection
accepts either an explicit `SUPER_FLEX` slot **or** two or more `QB` starters — both are
real, and a `SUPER_FLEX`-only check silently misses true 2QB leagues.

**The snapshot has no team-count dimension**, because FFC's `teams` parameter doesn't do
anything: all four formats return byte-identical players, ADPs, highs, lows and draft
counts for `teams=8/10/12/14` (verified live). It used to be fetched as a format × team
matrix, which made 16 entries of which 12 were exact duplicates and the downloaded asset
4× larger than it needed to be. If FFC ever starts segmenting by league size, restore the
loop in `scripts/fetch-adp.mjs` and take the team count back as an argument in
`rankAdpEntries`; the schema still tolerates a `teams` field so older snapshots keep
validating.

Player **season outlooks** come from ESPN's public fantasy API on the same daily schedule
(`scripts/fetch-outlooks.mjs` → `public/outlook-snapshot.json`), matched by Sleeper's own
`espn_id` field, so there's no fuzzy name-matching involved. Coverage is
skill-positions-only in practice; anyone without one just shows no teaser.

## Project layout

See `CLAUDE.md` for the module map and contributor conventions. In short: pure,
state-free, unit-tested logic lives in `src/domain/` (keeper cost, value, ADP matching,
snake-draft math, shared-keeper merges, league settings); `src/ui/` renders it;
`src/state.ts` holds the single source of truth; `src/sync.ts` is the stateful glue for
shared keepers; and `src/api/` is the only place that talks to the network — `sleeper.ts`
for Sleeper, `adpSnapshot.ts`/`outlookSnapshot.ts` for the same-origin static assets, and
`gist.ts` for the shared keeper list.

## License

MIT — see [LICENSE](LICENSE).
