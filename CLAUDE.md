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

- **Static, no backend.** All persistence is `localStorage`, with one deliberate
  exception: **keeper picks are shared league-wide via a GitHub Gist** (see "Shared
  keeper picks" below), because the whole point of that feature is for one manager's
  picks to show up on every other manager's device, which no localStorage-only design
  can do. That gist is the only thing this app ever writes to anywhere. Never introduce
  a server component beyond it, and never send data anywhere else except read-only GETs
  to Sleeper. The build output must be a static site. ADP is a second, read-only
  exception: it's fetched at **CI/build time** (never at runtime, never in the browser)
  from Fantasy Football Calculator and baked into a static asset — see "ADP data
  pipeline" below for why.
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
  fetch-outlooks.mjs  # CI-only Node script: pulls season-outlook paragraphs from
                      #   ESPN's public fantasy API, writes public/outlook-snapshot.json
                      #   (same workflow/cadence as ADP)
public/
  adp-snapshot.json      # generated, committed — served same-origin, matched at
                        #   runtime against Sleeper's player dictionary
  outlook-snapshot.json  # generated, committed — served same-origin, matched at
                        #   runtime against Sleeper's player dictionary via espn_id
src/
  main.ts             # bootstrap: tab switching + init() wiring
  state.ts            # the single `state` object, constants, localStorage persistence
  selectors.ts        # state-aware wrappers that feed the pure domain layer
  data.ts             # cache-aware "ensure*" loaders (honor a `force` flag)
  sync.ts             # stateful glue between api/gist.ts and `state` for shared
                      #   keeper picks — ensureSharedKeepersLoaded, saveMyKeepers,
                      #   startEditingMyKeepers/cancelEditingMyKeepers, clearMyKeepers
                      #   (see "Shared keeper picks")
  util.ts             # formatTime, displayNameFor, formatBirthDate, starSignFor
  types.ts            # shared data shapes + (loosely-typed) Sleeper payloads
  styles.css          # the dark "night game" theme (CSS custom properties in :root)
  api/
    sleeper.ts        # fetchJSON + endpoint helpers (each validates its response)
    adpSnapshot.ts    # fetchAdpSnapshot — reads public/adp-snapshot.json (same-origin)
    outlookSnapshot.ts # fetchOutlookSnapshot — reads public/outlook-snapshot.json (same-origin)
    gist.ts           # fetchSharedKeepers/writeSharedKeepers — the league's shared
                      #   keeper picks, read/written in a GitHub Gist (see below)
    schemas.ts        # zod schemas for Sleeper responses + our own ADP/outlook/keeper
                      #   snapshots
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
    outlook.ts        #   outlookFor — direct espn_id lookup (no fuzzy matching needed)
    keeperShare.ts    #   mergeSharedKeepers, withTeamKeepers, withoutTeamKeepers —
                      #   pure merge logic for the shared keeper doc (see below)
  ui/
    dom.ts            # $, $all, el, setSpin
    header.ts         # updateAdpSourceBadge, updatePickSourceBadge, updateIdentityBadge,
                      #   updateSyncBadge (visible data-source/identity/sync-status
                      #   indicators; each hidden until relevant)
    setup.ts          # setup screen: username→league picker (handleFindLeagues,
                      #   handleConfirmLeague, toggleManualEntry) + manual league-ID
                      #   fallback (handleLoadLeague), both routed through the shared
                      #   commitLeagueAndEnter(); enterApp, showSetupScreen
    rosters.ts        # loadRosters + renderRosters + renderTeamCard (tap-to-expand team
                      #   tiles and player rows; expanded player detail leads with an
                      #   outlook teaser, tappable to open the outlook drawer) + the
                      #   keeper lock/save/edit/withdraw controls (see below)
    outlookDrawer.ts  # openOutlookDrawer/closeOutlookDrawer — singleton bottom-sheet
                      #   drawer (built lazily, appended to document.body), dismissible by
                      #   pointer-drag swipe-down, scrim click, or Escape
    draft.ts          # loadDraft + renderDraft
    board.ts          # loadBoard + renderBoard (draggable grid)
    settings.ts       # renderSettings + wireSettingsEvents — league rules, the
                      #   signed-in-manager picker, and gist sharing config
test/                 # Vitest specs mirroring src/domain/
```

Layering: `ui/*` and `data.ts`/`sync.ts` read/write `state`; `selectors.ts` bridges
`state` into the pure `domain/*` functions; `domain/*` and `api/sleeper.ts`'s pure parts
import no state.

## The four tabs

- **Rosters & Keepers** (`#panel-rosters`): one condensed tile per team (avatar, team
  name, keeper count), tap to expand into the full roster. Within an expanded roster,
  players are grouped by position, each position group sorted by potential keeper value
  descending; tapping a player row expands it further into a detail panel led by a
  4-line-clamped season-outlook teaser (tap it to open the full text in a bottom drawer,
  swipe down/click the scrim/Escape to dismiss — see "Player outlook pipeline"), followed
  by the keeper-cost round, surplus-value, ADP range, birthdate/star sign, etc. Each
  player row also shows a keeper-cost round tag, a surplus-value badge, and a star toggle
  (max keepers/team per `state.rules.maxKeepers`, enforced). Teams are sorted by last
  season's final standings (hand-maintained list in `rosters.ts`); the defending champion
  gets a gold-tinted tile. Same-manager repeat keepers get an amber "inflated" highlight.
  If shared keeper sync is configured (see "Shared keeper picks"), only the signed-in
  manager's own team has interactive stars — every other team's stars are a read-only
  indicator — and a 🔒 badge plus a "Locked in for the league on {date}" note appears on
  any team that has saved. The signed-in manager's own card additionally shows
  Save & lock keepers / Edit keepers / Withdraw controls.
- **Draft List** (`#panel-draft`): every draftable player, sorted by ADP, with search +
  position filter. Keepers are greyed out and tagged with the keeping team.
- **Draft Board** (`#panel-board`): a grid, one column per team (drag-or-arrow-key headers
  to reorder, persisted; headers are keyboard-focusable and refocus themselves after a
  move since re-render rebuilds the table). Only keeper picks are filled in, placed at
  their cost round, tagged with the exact overall pick number once this season's draft
  order is known. Open cells show a traded-away/incoming-pick note (`→ {team}` /
  `+N incoming from {team}`) for rounds affected by a trade. Shows value + bumped-round
  warnings per cell; unkeepable players are excluded from the grid and listed in an
  alert below it. In `noKeeperCost` ("taxi squad") leagues, no keeper ever occupies a
  cell — every round stays fully open, and each team's kept players are listed instead
  in a summary panel above the grid.
- **Settings** (`#panel-settings`): configurable league rules (max keepers, inflation
  rounds, and a "no keeper cost / taxi squad" toggle) with a "Reset to Mudd League
  defaults" shortcut. Auto-saves per league on change; re-renders every currently-loaded
  tab so numbers update immediately. A second card covers league keeper sharing: which
  team is the signed-in manager's (a plain dropdown, since the manual league-ID setup
  path never learns a Sleeper user_id), and an optional Gist ID / write token override
  for pointing at a different shared list than the one baked in at build time (see
  "Shared keeper picks").

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
- **`state.rules.noKeeperCost` ("taxi squad" mode, default off)**: for leagues where keepers
  don't cost a draft pick at all. When on, every rule above about cost rounds, inflation,
  same-round collisions, capacity, and `cannotBeKept` is skipped entirely — see the
  `noKeeperCost` branch in `getRosterKeeperCosts` (`src/domain/keeperCost.ts`). Every
  `KeeperCostItem` comes back `taxiSquad: true` with no round spent. `maxKeepers` still
  applies (it's the taxi squad size cap, not a pick-cost concept). Value is still computed
  but against an infinite cost pick — `keeperSurplusValue(..., Infinity)` — which decays
  `pickValue` to 0, so surplus reduces to the player's full market value: purely "how good
  is this player," since there's no cost to weigh it against. The Draft Board
  (`src/ui/board.ts`) reflects this by leaving every round open (no keeper ever occupies a
  cell) and listing each team's taxi squad in a summary panel above the grid instead.

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
  missing from _every_ ranked entry falls through. Two other confirmed real-data
  quirks handled in `matchAdpToPlayers`: FFC uses `"PK"` where Sleeper uses `"K"`, and
  team defenses can't be name-matched at all (FFC: "Denver Defense"; Sleeper:
  first/last = city/nickname) so those are matched by team abbreviation instead.
  Ambiguous name+position collisions are skipped, not guessed at. If fewer than 20
  players end up matched across all entries, this falls back to Sleeper's overall
  player rank as a proxy (`state.adpSource === 'rank'`), same as before.

## Player outlook pipeline

Each roster card's expanded player detail leads with a short editorial "season outlook"
paragraph, tappable to open the full text in a bottom drawer. The source is ESPN's public
fantasy football API (the same `kona_player_info` view ESPN's own frontend calls,
`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/<year>/segments/0/
leaguedefaults/1?view=kona_player_info`) — **undocumented** (no official terms page for
it specifically), free, and requires **no API key or signup**. Two things make this a
meaningfully different case from the ADP source, worth calling out explicitly so a future
change doesn't assume the same constraints:

- **CORS is actually open here** (confirmed live: the endpoint reflects whatever `Origin`
  header the request sends, including on the preflight for the custom `X-Fantasy-Filter`
  header this endpoint requires) — unlike Fantasy Football Calculator, this endpoint
  _could_ be called directly from the browser at runtime. It's still fetched at CI time
  instead, same cadence as ADP, purely for performance/consistency (one static snapshot
  beats every page load hitting a third party we have no support relationship with) — not
  because of a CORS block.
- Matching against Sleeper's player dictionary is a **direct `espn_id` lookup**, not fuzzy
  name matching — Sleeper's own player objects carry an `espn_id` field (confirmed live:
  Josh Allen is Sleeper id `4984`, `espn_id: 3918298`, which is exactly ESPN's own id for
  him), so there's no ambiguity/normalization problem like FFC's name-keyed data has.

- `scripts/fetch-outlooks.mjs` fetches each offense-relevant position slot (QB/RB/WR/TE/
  DEF/K — ESPN's own `filterSlotIds`) and keeps only players with a non-empty
  `player.seasonOutlook`, writing `public/outlook-snapshot.json` keyed by `espnId`. Real
  coverage is skill-position-only in practice — defenses and kickers come back with zero
  written outlooks (confirmed live), so those positions simply show "No outlook available."
  rather than a broken lookup.
- `.github/workflows/refresh-adp.yml` runs this alongside the ADP fetch (same schedule, one
  combined commit) — deliberately combined into one workflow rather than a second scheduled
  job, to avoid two independent jobs racing to push to `main` around the same cron tick.
- At runtime, `ensureOutlookLoaded` (`src/data.ts`) fetches the snapshot same-origin and
  builds a flat `espnId -> outlook` map; `outlookFor` (`src/domain/outlook.ts`) does the
  actual per-player lookup against a Sleeper player's `espnId`. A player with no match (or
  when the whole fetch fails) just renders no outlook teaser — nothing else on the page
  depends on this data.
- Being undocumented, `scripts/fetch-outlooks.mjs` deliberately keeps request volume low
  (one request per position slot, twice weekly, ~300ms apart) rather than polling
  per-player — the same "good citizen" posture as the ADP fetcher.

## Shared keeper picks

Keeper picks are shared league-wide so one manager's saved picks show up, locked, on
every other manager's device — the one feature this app has that genuinely can't be
done with localStorage alone. It's built as a single JSON file living in a **GitHub
Gist**, read and written over plain `fetch()` — no server we run, but also the one
exception to "no backend" (see "Hard constraints" above).

**Why a Gist, and the security tradeoff.** A static site with no backend has no place to
put a write credential that isn't visible to whoever loads the page — there is no server
boundary to hide it behind. That's true of any "shared write" approach here, not just a
Gist. Given that, a Gist is the simplest thing that could work: no infra to run, a
free/generous tier, and GitHub's REST API already supports CORS for both reads and
authenticated writes (confirmed live), so no proxy is needed. The token is a **fine-grained
PAT scoped to Gists only, on an account with nothing else of value in it** — worst case if
it leaks is someone overwrites the keepers gist, which Gist revision history makes
recoverable rather than destructive. This is a considered, accepted tradeoff for a
private tool used by ~10 friends, not an oversight — don't "fix" it by trying to hide the
token harder (that's not possible in a static site) or by reaching for a real backend
without discussing it first.

**Setup is optional and layered**, so the app works identically to before this feature for
anyone who doesn't set it up:

- With no Gist ID configured anywhere, `canReadShared()` (`src/api/gist.ts`) is false and
  the app behaves exactly as it did when keepers were localStorage-only — every team's
  stars stay interactive, there's no lock concept, nothing changes.
- `VITE_KEEPER_GIST_ID` / `VITE_KEEPER_GIST_TOKEN` are baked in at build time from GitHub
  Actions (`vars.KEEPER_GIST_ID` / `secrets.KEEPER_GIST_TOKEN` in `.github/workflows/
deploy.yml`) — the normal path for the league's actual deployment.
- Either can be overridden per-browser from the Settings tab (`LS_GIST_ID`/`LS_GIST_TOKEN`
  in `src/api/gist.ts`), which also allows a **write-token-less, read-only** mode: paste
  just the Gist ID and you see everyone's locked picks but can't save your own
  (`canWriteShared()` false, "League sync · read-only" badge).

**Identity is honor-system, not authentication.** Sleeper has no OAuth for third-party
apps, so there's no way to cryptographically prove which manager is at the keyboard. The
signed-in manager's Sleeper `user_id` (`state.currentUserId`, `src/state.ts`) is learned
automatically from the setup screen's username lookup, or set by hand in Settings (the
manual league-ID path never learns a username). `myRosterId()` matches it against
`roster.owner_id`. The failure mode this accepts is a friend picking the wrong team from
the dropdown — acceptable for a private league, not something worth building real auth
for.

**Data shape and merge semantics** (`src/api/schemas.ts` `SharedKeepersSchema`,
`src/domain/keeperShare.ts`): one JSON file, `{ version: 1, leagues: { [leagueId]: {
[rosterId]: { playerIds, savedBy, savedByName, savedAt } } } }`, keyed by league so one
Gist can back more than one league. `mergeSharedKeepers` folds the fetched doc over this
browser's local `state.keepers` — **the shared doc wins for every team**, so a manager
always sees what was actually committed rather than a stale local guess, **except** the
roster currently being edited in this browser (`state.editingRosterId`), which stays local
until explicitly saved again — otherwise re-opening an already-locked team to change it
would get immediately stomped back to the old picks on the next background refresh.
`withTeamKeepers`/`withoutTeamKeepers` are non-mutating "replace one team's entry" /
"remove one team's entry" builders used when saving/withdrawing.

**Save is read-modify-write, not blind-write** (`saveMyKeepers` /
`clearMyKeepers`, `src/sync.ts`): each save re-fetches the live Gist immediately before
writing and only replaces the signed-in manager's own team's entry in that freshly-fetched
doc, so two managers saving around the same time can't clobber each other's picks — each
only ever touches their own key. This isn't full optimistic-concurrency-safe (a
same-second double-save on the _same_ team could still race), which is an accepted gap
for a 10-person league, not something to add locking for.

**Lock/edit/withdraw flow**: `canEditRoster(rosterId)` (`src/state.ts`) is the single
gate the UI checks before rendering an interactive star — true when sync is off
(everything editable, original behavior), or when this is your own roster and it isn't
locked (or it's locked but you're actively editing it). `toggleKeeper` re-checks the same
function as defense in depth, since it's an exported function callable outside the gated
UI path. "Save & lock keepers" calls `saveMyKeepers()`, which locks and publishes in one
step — there's no separate unlocked-and-shared state. "Edit keepers" sets
`editingRosterId` (session-only, not persisted) so the team's stars become interactive
again locally without touching the shared doc; "Cancel" reverts to the last-saved picks;
"Withdraw" removes the team's entry from the shared doc entirely via `clearMyKeepers()`.

**Offline/error handling degrades to last-known state, not "no lock info."** A failed
fetch (`state.syncStatus = 'error'`, "League sync · offline" badge) must not make a
locked team look editable again just because the network call failed — that would be
worse than doing nothing. `cacheSharedKeepersLocally`/`loadSharedKeepersCacheFromStorage`
(`src/state.ts`) mirror the last-fetched shared doc into `localStorage`
(`kdb_shared_keepers_<leagueId>`) so a reload while offline still shows every team's true
lock state from the last successful sync, not an empty/unlocked default.

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
