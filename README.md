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
- **Static.** Builds to a plain `dist/` you can host anywhere (e.g. GitHub Pages). A small
  optional Cloudflare Worker (`worker/`) proxies fantasy platforms whose APIs browsers
  can't call — it's stateless, stores nothing, and the app works without it for Sleeper.
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
| `npm run fetch-values`   | Refresh `public/value-snapshot.json` from FantasyCalc                 |

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
- **Draft List** — every draftable player sorted by market price, with search + position filter.
  Keepers are greyed out and tagged with the keeping team.
- **Draft Board** — a grid, one column per team (drag or arrow-key the header to reorder,
  order persisted), one row per round. Keeper picks are placed at their cost round, tagged
  with the exact overall pick number once this season's draft order is known, with value +
  bumped-round warnings. Open cells flag rounds affected by a trade (`→ team` on the giving
  side, `+N incoming from team` on the receiving side). Players who can't be kept at all
  (see below) are excluded from the grid and listed in an alert underneath it. In
  "no keeper cost" leagues no keeper ever occupies a cell — every round stays open and each
  team's kept players are listed in a summary panel above the grid instead. Also hosts a
  **mock draft** — see below.
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

## Mock draft

A local-only practice tool on the Draft Board — never expires, no time limit, never
touches the shared Gist. Hit **Start Mock Draft** and every non-keeper cell fills in real
snake order by a simple best-player-available AI, pausing the instant it's your turn with
a filterable player picker (same search + position filter as the Draft List). Pick, and it
resumes auto-drafting until your next turn, repeating until the draft's done. **Reset
Draft** clears it back to keepers-only so you can run it again.

The AI isn't purely ADP-blind, though — it respects a per-position cap derived from your
league's actual starting lineup (starting slots + FLEX/SUPER_FLEX eligibility + a small
bench buffer), so opponents stop hoarding a 6th QB or 3rd TE just because those positions
are running hot on ADP. A position with no FLEX home (QB outside superflex, TE) gets a
tight cap; RB/WR get real headroom from FLEX eligibility. Your own picks are never capped —
the picker always shows every available player, cap or no cap.

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

## Market price sources

The keeper metric needs one number per player: the pick at which the market prices him.
Two sources can supply that, and **they are not the same quantity** — pick which in
Settings (default: FantasyCalc).

| Source                          | What it measures                          | Notes                                                               |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| **FantasyCalc** (default)       | Trade value — _how good is this player_   | Steadier; matched by exact Sleeper id                               |
| **Fantasy Football Calculator** | Real ADP — _what does it cost to get him_ | Literally the keeper question, but can swing hard on a week of news |

FFC's ADP is the more directly relevant measure, but it's a rolling recent window and
reacts fast. A real example: Rashee Rice sat at ADP ~27 for three weeks, then ran to 12.7
in six days — while FantasyCalc still had him near 40. Neither source is simply right, so
the app ships both and **always labels which is in use** ("Value rank · FantasyCalc" vs
"ADP · Fantasy Football Calculator"); a value ranking is never presented as ADP.

Both snapshots are matched to your league's actual shape, and the Settings tab shows what
was detected (size, scoring, QB count, Sleeper's keeper cap) alongside **which entry it
selected** — so a number that looks wrong can be traced rather than guessed at.
FantasyCalc keeps a full matrix of team count × scoring × QB count; FFC's ADP varies only
by scoring, because its league-size parameter returns byte-identical data for every size.

Both are fetched **server-side at CI time** — neither API sends CORS headers a browser
will accept — by `scripts/fetch-fantasycalc.mjs` and `scripts/fetch-adp.mjs`, committed as
static snapshots under `public/`, and served same-origin. A scheduled workflow
(`.github/workflows/refresh-adp.yml`) refreshes them daily. Superflex leagues get their own
partition from both sources, since starting a second QB reprices the position completely.
If neither snapshot matches enough players, the app falls back to Sleeper's overall player
ranking and says so.

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
