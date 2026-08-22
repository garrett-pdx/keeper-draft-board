# CLAUDE.md — Keeper Draft Board

Context and conventions for working on this project. Read this first.

## What this is

A **local, static, no-backend web app** for running a fantasy football keeper draft off
the Sleeper API. It is built with **Vite + TypeScript**, vanilla DOM (no UI framework),
and ships as a static site (deployable to GitHub Pages). `npm run dev` to develop,
`npm run build` to produce a static `dist/`.

The user's league is on **Sleeper** (10-team keeper league). The app pulls rosters and
last season's draft results live from Sleeper's public read-only API, plus a real ADP
snapshot refreshed daily (see "ADP data pipeline" below), lets the user pick
keepers, computes a keeper "value" metric, and renders a draggable draft board.

> History: this started as a single self-contained `keeper-draft-board.html`. It was
> migrated to the modular Vite/TS structure below (the pure logic extracted and covered
> by tests) without changing behavior or the Sleeper endpoints used.

## Hard constraints (do not break these)

- **Static front end; one tiny stateless backend.** The site itself still builds to a
  plain `dist/` and all user state lives in `localStorage`, with two deliberate
  exceptions:
  1. **Keeper picks are shared league-wide via a GitHub Gist** (see "Shared keeper picks"),
     because the whole point is for one manager's picks to appear on every other manager's
     device, which no localStorage-only design can do.
  2. **A Cloudflare Worker proxies fantasy platforms whose APIs a browser cannot call**
     (see "Backend (Cloudflare Worker)"). This was previously forbidden outright; the
     constraint was revised deliberately, because CORS — not authentication — is what
     blocks every platform except Sleeper, and CORS can only be bypassed server-side.
     The Worker is **stateless**: no database, no user data at rest, no business logic. Keep
     it that way. Domain logic belongs in `src/domain/`, where it's pure and tested. ADP is a
     third, read-only exception: it's fetched at **CI/build time** (never at runtime, never in
     the browser) from Fantasy Football Calculator and baked into a static asset — see "ADP
     data pipeline" below for why.
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
  fetch-adp.mjs       # CI-only Node script: pulls mock-draft ADP from Fantasy
                      #   Football Calculator, writes public/adp-snapshot.json (run by
                      #   .github/workflows/refresh-adp.yml, daily)
  fetch-mfl-adp.mjs   # CI-only Node script: pulls real (non-mock) redraft ADP from
                      #   MyFantasyLeague, writes public/adp-real-snapshot.json
                      #   (same workflow/cadence; no QBs — see "The MFL real-draft source")
  fetch-fantasycalc.mjs # CI-only Node script: pulls FantasyCalc player values,
                      #   writes public/value-snapshot.json (same workflow/cadence)
  fetch-outlooks.mjs  # CI-only Node script: pulls season-outlook paragraphs from
                      #   ESPN's public fantasy API, writes public/outlook-snapshot.json
                      #   (same workflow/cadence as ADP)
public/
  adp-snapshot.json      # generated, committed — served same-origin, matched at
                        #   runtime against Sleeper's player dictionary
  adp-real-snapshot.json # generated, committed — same shape, MyFantasyLeague real drafts
  value-snapshot.json    # generated, committed — FantasyCalc values keyed by Sleeper id
  outlook-snapshot.json  # generated, committed — served same-origin, matched at
                        #   runtime against Sleeper's player dictionary via espn_id
src/
  main.ts             # bootstrap: tab switching + init() wiring
  state.ts            # the single `state` object, constants, localStorage persistence
  selectors.ts        # state-aware wrappers that feed the pure domain layer —
                      #   including allKeeperIdsWithTeam, which lives here rather
                      #   than in state.ts because "is this player really kept"
                      #   needs the domain layer's cannotBeKept verdict; also
                      #   mockDraftRoundWeights/mockDraftDoubleUpAllowedFor,
                      #   which gate Mudd's draft-tendency tables behind a
                      #   manager-handle quorum (see "Mock draft")
  data.ts             # cache-aware "ensure*" loaders (honor a `force` flag)
  refresh.ts          # cross-tab refresh coordination — isTabStale/TAB_STALE_MS
                      #   and refreshAll (rosters first and force-loaded, the
                      #   other two ride its warm cache); takes its loaders as
                      #   arguments so the ordering rules are testable DOM-free
  sync.ts             # stateful glue between api/gist.ts and `state` for shared
                      #   keeper picks — refreshSharedKeepers, saveMyKeepers,
                      #   clearMyKeepers, startEditingMyKeepers/cancelEditing…,
                      #   commitSharedChange (retry/verify), and the background
                      #   poll (start/stopSharedKeeperPolling)
                      #   (see "Shared keeper picks")
  mockDraft.ts        # stateful glue for the Draft Board's mock draft —
                      #   startMockDraft, advance, makeUserPick, resetMockDraft,
                      #   resumeMockDraft, plus frozenSlotOrder — the board
                      #   column order, snapshotted at Start as the pick
                      #   sequence (see "Mock draft"). Local-only; never
                      #   touches the shared Gist. The only module that imports
                      #   both domain/mockDraft.ts and ui/board.ts/
                      #   ui/mockDraftPicker.ts.
  util.ts             # formatTime, displayNameFor, formatBirthDate, starSignFor
  types.ts            # shared data shapes + (loosely-typed) Sleeper payloads
  styles.css          # the dark "night game" theme (CSS custom properties in :root)
  api/
    sleeper.ts        # fetchJSON + endpoint helpers (each validates its response)
    adpSnapshot.ts    # fetchAdpSnapshot / fetchRealAdpSnapshot — read
                      #   public/adp-snapshot.json (FFC mock-draft ADP) and
                      #   public/adp-real-snapshot.json (MFL real-draft ADP),
                      #   both same-origin
    outlookSnapshot.ts # fetchOutlookSnapshot — reads public/outlook-snapshot.json (same-origin)
    gist.ts           # fetchSharedKeepers/writeSharedKeepers — the league's shared
                      #   keeper picks, read/written in a GitHub Gist (see below)
    valueSnapshot.ts  # fetchValueSnapshot — reads public/value-snapshot.json
                      #   (same-origin); backs the DEFAULT market source, see
                      #   "Market value sources"
    schemas.ts        # zod schemas for Sleeper responses + our own ADP/value/
                      #   outlook/keeper snapshots
  domain/             # PURE, state-free, unit-tested:
    value.ts          #   pickValue, marketPickFor, keeperSurplusValue, VALUE_DECAY
                      #   (keeperSurplusValue takes an optional exact pick number that
                      #   overrides the round-midpoint approximation when known)
    lockedKeepers.ts  #   buildLockedKeepers, keepersAreLocked, lockedKeeperCosts —
                      #   THIS season's keepers as entered in Sleeper's draft
                      #   room, which outrank every in-app selection once they
                      #   exist (see "Locked keepers")
    prevKeepers.ts    #   buildPrevDraftMap — which of LAST season's picks were
                      #   actually kept (is_keeper + a corroborated trade-slot
                      #   inference, capped per roster); rosteredOwnersFromRosters
                      #   — see "Detecting last season's keepers"
    keeperCost.ts     #   sameManagerLastYear, potentialKeeperCost, isInflatedForRoster,
                      #   getRosterKeeperCosts (capacity-aware assignment: same-round
                      #   collisions AND traded-away/acquired picks, cascading toward
                      #   round 1, cannotBeKept on exhaustion)
    draftOrder.ts     #   hasKnownDraftOrder, slotForRoster, exactPickNumber,
                      #   exactPickForRoster — snake-draft exact pick number math;
                      #   orderRosterIdsBySlot — real slot order else given order,
                      #   the board's default column arrangement and a mock
                      #   draft's fallback pick sequence; reconcileOrder — merge
                      #   a saved arrangement with the ids that exist now (shared
                      #   by ensureBoardOrder and frozenSlotOrder);
                      #   pickWasAcquiredViaTrade — was a pick made from a slot
                      #   other than the roster's own, i.e. acquired by trade.
                      #   A NECESSARY, not sufficient, condition for the keepers
                      #   Sleeper's is_keeper flag misses — see prevKeepers.ts
    tradedPicks.ts    #   pickCapacity, heldPickOriginalOwners — how many picks a team
                      #   actually holds per round, adjusted by trades; pickHolder —
                      #   who drafts at a given seat's pick, the inverse view that
                      #   lets the mock draft run a bought pick at the seller's
                      #   position (see "Mock draft")
    mockDraft.ts      #   buildMockDraftSlots (flattens the whole draft into one
                      #   seat-ordered pick sequence), bestAvailablePlayer
                      #   (plain BPA-by-ADP; now only the sampler's zero-weight
                      #   fallback — see draftAi.ts for the AI's actual pick);
                      #   the three AI pool filters — filterByRemainingNeeds
                      #   (DEF/K last + the late-round starter safety net),
                      #   positionCaps/mockDraftCaps/filterByPositionCaps
                      #   (per-position limits), filterBenchQbTe (no bench QB/TE
                      #   until starters are fillable, with an optional
                      #   per-manager doubleUpAllowed exemption); plus their
                      #   supporting unfilledStartingSlots and
                      #   dedicatedStarterCounts — see "Mock draft"
    draftAi.ts        #   seededRoll (stateless, reload-safe pseudo-random
                      #   [0,1) draw keyed on (seed, ...key) — see "Mock
                      #   draft" for why it must never become a stateful
                      #   generator), samplePlayer (weighted sampling over the
                      #   top few available players by market rank — the AI's
                      #   actual pick, replacing plain best-player-available)
    draftTendencies.ts #   real Mudd league draft-history data, hand-transcribed
                      #   from docs/draft-tendencies-2023-2025.md —
                      #   MUDD_ROUND_BANDS/positionWeightsForRound (round-by-round
                      #   positional lean), MUDD_QBTE_PROFILES/qbTeDoubleUpOdds
                      #   (per-manager 2nd-QB/2nd-TE tendency), hasTendencyQuorum
                      #   (manager-handle match, no league-id anywhere) — see
                      #   "Mock draft"
    adp.ts            #   normalizePlayerName, matchAdpToPlayers (name/position/team
                      #   matching against Sleeper's player dict, entries tried in
                      #   priority order so a player missing from one format can still
                      #   match from another), rankAdpEntries (snapshot entries ranked
                      #   by closest team-count + scoring-format for this league)
    outlook.ts        #   outlookFor — id lookup, Sleeper id first then ESPN id
                      #   (no fuzzy matching); sleeperKey/espnKey namespace the
                      #   two so a Sleeper id can't collide with an equal ESPN
                      #   one — see "Player outlook pipeline"
    marketValue.ts    #   pickValueEntry, describeValueEntry, matchValueToPlayers —
                      #   FantasyCalc value ranks as implied market picks;
                      #   blendMarketMaps — the per-player mean across sources
                      #   backing 'blend' (see "Market value sources")
    leagueSettings.ts #   isSuperflexLeague, maxKeepersFromLeague,
                      #   suggestedRulesFromLeague, initialRulesForLeague — reading
                      #   a Sleeper league's own config (see "League settings import");
                      #   SLOT_ELIGIBILITY (which positions each roster_positions
                      #   slot can start) plus startablePositions /
                      #   positionFilterSlots / slotStartsPosition, which drive both
                      #   the mock draft's caps and the Draft List's position filter
    keeperShare.ts    #   mergeSharedKeepers, withTeamKeepers, withoutTeamKeepers,
                      #   samePicks, lockedTeamsFor — pure merge logic for the
                      #   shared keeper doc (see below)
  ui/
    dom.ts            # $, $all, el, setSpin
    tabs.ts           # switchTab + the per-tab lazy/stale load routing (uses
                      #   refresh.ts's isTabStale)
    header.ts         # updateAdpSourceBadge, updatePickSourceBadge, updateIdentityBadge,
                      #   updateSyncBadge (visible data-source/identity/sync-status
                      #   indicators; each hidden until relevant — updateSyncBadge
                      #   shows NOTHING while sync is healthy, only when it needs
                      #   attention). Labels are kept short on purpose — see
                      #   "Market value sources"
    marketSourceMenu.ts # wire/open/closeMarketSourceMenu — the anchored popover
                      #   the market-source badge opens, letting the source be
                      #   switched from any tab; applies via settings.ts's
                      #   applyMarketSource
    setup.ts          # setup screen: username→league picker (handleFindLeagues,
                      #   handleConfirmLeague, toggleManualEntry) + manual league-ID
                      #   fallback (handleLoadLeague), both routed through the shared
                      #   commitLeagueAndEnter(); enterApp, showSetupScreen
    rosters.ts        # loadRosters + renderRosters + renderTeamCard (tap-to-expand team
                      #   tiles and player rows; expanded player detail leads with an
                      #   outlook teaser, tappable to open the outlook drawer)
    keeperControls.ts # the only part of the rosters tab that WRITES to the league:
                      #   renderClaimTeamPrompt ("which team is yours?") and
                      #   renderKeeperActions (save/lock/edit/withdraw). Takes an
                      #   onChange callback so it never imports rosters.ts back.
    overlay.ts        # showBusy/hideBusy — blocking "working on it" modal, used only
                      #   for deliberate actions (save, withdraw, tapped Refresh)
    outlookDrawer.ts  # openOutlookDrawer/closeOutlookDrawer — singleton bottom-sheet
                      #   drawer (built lazily, appended to document.body), dismissible by
                      #   pointer-drag swipe-down, scrim click, or Escape
    draft.ts          # loadDraft + renderDraft
    positionFilter.ts # syncPositionFilterOptions — rebuilds a position <select>
                      #   from the league's own roster_positions. Shared by the
                      #   Draft List and the mock draft picker, so neither has to
                      #   import the other.
    board.ts          # loadBoard + renderBoard (grid, draggable only until the
                      #   real draft order is known — see isBoardOrderLocked;
                      #   also renders
                      #   mock-drafted cells, the pending-turn highlight, and
                      #   the Start/Reset controls — see "Mock draft")
    mockDraftPicker.ts # openMockDraftPicker/closeMockDraftPicker — singleton
                      #   bottom-sheet player picker for the mock draft, built
                      #   the same way as outlookDrawer.ts but actionable
                      #   (tap-to-draft rows) rather than read-only
    settings.ts       # renderSettings + wireSettingsEvents — league rules only
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
  Save & lock keepers / Edit keepers / Withdraw controls. When sync is on but this
  browser hasn't been claimed by a manager yet, a "Which team is yours?" card sits above
  the grid — that choice gates the whole tab (until it's answered nobody can select a
  keeper), which is exactly why it lives here and not in Settings. The header identity
  badge re-opens it to switch teams.
- **Draft List** (`#panel-draft`): every draftable player, sorted by ADP, with search +
  position filter + a "Hide kept players" toggle. Keepers are greyed out and tagged with
  the keeping team by default; the toggle removes them from the list entirely. **"Kept"
  here means _resolved_ keepers only** — `allKeeperIdsWithTeam` (`selectors.ts`) reads
  `getRosterKeeperCostsFor` and skips `cannotBeKept` items rather than reading the raw
  `state.keepers` selection. A selection that failed capacity resolution never occupies a
  pick and really will be in the draft pool, so tagging it KEPT (and hiding it under the
  toggle) told the manager a player was gone when the Board, two tabs over, was
  simultaneously listing him as unkeepable. Reachable with no trades at all: two keepers
  both costing round 1 is enough. Mock-draft picks deliberately do **not** count as kept
  here — this tab describes the real draft, the simulation lives on the Board.
  **Both the list and its position filter are scoped to what this league actually starts**
  (`startablePositions` / `positionFilterSlots` in `domain/leagueSettings.ts`): a league
  with no `K` slot shows no kickers and offers no K filter, since those players could
  never be started. The filter's option _values are slot names, not positions_ — which is
  what gives it a **FLEX** entry for free, since `SLOT_ELIGIBILITY` maps `QB → ['QB']` and
  `FLEX → ['RB','WR','TE']` alike and `slotStartsPosition` matches either with one lookup.
  Selecting FLEX therefore shows every player eligible for that league's flex spots. An
  unknown lineup filters nothing and falls back to the old fixed option list.
- **Draft Board** (`#panel-board`): a grid, one column per team. **Column order is only
  editable until Sleeper publishes the real one, and only while no mock draft is running.**
  Before that, headers are
  drag-or-arrow-key reorderable and the arrangement persists (headers are
  keyboard-focusable and refocus themselves after a move, since re-render rebuilds the
  table) — and that arrangement is not cosmetic: it is the order a mock draft will run in
  (see below). Once `hasKnownDraftOrder` is true (`isBoardOrderLocked` in `state.ts`) the
  columns _are_ the draft, left to right: every reorder affordance is dropped — no drag
  handle, no `draggable`, no `role="button"`/`tabindex` claiming interactivity that isn't
  there — and `ensureBoardOrder` **discards** any saved manual arrangement, clearing the
  `kdb_board_order_custom_*` flag so it can't come back if the commissioner later un-sets
  the order. A hand-dragged order that outlived the real one made the board look
  authoritative while being wrong, which is worse than one merely arranged inconveniently
  (issue #1). **The same affordances are dropped, by the same `reorderable` branch, while
  `state.mockDraft` exists** — that simulation froze this arrangement as its pick sequence,
  so rearranging now would leave the grid showing an order the simulation isn't running in.
  Reset Draft to rearrange. Deliberately not handled by extending `mockDraftMismatch()`:
  with the drag blocked there is nothing left to detect, and forcing a reset over an
  accidental drag would discard 100+ picks. Only keeper picks are filled in, placed at
  their cost round, tagged with the exact overall pick number once this season's draft
  order is known. Open cells show a traded-away/incoming-pick note (`→ {team}` /
  `+N incoming from {team}`) for rounds affected by a trade. Shows value + bumped-round
  warnings per cell; unkeepable players are excluded from the grid and listed in an
  alert below it. In `noKeeperCost` ("taxi squad") leagues, no keeper ever occupies a
  cell — every round stays fully open, and each team's kept players are listed instead
  in a summary panel above the grid. Also hosts the **mock draft** — see below.
- **Settings** (`#panel-settings`): configurable league rules (max keepers, inflation
  rounds, and a "no keeper cost / taxi squad" toggle) with a "Reset to Mudd League
  defaults" shortcut. Auto-saves per league on change; re-renders every currently-loaded
  tab so numbers update immediately. Shows a hint offering Sleeper's own settings when
  they differ from what's set here (see "League settings import"). Deliberately nothing
  about keeper sharing lives here — see "Shared keeper picks" for why there's no in-app
  gist/token field and where the team claim went.

## Mock draft

A local-only practice simulation layered onto the Draft Board (`src/mockDraft.ts`,
`src/domain/mockDraft.ts`, `src/domain/draftAi.ts`, `src/domain/draftTendencies.ts`,
`src/ui/mockDraftPicker.ts`) — never touches the shared Gist, never expires, no countdown
timer anywhere. Click **Start Mock Draft**: every non-keeper cell gets auto-filled in real
snake order by an AI that weighted-samples from the top few available players by market rank
(respecting a per-position cap and, for the Mudd league specifically, this league's own
observed positional tendencies — see below) until it reaches the signed-in manager's own next
pick, where it pauses and opens a filterable player-picker drawer (search + position filter,
identical semantics to the Draft List tab). Picking resumes auto-play through the next AI
streak, repeating until the draft completes.
**Reset Draft** (behind a `window.confirm`, the one deliberate exception to this app's
normal no-confirm convention, since it can discard 100+ picks with no undo) clears it back
to keepers-only.

- **Simulates at SEAT granularity — one entry per literal pick, ordered by the seat that
  pick belongs to rather than by the roster holding it.** Each roster id in the frozen
  order is a seat, meaning "this roster's own pick in this round"; `pickHolder`
  (`domain/tradedPicks.ts`) says who actually drafts it. So a team that bought a pick
  drafts it **where the seller would have picked**, with everyone in between picking
  first — matching what the board has always drawn, since the `+N incoming from {team}`
  note sits in the _seller's_ round cell. The whole sequence is built once, by
  `buildMockDraftSlots`, at Start.
  **This replaced a round×roster CELL granularity that gave such a roster consecutive
  picks** (`pickCapacity - keepersInCell` slots emitted back-to-back), documented at the
  time as an acceptable simplification because the board renders cells rather than a flat
  pick list. It wasn't: a manager holding two picks four seats apart got them back-to-back,
  which contradicts the grid on screen and teaches the wrong thing about who survives the
  gap. Don't reintroduce it.
  Keepers spend a holder's **latest** seats in the round, leaving its earlier picks live —
  deliberately the same rule `attachConsumedPicks` (`domain/keeperCost.ts`) uses to decide
  which literal pick a keeper consumed, so the board and the simulation can't disagree
  about which of two held picks is still open. `pickHolder` and `pickCapacity` are
  consistent by construction (a roster's capacity is exactly the number of seats
  `pickHolder` names it for), and a test pins that.
- **The pick order comes from `state.boardOrder`, resolved once at Start and frozen.**
  Before Sleeper publishes a real draft order, the board's columns _are_ the only order
  that exists, so a manager dragging themselves from 3rd to 5th is choosing the slot they
  want to practice from. Deriving the sequence from `state.draft` alone ignored that
  entirely — `orderRosterIdsBySlot` returns its input unchanged pre-order, so every mock
  draft ran in flat roster_id order no matter what the board showed (issue #3).
  `frozenSlotOrder` (`src/mockDraft.ts`) now prefers `state.boardOrder`, reconciled via
  `reconcileOrder` against `orderRosterIdsBySlot` as the fallback, and snapshots the
  _result_ into `state.mockDraft.slotOrderRosterIds`.
  **Two things keep that safe, and neither is "ignore boardOrder".** First, it is resolved
  exactly once and never read live, so a later Refresh All or the commissioner finally
  setting the real order mid-simulation can't perturb picks already made. Second, the
  board refuses to reorder columns at all while `state.mockDraft` exists (see the Draft
  Board tab above), so the grid can never display an order the simulation isn't running
  in. Note there is no conflict once the real order _is_ known: the board is un-draggable
  then and `ensureBoardOrder` pins `boardOrder` to `orderRosterIdsBySlot`, so both sources
  already agree.
- **Three AI-only pool filters, plus a weighted sample, applied in order.** The manager's own
  turn always sees the full, unfiltered player list in the picker — every one of these is an
  AI-realism heuristic, never a restriction on what the user may draft. Each filter falls back
  to the pool it was handed if it comes back empty, since a pick has to happen either way, and
  each degrades to no restriction when `roster_positions` is unknown rather than guessing.
  1. **Remaining needs (`filterByRemainingNeeds`) — reserves a roster's last picks for what
     it still has to have**, in two tiers.
     The outer tier is the DEF/K rule: a defense or kicker taken mid-draft is a wasted pick
     (near-interchangeable, and the pool barely thins), so they're held out until they're all
     a roster has left to take.
     The inner tier is the **starter safety net**. The bench gate below holds back a team's
     _second_ QB/TE but nothing compels the first, so a team riding best-available on RB/WR
     could finish unable to field a lineup — measured, one team in ten ended with no tight
     end at all. Once remaining picks are down to what's needed to complete the lineup, only
     players who fill a still-open slot are eligible. Confirmed to fix it: after the net, zero
     teams finish without a QB or a TE, while the first _bench_ pick still lands in rounds
     8-10, so the middle of the draft is genuinely untouched.
     DEF/K is checked **first**, so "defense and kicker go last" survives even when a team is
     short a starter at the same time. The open positions come from `positionsThatFillASlot`,
     which probes `unfilledStartingSlots` rather than reimplementing slot matching — it cannot
     drift from it. `remainingPicks` comes from `selectors.mockDraftRemainingPicksFor`, which
     counts that roster's own unfilled slots in the frozen slot list, so it stays right for a
     team whose trades left it holding more or fewer picks than its neighbours. Runs **first**
     in the pipeline: once it narrows the pool, the other two (no-ops on those positions)
     can't widen it again.
  2. **Position cap (`positionCaps`/`filterByPositionCaps`, via `mockDraftCaps`).** Real
     analysis of an actual mock draft on this app (see git history) showed plain BPA spirals
     AI teams into hoarding a 6th QB or 3rd TE the moment those positions run hot. The base
     cap is every starting slot a position is eligible for (exact slots plus whichever
     FLEX/SUPER_FLEX/WRRB_FLEX/REC_FLEX-type slots include it) plus a fixed bench buffer (2),
     which gives RB/WR real headroom from FLEX eligibility. **`mockDraftCaps` then overrides
     QB and TE to twice what the league genuinely starts there**, because the FLEX credit is
     far too loose as a draft limit — it puts the TE cap at 6 in a 1-TE/3-FLEX league, enough
     to finish with five backups. Twice the dedicated starts gives 2 QB / 2 TE in that
     league and 4 QB in a 2QB one. Applied only where a dedicated slot exists: with none, a
     TE is a pure FLEX asset like any RB/WR and keeps the base cap, since `2 x 0` would make
     the position undraftable. **This isn't just a plausible limit — it's an observed one**:
     across 30 real Mudd league manager-seasons (`domain/draftTendencies.ts`), no manager has
     ever drafted a third QB or TE in one draft; every count is 0, 1, or 2. This cap now
     matters more than it used to, since a weighted sampler (step 4) has no other mechanism
     stopping a long streak of QB or TE rolls on its own — the cap is the tail-truncator.
  3. **Bench QB/TE gate (`filterBenchQbTe`) — a 2nd QB or 2nd TE waits until every starting
     slot can be filled**, DEF/K aside. This one rule replaced _both_ a list of bench-depth
     prerequisites and a soft price penalty, which between them were two mechanisms chasing
     the same behavior — the double work that prompted the rework. "Bench" means beyond
     `dedicatedStarterCounts`, so a first QB and first TE are always draftable and a 2QB
     league's second QB still counts as a starter.
     **RB/WR are deliberately never gated**: while starting slots remain, an extra RB/WR is
     filling a FLEX, and once they're full the rule is a no-op anyway. Forcing a _starting_
     QB/TE is not this filter's job — that's the safety net in (1), which is where it belongs
     because it's a question of running out of picks, not of roster balance.
     **Under Mudd's tendency quorum this hard rule becomes a per-manager coin flip** — some
     managers genuinely double up far more (or less) readily than the league norm this gate
     otherwise enforces uniformly on everyone. `filterBenchQbTe` takes an optional
     `doubleUpAllowed(position)` predicate (default: nobody, reproducing the old hard gate
     exactly) that `selectors.mockDraftDoubleUpAllowedFor` supplies from
     `draftTendencies.qbTeDoubleUpOdds`, gated behind the same manager-handle quorum described
     below. It's one coin flip per (roster, position) per simulation, not per pick — "does
     this manager double up" is a season-level trait, and a per-pick flip at the observed
     p=.6 would double up almost every draft. Outside Mudd (or without quorum) this is exactly
     the hard league-wide rule it has always been.
  4. **`samplePlayer` (`domain/draftAi.ts`) — weighted-random selection among the top few
     survivors by market rank**, replacing strict best-player-available. Chosen over the
     seemingly simpler "roll a target position, then take the best player at it": that
     alternative has unbounded reach — a rare position roll could take the single best player
     at that position from anywhere in the pool, however unrealistic a reach that is. Capping
     to the top N first (`TOP_N = 10`, `RANK_DECAY = 0.65` — tune both here, the `VALUE_DECAY`
     convention) means the AI can only express a positional lean to the extent the market
     genuinely offers one near the top of the board; it can never reach outside that window.
     `RANK_DECAY` started at 0.75 and was lowered after live mock drafts felt a shade too
     willing to reach a few slots down the board — same window, more of the probability mass
     concentrated on the top 1-2 ranked players.
     The weight per candidate is `positionWeight[pos] * RANK_DECAY ** indexInWindow`, so rank
     still dominates and a positional lean only shifts which of the top few gets taken, not
     whether a reach happens at all. `positionWeight` comes from
     `selectors.mockDraftRoundWeights(round)` — Mudd's real observed round-by-round
     RB/WR/QB/TE lean under quorum (see below), or flat/equal weights for every other league.
     **The sampler itself is not a Mudd-only feature** — before this, every mock draft from the
     same board was byte-identical; adding randomness (even flat-weighted) fixes that
     everywhere. Only the Mudd-specific positional DATA is gated.
- **`unfilledStartingSlots` and `dedicatedStarterCounts` answer deliberately different
  questions, and must not be merged.** `unfilledStartingSlots` uses `SLOT_ELIGIBILITY`, where
  a generic `FLEX` _is_ TE-eligible, because it asks the factual question "could this roster
  put a legal lineup on the field" — and a TE genuinely may start at FLEX. `dedicatedStarterCounts`
  credits only `QB`/`TE` slots plus `SUPER_FLEX` for QB, because it answers the
  judgement-laden question "is this particular pick a backup" — where the realistic answer is
  that a FLEX goes to an RB or WR. Collapsing them would put `startingSlots.TE` at 4 in a
  1-TE/3-FLEX league and exempt the second tight end the gate exists to hold back.
- **`advance()` runs synchronously to completion of the current AI streak in one JS tick**
  (at most team-count × rounds iterations — trivial). This is exactly why "no time limit"
  needed no `setTimeout`/animation machinery: a call either lands on the manager's turn or
  finishes before yielding control back to the browser, so there's no mid-AI-run moment to
  pause or resume around.
- **The picker only auto-opens on a live AI→user transition within the session**
  (`advance(openPicker)`), never on a cold page reload — `resumeMockDraft()` (called from
  `loadBoard()` on every tab entry) re-derives "paused at your turn" purely from the
  persisted `picks` array and calls `advance(false)`, so refreshing the page to glance at
  the board doesn't shove a modal in the manager's face. The board instead renders the
  highlighted pending cell with a tappable "Make your pick" button.
- **`noKeeperCost` (taxi squad) leagues are not a special case — they're simpler.** No
  keeper ever occupies a round-cell in that mode (`taxiSquad: true` items are excluded from
  `keepersInCellFor`), so every round is fully open, exactly mirroring how kept players
  don't consume a real pick in that mode either.
- **Never repaired, only detected:** `mockDraftMismatch()` blocks `advance()`/the picker
  behind a "reset to continue" banner whenever the league moved out from under a running
  simulation — no attempt to guess a repair. Two things count as moving: the frozen
  `slotOrderRosterIds` no longer being a subset of `state.rosters` (a commissioner
  added/removed a team), and the frozen `rounds` no longer matching `state.boardRounds`.
  The second is easy to overlook because `rounds` is otherwise write-only: the board
  renders `1..state.boardRounds` (**live**, not the snapshot), so a shortened draft would
  otherwise hide tail-round mock picks from the grid while their players stayed
  unavailable in the picker — the frozen value exists to be _compared_, not drawn from.
  An unknown `state.boardRounds` (failed load) is deliberately not a mismatch.
- **`MockDraftState` stores nothing it doesn't read.** A team count and a start timestamp
  were both dropped after review found them write-only — a snapshot field that nothing
  consumes reads as a protection the code isn't actually providing (see `rounds` above for
  what a real one looks like). Team count is already implied by the frozen `slots` list.
  `seed` **is** read — every AI pick's `samplePlayer` roll and every roster's
  `mockDraftDoubleUpAllowedFor` coin flip are keyed on it (`seededRoll(seed, ...)`). It's
  drawn once with `Math.random()` at Start rather than derived from the league id, so a
  Reset produces a genuinely different draft instead of replaying the same one — and it
  can't be reconstructed after a page reload, which is exactly why it has to be persisted
  rather than kept only in memory (see `seededRoll`'s doc comment below for why).

### Mudd tendency profiles, and why there is no league-id check

Real analysis of the Mudd league's own 2023/2024/2025 drafts (14 rounds each, keeper picks
excluded — see `docs/draft-tendencies-2023-2025.md`) showed a sharp round-1 RB lean (RB 19,
WR 8, QB 0, TE 0 across three years) persisting through round 3 and flipping to a WR lean
from round 4 on, plus strong per-manager QB/TE-doubling profiles (e.g. one manager drafted
2+ QB **and** 2+ TE in all three seasons; another never doubled at QB but always did at TE).
`src/domain/draftTendencies.ts` hand-transcribes this into `MUDD_ROUND_BANDS` and
`MUDD_QBTE_PROFILES`, both hardcoded TS constants rather than an imported JSON file — the
source data is ~40 numbers buried in kilobytes of exhaust the app never reads, sits outside
`tsconfig.json`'s declared program roots, and (were it served from `public/` instead) would
incur the runtime-fetch/cache-busting/schema-validation obligations "Snapshot freshness"
below reserves for data that actually changes at runtime, for numbers describing three
already-completed drafts. Same pattern as `LAST_SEASON_STANDINGS` (`src/ui/rosters.ts`): a
hand-maintained, offseason-refreshed table, not a fetched snapshot.

**There is no league-id check anywhere in this codebase, and this doesn't add one.** Whether
these tables apply is decided by `hasTendencyQuorum` (`draftTendencies.ts`) matching the
CURRENTLY loaded league's manager `display_name`s against `MUDD_MANAGERS` — 5 of 10 known
handles, case-insensitive, trimmed, the identical convention `rosters.ts`'s `standingsRank`
already uses for `LAST_SEASON_STANDINGS`. Below quorum, `selectors.mockDraftRoundWeights`
returns flat/equal weights and `selectors.mockDraftDoubleUpAllowedFor` always returns false —
byte-for-byte the same behavior this app had before any of this existed. A stray same-named
manager in an unrelated league is expected to clear a 5-of-10 bar essentially never; the
threshold also tolerates roughly half of Mudd's real managers renaming on Sleeper before the
tables silently stop applying. **Both the round weights and the per-manager profiles are
gated behind the same `tendencyQuorumMet()` call** — easy to get wrong, since the profiles
feel individually keyed on a `display_name`, but without the shared gate a stranger named
identically to a real Mudd manager in another league would inherit that manager's tendency.

**Add-one smoothing is mandatory, not cosmetic.** Round 1's raw QB and TE counts are
literally 0. A literal zero weight would be both a hard structural ban (impossible, not just
rare) and would break a caller doing weighted sampling outright (an all-QB candidate pool
would sum to zero weight). `positionWeightsForRound` smooths every band with
`(count + 1) / (total + 4)`; `qbTeDoubleUpOdds` smooths every manager with
`(seasons doubled + 1) / (seasons observed + 2)`. Unsmoothed, a manager who's never taken a
second TE could never be modeled as doing so, and one who always has would be modeled as
certain to — the smoothed values (.8/.6/.4/.2 for 3/2/1/0-of-3 seasons) read as a tendency,
which is what they are at this sample size.

**The RNG backing all of this must stay a pure, stateless function of `(seed, ...key)` —
see `seededRoll`'s doc comment in `src/domain/draftAi.ts`.** `advance()` doesn't replay a
draft each time it runs; it fills whichever entries of the persisted `picks` array are still
null, and `resumeMockDraft()` calls it again after every cold page reload with no
in-memory generator left to resume. A streaming PRNG whose state advances per call would be
wrong here — its state is gone the moment the tab closes, so the same pick index would
re-roll differently after a reload. Keying every draw on `(seed, ...key)` instead — the pick
index for `ROLL_PICK`, the roster id and position for `ROLL_DOUBLE_UP` — makes each decision
independently reproducible from what `localStorage` actually holds. Don't replace this with
a stateful generator; it is the single easiest thing for a future change to quietly break.

## Domain rules (configurable per-league; defaults are the Mudd Keeper League's actual

## rules, since this app is built primarily for that league — see `DEFAULT_LEAGUE_RULES`)

- Each team keeps **up to `state.rules.maxKeepers`** players (default 2, UI-capped 1–4).
- A kept player costs the **round they were drafted last year**.
- If the **same manager** keeps the **same player** two years running, the cost climbs
  **`state.rules.inflationRounds`** (default 1), floored at round 1. Matched on `owner_id`
  (user_id), NOT roster_id — roster_ids can shift between seasons. See `sameManagerLastYear`.
- A player kept by a _different_ team last year does NOT inflate.
- **Undrafted last year** → cost = the **final round** of the draft (`lastDraftRound()`).
- **"Was kept last year" is inferred, not simply read** — see "Detecting last season's
  keepers" below. Every rule above about inflation depends on that verdict.
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

## Detecting last season's keepers

Inflation hinges on `PrevDraftEntry.wasKeeper`, and **Sleeper cannot tell us that reliably.**
`is_keeper` is never set on a pick made from a **traded-in draft slot** — its keeper
preassignment can only bind to a team's own original slot — so a manager who kept a player
using an acquired pick reads as an ordinary drafter. Confirmed live: two of this league's 2025
keepers (Malik Nabers, Jayden Daniels, both genuinely kept per the commissioner) carry
`is_keeper: null` for exactly this reason. Across 13 drafts / 2008 picks reachable from this
user's leagues there is **not one** `is_keeper: true` pick on an acquired slot.

`buildPrevDraftMap` (`src/domain/prevKeepers.ts`) resolves it with three rules, per roster:

1. **Every `is_keeper` pick counts.** Sleeper's own flag is never second-guessed.
2. **An acquired-slot pick counts only if that manager already held the player at the end of
   the season before.** Matched on stable `owner_id`, never `roster_id` — Sleeper recycles
   roster ids, and across a two-season gap that match is noise. This is the corroboration; the
   trade-slot signal alone is necessary but nowhere near sufficient.
3. **Corroborated candidates fill only the slots rule 1 left free, and if there are more of
   them than slots, none are admitted.** Refusing to guess is deliberate — the obvious
   tie-breaks are all wrong (an early-round acquired pick is the _most_ likely ordinary
   trade-up and the _least_ likely keeper), and it never arises in four seasons of real data.

> **The cap is not decoration, and neither is the corroboration — each covers a season the
> other gets wrong.** In the 2025 draft, corroboration alone is sufficient (2 of 14 candidates
> survive, both on rosters with a free slot). In 2024, Jakobi Meyers _does_ corroborate but his
> roster already held two `is_keeper` picks, so only the cap suppresses him. Drop either rule
> and the bug returns in one season or the other.

**`maxKeepers` comes from the league being read** (`prevLeague.settings.max_keepers` via
`maxKeepersFromLeague`), not `state.rules.maxKeepers`. Three reasons, all live: it's last
season's rule, not this one's; the Settings value is user-editable up to 4, which would switch
the cap off; and since `ensurePrevDraftLoaded` short-circuits on `prevDraftLoaded` while
Settings only re-renders, reading the live setting would leave `wasKeeper` silently stale after
an edit.

**Inference switches off entirely — leaving `is_keeper` alone, the behavior from before any of
this existed — whenever its inputs are missing**: no season-before league (a league in its
second season), a failed rosters fetch, or a roster with no `owner_id` (orphan/commissioner
teams). `rosteredOwnersByPlayer` is `null` rather than `{}` for precisely this reason: "we
couldn't load it" must be distinguishable from "loaded, and nobody held him."

**Known blind spot, measured rather than assumed.** Corroboration recalls ~78% of genuine
keepers — 14 of this league's 18 known 2025 keepers. The misses are players acquired in the
offseason and kept by their _new_ manager, who by definition weren't on that manager's roster
the season before. Such a keeper is only actually missed if he was **also** drafted on a traded
slot, which has never happened here, and the failure undercharges — the safe direction.

> **What this replaced, so it isn't reintroduced.** The previous code was
> `is_keeper === true || pickWasAcquiredViaTrade(...)`. In the 2025 draft that flagged 14 extra
> picks of which 12 were ordinary picks made with traded-for capital, putting **8 of 10 rosters
> over a hard 2-keeper limit** and overcharging 8 players by a round (issue #2). A bare
> `is_keeper || acquiredSlot` is always wrong.

## Backend (Cloudflare Worker)

`worker/` is a small Cloudflare Worker deployed separately from the site. It exists for
exactly one reason: **CORS, not auth, is what blocks other platforms.** Verified live —
Yahoo's Fantasy API returns no `access-control-*` headers on either the endpoint or its
preflight, so even a perfectly valid OAuth token is unusable from a browser. MyFantasyLeague
echoes its own domain; Fleaflicker sends nothing. Only Sleeper (`*`) and ESPN (reflects the
caller) can be called directly. A server-side hop is the only fix, and Cloudflare's free
plan covers it with room to spare (100k requests/day against a realistic ~7k; no card
required).

**It is not an open proxy, and must never become one.** An arbitrary-destination CORS proxy
lets anyone bypass other sites' CORS protections and reach hosts from your infrastructure.
Four properties in `worker/src/upstreams.ts` prevent that, and all four must survive any
change:

- The client names an upstream by **key** (`/api/yahoo/...`), never by URL. There is no
  `?url=` parameter — an arbitrary destination is _not expressible_.
- Each upstream declares the **path prefixes** it will serve; anything else 404s.
- Only **allow-listed origins** get CORS headers, so it isn't a free proxy for the web.
  Be precise about what that buys, though: the list (`ALLOWED_ORIGINS`) holds the
  deployed site **plus `localhost:5173`/`127.0.0.1:5173` for local development**, and
  those two are not exclusively ours — they're any developer's default Vite port. So
  the origin check is a real barrier to drive-by use from an arbitrary website, but it
  is not an identity check. The reason that's acceptable is the other three properties:
  a caller can only reach two fixed hosts on fixed path prefixes, read-only, supplying
  their own upstream credentials. Drop the localhost entries if the Worker ever proxies
  anything that doesn't hold.
- GET and OPTIONS only, with a fixed forwardable-header list.

Paths are **rejected, not sanitised** — `new URL()` normalises `..` and encoded separators
before the prefix check, so anything escaping its prefix simply fails to match. Every one of
these is pinned by tests in `worker/test/upstreams.test.ts`, and verified against a running
Worker (disallowed origin → 403, unknown upstream → 404, traversal → 404, `?url=` inert).

Upstream responses are **rebuilt, not passed through**, so an upstream's CORS headers (or
lack of them) can't leak into a response we're vouching for. Upstream failure is a 502, not
a 500, so a client can tell "Yahoo is down" from "the proxy is broken".

`npm run dev` / `npm run deploy` inside `worker/`. Deploying needs a Cloudflare login; the
site keeps working without the Worker — it only gates non-Sleeper platforms.

## Market value sources

The keeper metric needs one number per player: the pick at which the market prices him.
**Three sources can supply it, and they are not the same quantity** — the per-league
`rules.marketSource` setting picks which, defaulting to `'value'`, with a fourth option
that averages them:

- **`'value'` — FantasyCalc** (`scripts/fetch-fantasycalc.mjs` → `public/value-snapshot.json`).
  A **trade-value ranking**, answering "how good is this player". `overallRank` is used
  directly as an implied pick number. Steadier than crowd ADP, and matched by **exact
  Sleeper id** — FantasyCalc supplies `sleeperId` on every row (verified: 198/198), so none
  of the name-normalisation guesswork below applies.
- **`'adp'` — Fantasy Football Calculator**. Average draft position, answering "what does
  it cost to get him" — which is literally the keeper question, and the reason this was the
  original source. Drawn from **mock drafts run on FFC's own site**, so the sample is large
  (2,158 drafts over six days, measured 2026-08-12) but nobody drafting has anything at
  stake. It is a rolling recent window and can run hard on a week of news: confirmed live,
  Rashee Rice sat at ADP ~27 for three weeks (six consecutive snapshots) then ran to 12.7
  in six days, while FantasyCalc and FFC's own longer-window 2QB set both still had him
  near 40.
- **`'adp-real'` — MyFantasyLeague** (`scripts/fetch-mfl-adp.mjs` →
  `public/adp-real-snapshot.json`). The same quantity over **real, non-mock redraft leagues
  someone paid to host** — MFL hosting is $99.95–$109.95 per league in 2026, so nobody is
  on it casually. See "The MFL real-draft source" below for its two significant caveats
  (much smaller sample, and no quarterbacks at all).
- **`'blend'`** — the mean of the other three, per player, over whichever of them price
  him (`blendMarketMaps` in `src/domain/marketValue.ts`). All three are already expressed
  as an implied pick number, so the average is meaningful, and it damps each one's
  characteristic failure. It averages over _available_ sources rather than requiring all
  three, because coverage genuinely differs — which does mean a player priced by one source
  is smoothed less than one priced by three. That artifact is real, small where it matters
  (the top of the board, where coverage is total), and cheaper than the alternatives. The
  UI reports "N of 3 sources" next to each blended pick so a thin average can't pass for a
  consensus. Needs at least two sources; below that it falls through to the single-source
  path rather than dressing one source up as a blend.

None is strictly better, which is why this is a setting rather than a decision baked
into the code. **The UI must always say which is in use** — the header badge reads
"Value · FantasyCalc", "ADP · FF Calculator", "ADP · MFL real drafts" or "Blend · 3
sources", never labelling a value rank as ADP, never labelling mock-draft ADP as
real-league ADP, and never labelling a blend as any one of its inputs.
**The labels are terse because four chips share one header row** — spelled out in full they
pushed a phone's header to four rows. Brevity may cost the vendor's full name (it survives
in the badge's `title` and in the menu it opens); it may never cost the distinction between
the sources, which is the whole contract.
**The badge is also the control**: tapping it opens a menu of the selectable sources
(`ui/marketSourceMenu.ts`) and switching re-fetches and re-renders, so the source can be
changed from any tab without visiting Settings. Both that menu and the Settings dropdown
route through the single exported `applyMarketSource` (`ui/settings.ts`) — a second copy
would be a second chance to forget clearing `state.adpMap`, which is what makes the numbers
actually change rather than the badge merely claiming they did.
`ensureAdpLoaded` tries the preferred source first and falls back to the others before
resorting to Sleeper's `search_rank` proxy, so one bad snapshot degrades to another real
source. **`marketSource` is part of the ADP cache key** — without that, a map built from
another source is returned before the preference is ever consulted and switching appears
to do nothing.

### Only two of the four are user-selectable

The Settings dropdown and the header badge's menu both offer **`'value'` and `'blend'` only** — one source, or all of them
averaged (`SELECTABLE_MARKET_SOURCES` in `src/ui/settings.ts`). Picking between two crowd
ADP feeds by hand was a decision with no good answer; the blend is the answer.

**This is a UI restriction and nothing more.** `'adp'` and `'adp-real'` are still fetched
daily, still schema-validated, still what the blend is built out of, and still what
`ensureAdpLoaded` falls back to when a preferred snapshot fails — which is exactly why the
header badge, the roster explainer and the draft note all still carry branches naming
them. Don't "clean those up" as dead code; a fallback can put the app on either source at
any time, and the badge saying so is the whole contract.

One wrinkle that has to keep working: **`'adp'` was selectable for months**, so a browser
that configured a league before 2026-08-13 can still have it in `localStorage` (rules are
per-league under `kdb_rules_<leagueId>`, and are _not_ shared via the Gist). Rendering only
the two current options would leave that league's select showing "FantasyCalc" while the
app was actually running on FFC ADP — the UI lying about the source, the one thing this
code may not do. So `syncMarketSourceOptions` re-adds the league's own source, marked
"(no longer offered)", selectable only in the sense that it is already selected; switching
away removes it for good. Verified both paths in the browser (there is no jsdom in this
repo's test setup, so this one is not unit-tested).

The value snapshot is a **matrix**: team count (8/10/12/14) × scoring (0/0.5/1 PPR) ×
QB count (1/2), 24 entries, ~117KB. `pickValueEntry` partitions **hard** on QB count and
then matches nearest team count, then nearest scoring. Measured as mean/max shift in rank
position, team count moves players 0.25-0.64 (max 4) and PPR 0.19-0.24 (max 3) — small,
but genuinely non-zero, so a league is priced against its own shape. 1QB→2QB moves them
**25.25 on average, max 103**, which is why that one is a partition and never a tiebreak.

> **`numTeams` and `ppr` MUST stay declared in `ValueSnapshotEntrySchema`.** zod strips
> undeclared keys, so omitting them doesn't fail loudly — it silently drops both
> dimensions, collapses every entry's description to "1 QB", and leaves the app unable to
> say which entry it picked. Cost real debugging time; there's a regression test pinning it.

> FantasyCalc has **no ADP**: there is no ADP endpoint (404) and `maybeAdp` is null on
> every row across both redraft (198) and dynasty (474). Don't go looking for one again.

**Contrast with FFC, and why the two sources are shaped differently.** Fantasy Football
Calculator's `teams` parameter is a **no-op** — re-verified across all four formats, it
returns byte-identical players, ADPs, highs, lows and draft counts for 8/10/12/14. So the
ADP snapshot has no league-size dimension to retain (there is nothing there to store), and
varies only by scoring format plus the 2qb split. FantasyCalc's equivalent parameters do
vary, so it keeps the full matrix. Same question, opposite answer, because the data differs.

## ADP data pipeline

Real ADP was investigated thoroughly (see git history) — Sleeper has no official ADP
endpoint, and both free real-ADP sources we use (Fantasy Football Calculator,
MyFantasyLeague) send no CORS headers a browser will accept from this app's origin
(confirmed live: direct `fetch()` calls fail with `net::ERR_FAILED`). Paid sources
(FantasyPros) were ruled out — no paid API keys in a static, no-backend app with no way to
keep them secret. So real ADP can only be fetched **server-side, at CI/build time**, never
at runtime. For MFL that isn't just a workaround but the required shape: the one access
pattern its terms forbid is calling the API "via Javascript from web pages outside the
myfantasyleague.com domain", which is exactly what a browser fetch would be. Otherwise
"access to this data is provided free to anyone to use in almost any way"
(<https://api.myfantasyleague.com/2026/api_info>); registration is optional and raises the
rate limit ~2.5×, and registered clients are asked to send their registered User-Agent.

> **Re-checked 2026-08-06 and again 2026-08-12, since "just pull Sleeper's own ADP" keeps
> coming up.** It does
> not exist as an endpoint. Sleeper's GraphQL API (`https://sleeper.app/graphql`) exposes
> **240 query fields and not one of them is ADP** (confirmed live by introspection —
> note the schema field is `query_type`, snake_case, not `queryType`;
> `get_adp` returns "Cannot query field"). It has plenty of _draft_ fields — individual
> drafts, picks, queues — which is why community tools appear to have "Sleeper ADP": they
> aggregate many mock drafts themselves. There is no ffverse/nflverse ADP CSV to read
> either (`nflverse-data` releases contain no ADP asset; `ffscrapr` is an **R** package
> that wraps platform APIs and ships no ADP dataset). Don't spend another afternoon on
> this without new evidence.
>
> **FantasyCalc** (`api.fantasycalc.com/values/current`) was evaluated too: free, no auth,
> 200 rows, and — unlike FFC's `teams` param — its `numTeams`/`ppr`/`numQbs` parameters
> genuinely change the output. But it returns **trade values, not ADP**: `maybeAdp` is
> null on every row, and `overallRank` is a value ranking (it had McCaffrey 8th where
> FFC's half-ppr ADP had him 6th). Value answers "how good is this player", ADP answers
> "what does it cost to get him" — and the keeper metric needs the latter. It also sends
> no CORS headers, so it would be a CI-time fetch like FFC. Worth remembering as a
> _better proxy than Sleeper's `search_rank`_ if the rank-proxy fallback ever needs
> upgrading; not a replacement for ADP.
>
> **BeatADP** has the ideal data (real per-platform ADP, including Sleeper, with a
> scoring-format filter) but is a paid product whose `robots.txt` disallows `/api/`. Not
> a source we take from. If a subscription ever grants an export or key, wiring it in is
> one more `fetchOne()` variant.
>
> **Every high-stakes/paid-league operator forbids redistributing their ADP** (searched
> 2026-08-12, specifically for money-league rather than mock data). This is structural, not
> bad luck: for these outfits ADP _is_ a product, a reason to subscribe or to enter their
> contests, and this app republishes its snapshots to a public GitHub Pages URL, which is
> unambiguously redistribution. **Don't build on any of them.**
>
> - **NFFC** (`nfc.shgn.com`). Real money leagues; `robots.txt` allows everything; the
>   table is served by `POST /adp.data.php` with `sport`/`num_teams`/`draft_type`, and
>   `num_teams` genuinely segments (10-team = 328 players over 21 drafts, 12-team = 517
>   over 837) — unlike FFC's no-op `teams`. `draft_type` even has a **"Keeper Leagues"**
>   option. All of it is off-limits: the terms
>   (<https://terms.shgn.com/terms?theme=nfc>) prohibit "using automated means (including
>   but not limited to harvesting bots, robots, parser, spiders or screen scrapers) to
>   obtain, collect or access any information on the Website."
> - **RTSports** (`rtsports.com`). Publishes a clean, current, fully machine-readable ADP
>   PDF at `/football/draft-guide-average-pdf.php`, and its `robots.txt` allows all. The
>   terms still rule it out twice over: "All pages and data displayed on the RealTime
>   Fantasy Sports site are copyrighted ... and may not be reproduced or reused in any form
>   without the express written consent", plus "any re-sale or re-distribution of this
>   service or its contents (in any form) ... is strictly prohibited". API access
>   separately requires their advance written consent.
> - **FFPC** (`myffpc.com`). Great filters on paper (Main Event, Big Gorilla, Best Ball,
>   Superflex, date ranges) but login-gated with no export or API — and its TE-premium
>   scoring distorts TE ADP for anyone else anyway.
> - **Full Time Fantasy / FFWC** — the "high stakes ADP" page carries no ADP rows at all
>   and its visible timestamp reads `3-9-18`.
> - **Underdog** has no public API and no official ADP feed; everything available is
>   third-party scrapers or paid odds aggregators. Best-ball ADP is the wrong shape for a
>   keeper league regardless (18 rounds, no waivers).
> - **ESPN**'s `lm-api-reads.fantasy.espn.com/.../leaguedefaults/3?view=kona_player_info`
>   does return real `averageDraftPosition` plus `auctionValueAverage` with no auth. Not
>   used: `leaguedefaults/1` and `/3` return **byte-identical ADP** (no scoring
>   segmentation, FFC's `teams` bug again), the payload is ~12 MB for 400 players, and it
>   is an undocumented internal API with no usage grant.
>
> **MyFantasyLeague is the exception, and that's why it's the one we took** (see below).
> MFL sells hosting, not data, so it gives the data away.
>
> Also confirmed: FFC ignores `start_date`/`period`/`days` params, because it already
> serves a **rolling recent window** on its own (the half-ppr/10-team set reported
> `2026-08-01..2026-08-06`, 1731 drafts). So there is no staleness knob to turn — the
> freshness lever is purely our refresh cadence, which is why it's daily.

- `scripts/fetch-adp.mjs` pulls **one entry per format** (`standard`, `half-ppr`, `ppr`,
  `2qb`) from Fantasy Football Calculator's public REST API (free for personal/commercial
  use, attribution requested — see the footer credit in `index.html`) and writes
  `public/adp-snapshot.json`. It deliberately does **not** fetch a format × team-count
  matrix: FFC accepts a `teams` parameter and ignores it — verified 2026-08-06, all four
  formats return byte-identical players, ADPs, highs, lows and draft counts for
  `teams=8/10/12/14`. The matrix produced 16 entries of which 12 were exact duplicates
  and made the snapshot the browser downloads 4× larger (620KB → 151KB after the trim,
  which matters more now that the fetch is cache-busted). If FFC ever segments by league
  size, restore the loop here and take the team count back as an argument in
  `rankAdpEntries`; the schema still tolerates a `teams` field so snapshots cached before
  the change keep validating.
- `.github/workflows/refresh-adp.yml` runs it on a schedule (daily) and
  `workflow_dispatch`, committing the snapshot to `main` if it changed — which then
  triggers the normal `deploy.yml` (any push to `main`) to rebuild and redeploy.
- At runtime, `ensureAdpLoaded` (`src/data.ts`) fetches this snapshot same-origin (no
  CORS problem — it's our own static asset), ranks this league's entries via
  `rankAdpEntries` (superflex partition first, then nearest scoring format from the
  league's `scoring_settings.rec`), and matches FFC's name-keyed players against Sleeper's
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

### The MFL real-draft source

`scripts/fetch-mfl-adp.mjs` → `public/adp-real-snapshot.json`, refreshed by the same
workflow (marked `continue-on-error` so an MFL hiccup can't take the other three snapshots
down with it). Deliberately its **own file**, not extra entries in the FFC snapshot:
`rankAdpEntries` falls a player through to the next entry when he's missing from the
closest one, which is right _within_ a source and wrong _across_ two of them.

Query is `TYPE=adp&IS_KEEPER=N&IS_MOCK=0&PERIOD=ALL&IS_PPR=1&CUTOFF=5`. Every filter is
load-bearing:

| Filter        | Why                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IS_KEEPER=N` | Redraft only. **Keeper-league ADP is the wrong input here despite this being a keeper league** — it's a _post-keeper_ board, where the best players are kept rather than drafted, so they barely appear (measured: Gibbs in 19% of keeper drafts, rookie Jeremiyah Love in 93%). That deflates exactly the players the surplus metric is deciding about. |
| `IS_MOCK=0`   | Real drafts only, which FFC cannot express at all. Mocks are only ~12% of MFL's pool anyway (264 vs 236 drafts).                                                                                                                                                                                                                                         |
| `PERIOD=ALL`  | Season to date. `RECENT` is near-empty this early — 9 drafts vs 91 on otherwise identical filters.                                                                                                                                                                                                                                                       |
| `IS_PPR=1`    | MFL's PPR flag is binary, no half-PPR. The real-draft pool is ~98% PPR regardless (231 of 236), so asking explicitly costs ~5 drafts and makes the `ppr` format label honest.                                                                                                                                                                            |
| `CUTOFF=5`    | MFL's own docs: below 5% "the results may be unpredicatble".                                                                                                                                                                                                                                                                                             |

Deliberately **not** filtered by `FCOUNT`. It works (unlike FFC's `teams`), but costs far
more than it buys at this sample size: `FCOUNT=10` drops 236 drafts to 38, and 38 is where
noise wins — a 36-draft slice had Josh Allen first overall. Revisit if MFL's volume ever
makes a 10-team cut clear a few hundred drafts.

Three things the generator has to fix up, all verified against live data:

- **QB is dropped entirely.** MFL's ADP export has no QB-count or superflex filter — its
  parameters are `PERIOD`, `FCOUNT`, `IS_PPR`, `IS_KEEPER`, `IS_MOCK`, `CUTOFF`, `DETAILS`,
  that's the complete list — so the pool silently blends 1QB and superflex leagues.
  Measured against FFC the same day, QBs in the top 40 picks: **FFC half-ppr 1, MFL 8, FFC
  2qb 17.** MFL sits between the two markets because it _is_ both averaged together (Josh
  Allen 4.02 there vs 22.8 in FFC half-ppr and 1.4 in FFC 2qb). Since the blend can't be
  undone from outside, the QBs are dropped rather than fed in wrong — same call
  `rankAdpEntries` makes for the superflex partition. `meta.excludedPositions` records this
  in the file so the gap explains itself, and `AdpSnapshotEntrySchema` must keep that field
  **declared** or zod strips it silently.
- **Team codes are normalized to Sleeper's.** MFL spells nine differently
  (`GBP JAC KCC LVR NEP NOS SFO TBB`, plus `FA` for unrostered). This matters most for
  defenses, which are matched to Sleeper by abbreviation alone, so an unmapped code
  silently drops that defense.
- **IDP is filtered out** (275 of 704 rows were DE/LB/DT/S/CB — MFL leagues often start
  IDP). Names are also flipped from MFL's `"Last, First"`; `"PK"` needs no handling since
  `matchAdpToPlayers` already aliases it.

> **`stats_global_id` is not a usable Sleeper crosswalk.** It looks like one — MFL supplies
> it on every player — but Sleeper populates `stats_id` for only **2,980 of 12,218**
> players (legacy veterans), so it matched **64 of 397**. Name matching gets **341 of 397
> (86%)** naive, and ~95% once suffixes are stripped and defenses go by team. Don't spend
> an afternoon on the id join.

`test/mflAdp.test.ts` asserts against the **committed snapshot**, not a fixture, so drift
between what the generator writes and what the app can read surfaces in CI.

### Superflex / 2QB

`scripts/fetch-adp.mjs` also pulls FFC's `2qb` set (its name for the superflex market),
and `rankAdpEntries` treats it as a **hard partition, not a tiebreak**: a league draws
from the 2QB market or the 1QB formats, never a blend. This matters because starting a
second QB reprices the position entirely — confirmed live, Josh Allen goes **25.6** in
half-ppr and **1.4** in 2qb. If 2qb entries merely sorted last for a 1QB league, a QB
absent from every 1QB format would fall through and be priced as the first overall pick,
which is worse than showing no ADP. Superflex leagues still fall back to the 1QB entries
if a snapshot has no 2qb data — a slightly mispriced QB beats an empty board.

Detection (`isSuperflexLeague`) accepts **either** an explicit `SUPER_FLEX` slot **or**
two or more `QB` starters. Both are real: confirmed live, one of this user's leagues
starts `QB,QB,...` with no `SUPER_FLEX` slot anywhere, so a `SUPER_FLEX`-only check would
silently miss it and price that league off 1QB ADP.

### Snapshot freshness (two caches, both of which have bitten us)

The snapshots are static assets with **stable filenames**, which is the trap: Vite
content-hashes `dist/assets/*.js|css`, but anything in `public/` keeps its name forever,
so nothing about the URL changes when the contents do. Two layers can therefore serve
stale ADP, and both are handled deliberately:

- **HTTP/CDN cache.** `fetchAdpSnapshot`/`fetchOutlookSnapshot` (`src/api/`) append
  `?t=${Date.now()}` and pass `cache: 'no-store'`. Without this the browser and Pages'
  CDN will happily hold a copy indefinitely — confirmed the hard way: a stale cached
  snapshot pinned Christian McCaffrey at his 2026-07-27 ADP (#4 overall) for a user long
  after the committed snapshot had moved him to #6, which reads as "the app's ADP is
  wrong" rather than "this file is old". If you add another `public/` data asset,
  cache-bust it the same way.
- **localStorage cache.** ADP uses its own `ADP_MAX_AGE_MS` (4h, `src/state.ts`), NOT the
  20h `PLAYERS_MAX_AGE_MS` it originally shared with the player dictionary. Sleeper's
  player dict genuinely only changes about daily; ADP moves continuously and is the number
  people second-guess the app over, so it gets a much shorter leash. The snapshot is a
  small static file — refetching it is cheap.

## League settings import

Sleeper knows some of what this app asks the user for, so on the **first** load of a
league `seedRulesFromLeague` (`src/state.ts`) seeds the rules from it. Only
`settings.max_keepers` is derived — confirmed live across three of this user's leagues
(2, 2, and 1, where this app's default is 2, so the third was simply wrong before).

Two deliberate limits:

- **It only seeds a league never configured here** (`hasSavedRules()`). Silently
  rewriting a commissioner's deliberate choice because Sleeper disagrees would be worse
  than being out of date. When saved rules differ, the Settings tab shows what Sleeper
  says plus a "Use Sleeper's settings" button, and otherwise leaves it alone.
- **`noKeeperCost` is never inferred from `settings.taxi_slots`.** Sleeper's taxi squad
  is a dynasty rookie-stash concept and has nothing to do with this app's "keepers cost
  no draft pick" rule despite the shared nickname; `inflationRounds` has no Sleeper field
  at all. Both stay manual, and `suggestedRulesFromLeague` has tests pinning that.

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
- Matching is by **id, never by name** — but NOT by Sleeper's own `espn_id` alone. That
  field exists (Josh Allen is Sleeper `4984`, `espn_id: 3918298`) but is far too sparse to
  rely on: measured live, only ~35% of the top 200 fantasy players carry one, and the gaps
  are the biggest names on the board — Bijan Robinson, Gibbs, Ja'Marr Chase, Puka Nacua,
  Amon-Ra St. Brown. Matching on it alone left **~70% of draftable players with no
  outlook**, silently, for months.
  So `scripts/fetch-outlooks.mjs` builds an **id bridge at CI time**: FantasyCalc publishes
  both `sleeperId` and `espnId` on every row (198/198), which resolves most of the board,
  with Sleeper's own `espn_id` filling in anyone FantasyCalc doesn't rank. Each snapshot
  entry then carries a `sleeperId` alongside its `espnId`. Coverage of the top 50 went
  **30% → 98%** (the one straggler is a retired player with no outlook to have).
  At runtime `outlookFor` tries the Sleeper id first, then the ESPN id. Map keys are
  **namespaced** (`sleeper:<id>` / `espn:<id>`) so a Sleeper id can never collide with a
  numerically equal ESPN id. **Bump `LS_OUTLOOK_CACHE_PREFIX` whenever that key shape
  changes** — a stale cache of the old shape validates fine and matches nothing, so every
  player silently loses its outlook until the cache ages out.

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
  (one request per position slot, once daily, ~300ms apart) rather than polling
  per-player — the same "good citizen" posture as the ADP fetcher.

## Locked keepers (Sleeper's draft room wins)

Selecting keepers in this app is a **pre-deadline planning tool**. Once a league's keeper
deadline passes, the commissioner enters everyone's keepers into Sleeper's draft room, and
from that moment **Sleeper is the source of truth** — for who is kept _and_ for what round
each one costs. Confirmed live on the 2026 Mudd draft: 20 `is_keeper` preassignments, 2 per
team, sitting in a draft still reading `status: 'pre_draft'`.

**The presence of those picks is the only available "deadline has passed" signal.** Sleeper
publishes no keeper-deadline field and no locked flag — checked live across every key on
both the league and draft objects — and `status` stays `pre_draft` before and after keepers
are entered. So `keepersAreLocked` is simply "does the current draft return any `is_keeper`
pick".

> The accepted cost: a commissioner entering teams one at a time leaves the rest briefly
> showing no keepers. **Waiting for every roster to appear cannot fix this**, because a team
> that legitimately keeps nobody is indistinguishable from one not yet entered — that rule
> would never fire in a season where someone keeps zero.

**Sleeper's round is used verbatim, and none of `keeperCost.ts` runs.** A locked keeper
already has a stated round and exact pick number, so there is nothing to resolve: no
inflation math, no same-round collision, no capacity cascade, no `cannotBeKept`. What the
app's own rules _would_ have charged is still computed and kept in `KeeperCostItem.
expectedCost`, but **only when it disagrees** — Sleeper wins either way, and the board tags
the player ("rules say R4") so a commissioner's typo or an unmodelled house rule is visible
rather than silently absorbed. Measured against the real 2026 data, all 20 agreed, which is
a genuine independent check on the keeper-cost math.

**One chokepoint switches the whole app.** `getRosterKeeperCostsFor` (`src/selectors.ts`)
branches to `lockedKeeperCosts`, and every tab reads keepers through it — so the board, the
Draft List's KEPT tags and the mock draft's occupied cells all follow with no special-casing.
`keeperListFor` (`src/state.ts`) reports the locked list too, which is what makes the roster
stars and the "Keepers N/M" counts agree. `state.keepers` is deliberately left alone: it's
still the manager's own planning and still what the gist holds, it just stops being what
anyone is shown.

**Everything that writes keepers switches off.** `canEditRoster` returns false for every
roster — including your own, and including a league with no gist configured at all — and
`renderKeeperActions` renders nothing, since there is no longer a change that could go
anywhere. The Rosters tab explains why rather than just going inert.

**Failure means "not locked".** `ensureLockedKeepersLoaded` (`src/data.ts`) leaves the map
null on any error, so the app falls back to in-app selections. That is the right direction
to fail: showing the picks people chose is a far smaller wrong than showing a league with no
keepers at all.

> **Known blind spot, same root cause as `prevKeepers.ts`.** Sleeper cannot set `is_keeper`
> on a pick made from a traded-in slot, so a keeper assigned against an acquired pick may
> not carry the flag and would be missed here. Unlike last season's draft there is nothing
> to corroborate against, and this code deliberately does **not** guess: missing one shows a
> team a keeper short, which is visible and fixable, while inventing one silently removes a
> real player from the draft pool. None of the 2026 keepers were on acquired slots, so this
> is untested against live data.

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

**Setup is build-time only, and optional.** `VITE_KEEPER_GIST_ID` /
`VITE_KEEPER_GIST_TOKEN` come from GitHub Actions (`vars.KEEPER_GIST_ID` /
`secrets.KEEPER_GIST_TOKEN` in `.github/workflows/deploy.yml`); for local development,
put them in a gitignored `.env.local`. With no Gist ID configured, `canReadShared()`
(`src/api/gist.ts`) is false and the app behaves exactly as it did when keepers were
localStorage-only — every team's stars stay interactive, there's no lock concept, nothing
changes. A build with an ID but no token is a supported **read-only** mode
(`canWriteShared()` false, "Sync · read-only" badge).

**An expired token degrades to read-only, it doesn't take the league down.**
Fine-grained gist PATs have a maximum lifetime, so this is a _when_, not an _if_. When
GitHub turns the credential down (401/403), `fetchSharedKeepers` drops it and re-requests
**unauthenticated** — the gist is fetchable by anyone holding its ID, so everyone keeps
seeing the locked-in picks and only _saving_ is lost. `isTokenRejected()` latches so the
app stops offering save controls that cannot work, `commitSharedChange` throws
`GistAuthError` immediately instead of burning three retries on a "no" that won't change,
and both the header badge ("Sync · token expired") and the manager's own roster
card say plainly that the token needs renewing and to contact `LEAGUE_ADMIN`
(`src/api/gist.ts`) — a broken credential needs a person, not a retry. Renewing it means
updating the `KEEPER_GIST_TOKEN` secret and redeploying.

There is deliberately **no in-app field for the gist ID or the token**, and adding one
back would be a mistake on two counts: a token box invites a manager to paste a
credential into a page that already ships one (teaching exactly the wrong habit for a
value that is not per-user and not secret from anyone who opens devtools), and a
per-browser gist override silently splits the league across two lists that look
identical, which is a genuinely confusing failure for the one feature whose entire job is
that everyone sees the same thing. One league, one build, one shared list.

**Identity is honor-system, not authentication.** Sleeper has no OAuth for third-party
apps, so there's no way to cryptographically prove which manager is at the keyboard. The
signed-in manager's Sleeper `user_id` (`state.currentUserId`, `src/state.ts`) is learned
automatically from the setup screen's username lookup; `myRosterId()` matches it against
`roster.owner_id`. When that doesn't resolve (the manual league-ID path never learns a
username, or the account owns no team here), the **"Which team is yours?" card on the
Rosters tab** (`renderClaimTeamPrompt`, `src/ui/keeperControls.ts`) asks directly. It
lives on that tab rather than in Settings because it gates the tab's whole purpose —
until it's answered nobody can select a keeper — and a blocking question buried in
another tab is a dead end. The header identity badge is a real button that re-opens it to
switch teams. The failure mode this accepts is a friend picking the wrong team;
acceptable for a private league, not worth building real auth for.

**Data shape and merge semantics** (`src/api/schemas.ts` `SharedKeepersSchema`,
`src/domain/keeperShare.ts`): one JSON file, `{ version: 1, leagues: { [leagueId]: {
[rosterId]: { playerIds, savedBy, savedByName, savedAt } } } }`, keyed by league so one
Gist can back more than one league. `mergeSharedKeepers` **builds its result from the shared doc**, not by patching the local
copy. That direction matters: the doc is authoritative about what every team's keepers
are, _including that a team absent from it has none_. Patching local instead meant a
withdrawal never propagated — each earlier sync had mirrored that team's picks into
localStorage, so they lingered as phantom keepers nobody had selected, greying out players
on the Draft List and filling cells on the Board. Only two rosters keep local selections
through a merge: the one being edited here (`state.editingRosterId`), so re-opening a
locked team doesn't get stomped back on the next refresh; and the signed-in manager's own
**while it's absent from the doc** — those are picks chosen but not yet committed. Once
their team IS in the doc the remote copy wins, so a save made on another device shows up.
`locks` mirrors the doc exactly, including the roster being edited: that team really is
still locked for the league until it's saved again. `withTeamKeepers`/`withoutTeamKeepers`
are non-mutating single-team builders; `samePicks` is the order-insensitive comparison the
write path verifies with.

**Writes are read-modify-write-_verify_, with bounded retries** (`commitSharedChange`,
`src/sync.ts`). The gist API has no compare-and-swap, so there is an unavoidable window
between our read and our write in which another manager's save can land and be
overwritten. Re-reading after the write is how a client notices the mirror image of that
— that _it_ was the one overwritten — and the retry re-applies its change on top of the
now-current doc. Since every client runs the same loop and `apply` only ever touches its
own team's key, a collision converges with both entries intact instead of one manager
silently losing their picks. Backoff is jittered on purpose: two managers who collided
were by definition acting at the same moment, and a fixed wait would line their retries up
to collide again. Three attempts, then it throws and the UI says so — a save that can't be
confirmed must never look successful.

**Reads poll in the background** (`startSharedKeeperPolling`): keeper season is a live,
shared activity where managers sit on the page watching what everyone else does, and
without a poll the board looks frozen until someone thinks to hit Refresh. Every 60s while
the tab is visible, plus an immediate catch-up on `visibilitychange` (coming back to the
tab is exactly when you want to see what changed). It skips while `syncStatus === 'syncing'`
so a poll can't land between a write and its read-back and confuse the verification, and it
re-renders only when something actually changed.

**The loading overlay is for deliberate actions only** (`showBusy`/`hideBusy`,
`src/ui/overlay.ts`): save, withdraw, and a tapped Refresh block the page while they run.
Background polling stays silent — a modal that flashed up every 60s on its own would be far
worse than no feedback at all.

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

**The sync badge is silent when sync is fine.** 'off', 'syncing' and a healthy 'idle'
render no badge at all; only "Sync · offline", "Sync · token expired" and "Sync ·
read-only" appear. A permanent green "on" chip is noise, costs one of the few header
slots a phone has, and — worse — trains people to stop reading the badge at exactly the
moment it becomes a warning. Read-only stays visible despite being a supported
deployment rather than a fault, because it still means this browser cannot lock keepers
in.

**Offline/error handling degrades to last-known state, not "no lock info."** A failed
fetch (`state.syncStatus = 'error'`, "Sync · offline" badge) must not make a
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
