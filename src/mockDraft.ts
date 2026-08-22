// Stateful glue for the Draft Board's mock draft — the only module that
// imports both domain/mockDraft.ts and ui/board.ts/ui/mockDraftPicker.ts, and
// the only one that reads/writes state.mockDraft directly. Local-only
// practice tool; never touches the shared Gist (see MockDraftState's doc
// comment in state.ts).
import {
  buildMockDraftSlots,
  filterByRemainingNeeds,
  filterByPositionCaps,
  filterBenchQbTe,
  type MockDraftSlot,
} from './domain/mockDraft';
import { samplePlayer, seededRoll, ROLL_PICK } from './domain/draftAi';
import { orderRosterIdsBySlot, reconcileOrder } from './domain/draftOrder';
import { pickHolder } from './domain/tradedPicks';
import {
  keepersInCellFor,
  mockDraftAvailablePlayerIds,
  mockDraftDedicatedStarters,
  mockDraftDoubleUpAllowedFor,
  mockDraftPositionCaps,
  mockDraftRemainingPicksFor,
  mockDraftRoundWeights,
  rosterPositionCountsFor,
} from './selectors';
import {
  clearMockDraft,
  loadMockDraftFromStorage,
  myRosterId,
  saveMockDraft,
  state,
} from './state';
import { renderBoard } from './ui/board';
import { closeMockDraftPicker, openMockDraftPicker } from './ui/mockDraftPicker';
import { $ } from './ui/dom';

export function currentSlot(): MockDraftSlot | null {
  if (!state.mockDraft) return null;
  const idx = state.mockDraft.picks.findIndex((p) => p === null);
  return idx === -1 ? null : state.mockDraft.slots[idx];
}

export function isMyTurn(): boolean {
  const slot = currentSlot();
  return !!slot && !!state.mockDraft && slot.rosterId === state.mockDraft.claimedRosterId;
}

/**
 * True once a mock draft's frozen snapshot no longer matches the league it
 * was started against — either a roster it was built around is gone (a
 * commissioner added/removed a team), or the draft's round count changed
 * underneath it.
 *
 * The round check matters because board.ts renders `1..state.boardRounds`
 * (live) rather than the frozen `rounds`: if the draft shrank, tail-round
 * mock picks would silently vanish from the grid while their players stayed
 * unavailable in the picker — a confusing half-state. A missing/unknown
 * `boardRounds` is not treated as a mismatch, since that's a failed load
 * rather than a real change.
 *
 * Never repaired automatically — board.ts shows a banner and this blocks
 * advance()/the picker until Reset.
 */
export function mockDraftMismatch(): boolean {
  if (!state.mockDraft) return false;
  const currentIds = new Set(state.rosters.map((r) => r.roster_id));
  if (state.mockDraft.slotOrderRosterIds.some((id) => !currentIds.has(id))) return true;
  return !!state.boardRounds && state.boardRounds !== state.mockDraft.rounds;
}

/**
 * The order this mock draft's picks run in, resolved once at Start.
 *
 * Reads the board's own column order, because until Sleeper publishes a real
 * draft order those columns *are* the only order there is — a manager who
 * drags themselves from 3rd to 5th is saying which slot they want to practice
 * from, and deriving the order from `state.draft` alone ignored that entirely
 * (issue #3: the mock kept running in roster_id order).
 *
 * There is no divergence to fear once the real order IS known: the board is
 * un-draggable then (isBoardOrderLocked) and ensureBoardOrder pins
 * state.boardOrder to orderRosterIdsBySlot, so both sources agree. What
 * protects an in-progress simulation isn't ignoring boardOrder, it's that this
 * runs exactly once and the result is snapshotted into slotOrderRosterIds,
 * never read live — plus board.ts refusing to reorder columns at all while a
 * mock draft exists.
 */
function frozenSlotOrder(rosterIds: number[]): number[] {
  const natural = orderRosterIdsBySlot(state.draft, rosterIds.map(String));
  const board = (state.boardOrder || []).filter((id) => natural.includes(id));
  // Unreachable from the board tab (loadBoard calls ensureBoardOrder before
  // rendering the Start button), but a mock draft must never run on an empty
  // pick order.
  if (!board.length) return natural.map(Number);
  return reconcileOrder(board, natural).map(Number);
}

export function startMockDraft(): void {
  const claimedRosterId = myRosterId();
  if (claimedRosterId === null || !state.rosters.length) return; // Start button is disabled in this case
  const rosterIds = state.rosters.map((r) => r.roster_id);
  const slotOrderRosterIds = frozenSlotOrder(rosterIds);
  const rounds = state.boardRounds || 0;
  const trades = state.tradedPicks || [];
  const slots = buildMockDraftSlots(
    rounds,
    slotOrderRosterIds,
    (round, seatRosterId) => pickHolder(trades, round, seatRosterId),
    keepersInCellFor,
  );
  state.mockDraft = {
    active: true,
    rounds,
    slotOrderRosterIds,
    claimedRosterId,
    // The one non-deterministic input, drawn here in the glue layer so the
    // domain/selectors layers stay pure functions of it. Stored rather than
    // derived from the league id, so a Reset produces a genuinely different
    // draft instead of replaying the same one.
    seed: Math.floor(Math.random() * 0x7fffffff),
    slots,
    picks: slots.map(() => null),
  };
  saveMockDraft();
  advance();
}

export function resetMockDraft(): void {
  if (!window.confirm('Reset your mock draft? This clears every pick made so far.')) return;
  closeMockDraftPicker();
  clearMockDraft();
  renderBoard();
}

function roundLabelFor(slot: MockDraftSlot): string {
  // Counts this pick plus any immediately-following open slots for the same
  // roster/round — a heads-up shown on the FIRST of the run; by the second,
  // `remaining` is back to 1 and the label reads like any other ordinary turn.
  // Now that picks are sequenced by seat, this only fires when a roster holds
  // two ADJACENT seats in a round (it bought its neighbour's pick); a pick
  // bought from further down the order is separated by the teams in between,
  // so the label correctly stays at "Your Pick".
  const remaining = remainingSlotStreakForRoster(slot.rosterId);
  return remaining > 1
    ? `Round ${slot.round} — Your Pick (${remaining} in a row)`
    : `Round ${slot.round} — Your Pick`;
}

function remainingSlotStreakForRoster(rosterId: number): number {
  if (!state.mockDraft) return 1;
  const idx = state.mockDraft.picks.findIndex((p) => p === null);
  if (idx === -1) return 1;
  const round = state.mockDraft.slots[idx].round;
  let count = 0;
  for (let i = idx; i < state.mockDraft.slots.length; i++) {
    const s = state.mockDraft.slots[i];
    if (s.round !== round || s.rosterId !== rosterId) break;
    if (state.mockDraft.picks[i] !== null) break;
    count++;
  }
  return count;
}

/**
 * Runs synchronously to completion of the current AI streak in a single JS
 * tick (at most ~team-count × rounds iterations — trivial), which is exactly
 * why "no time limit" needs no setTimeout/animation machinery: every call
 * either lands on the user's turn or finishes before yielding control back
 * to the browser, so there's no mid-AI-run moment to pause or resume around.
 *
 * `openPicker` (default true) controls whether landing on the user's turn
 * automatically pops the picker open — true for a live transition within
 * this session (Start, or right after the user's own pick), false for a cold
 * page-load resume (see resumeMockDraft), so refreshing the page to glance
 * at the board doesn't shove a modal in the user's face.
 */
export function advance(openPicker = true): void {
  if (!state.mockDraft?.active || mockDraftMismatch()) return;
  while (true) {
    const idx = state.mockDraft.picks.findIndex((p) => p === null);
    if (idx === -1) {
      state.mockDraft.active = false;
      saveMockDraft();
      closeMockDraftPicker();
      renderBoard();
      return;
    }
    const slot = state.mockDraft.slots[idx];
    if (slot.rosterId === state.mockDraft.claimedRosterId) {
      saveMockDraft();
      renderBoard();
      if (openPicker) openMockDraftPicker(roundLabelFor(slot), makeUserPick);
      return;
    }
    const available = mockDraftAvailablePlayerIds();
    // Three AI-only pool filters, applied in order, followed by a weighted
    // sample rather than plain best-player-available — never applied to the
    // manager's own pick (the picker always shows the full, unfiltered
    // list). Each filter falls back to the pool it was handed when it comes
    // back empty, since a pick has to happen either way:
    //  1. Endgame slots — DEF/K are held out entirely until they're all this
    //     roster has left to take, so they land on its final picks. Runs
    //     FIRST so that once it narrows the pool to defenses/kickers, the
    //     other two (both no-ops on those positions) can't widen it again.
    //  2. Position cap — never more than N of a position, where QB/TE are
    //     capped at twice what the league actually starts. This is now the
    //     tail-truncator on the sampler below: nothing about weighted
    //     sampling stops a long streak of QB rolls on its own.
    //  3. Bench QB/TE gate — a 2nd QB or 2nd TE waits until every starting
    //     slot (DEF/K aside) can be filled. RB/WR are deliberately never
    //     gated: while slots remain an extra one is filling a FLEX, and once
    //     they're full the rule is a no-op anyway. Under Mudd's tendency
    //     quorum (see selectors.ts's mockDraftDoubleUpAllowedFor) this gate
    //     is a per-manager coin flip rather than a hard league-wide rule;
    //     everywhere else it's exactly the rule it's always been.
    //  4. samplePlayer — weighted-random among the top few survivors by
    //     market rank, leaning toward this round's observed positional mix
    //     (flat/no lean outside Mudd's tendency quorum — see
    //     mockDraftRoundWeights). Replaces strict best-player-available so
    //     mock drafts vary run to run instead of being byte-identical from
    //     the same board; the top-N window keeps it from ever reaching for a
    //     player the market itself doesn't have near the top.
    const playersMap = state.playersMap || {};
    const positionOf = (pid: string) => playersMap[pid]?.pos;
    const counts = rosterPositionCountsFor(slot.rosterId);
    const rosterPositions = state.league?.roster_positions;

    const endgame = filterByRemainingNeeds(
      available,
      positionOf,
      counts,
      rosterPositions,
      mockDraftRemainingPicksFor(slot.rosterId),
    );
    const endgamePool = endgame.length ? endgame : available;
    const capped = filterByPositionCaps(endgamePool, positionOf, counts, mockDraftPositionCaps());
    const cappedPool = capped.length ? capped : endgamePool;
    const benched = filterBenchQbTe(
      cappedPool,
      positionOf,
      counts,
      rosterPositions,
      mockDraftDedicatedStarters(),
      mockDraftDoubleUpAllowedFor(slot.rosterId),
    );
    const pool = benched.length ? benched : cappedPool;
    const playerId = samplePlayer(
      pool,
      state.adpMap || {},
      positionOf,
      mockDraftRoundWeights(slot.round),
      seededRoll(state.mockDraft.seed, ROLL_PICK, idx),
    );
    if (playerId === null) {
      // Shouldn't happen in practice — hundreds of players vs. at most a few
      // hundred picks — but never crash on it; just stop where we are.
      state.mockDraft.active = false;
      saveMockDraft();
      closeMockDraftPicker();
      renderBoard();
      return;
    }
    state.mockDraft.picks[idx] = playerId;
  }
}

export function makeUserPick(playerId: string): void {
  if (!state.mockDraft?.active) return;
  const idx = state.mockDraft.picks.findIndex((p) => p === null);
  if (idx === -1) return;
  const slot = state.mockDraft.slots[idx];
  if (slot.rosterId !== state.mockDraft.claimedRosterId) return; // guard: not actually your turn
  if (!mockDraftAvailablePlayerIds().includes(playerId)) return; // guard: stale/double-tap
  state.mockDraft.picks[idx] = playerId;
  saveMockDraft();
  advance(); // reopens/updates the picker in place if the next slot is also yours
}

/** Board.ts's "Make your pick" tap target for a turn the cold-load resume paused on. */
export function openPickerForCurrentTurn(): void {
  const slot = currentSlot();
  if (!slot || !state.mockDraft || slot.rosterId !== state.mockDraft.claimedRosterId) return;
  openMockDraftPicker(roundLabelFor(slot), makeUserPick);
}

/**
 * Called from board.ts's loadBoard() on every entry to the tab. Idempotent:
 * re-derives "paused at your turn" or "complete" purely from the persisted
 * picks array. Deliberately does NOT auto-pop the picker open on a cold
 * reload (see advance()'s openPicker param) — board.ts renders a tappable
 * "Make your pick" indicator (openPickerForCurrentTurn) instead.
 */
export function resumeMockDraft(): void {
  loadMockDraftFromStorage();
  if (!state.mockDraft || !state.mockDraft.active) return;
  if (mockDraftMismatch()) return; // board.ts shows a banner instead
  advance(false);
}

export function wireMockDraftEvents(): void {
  $('#startMockDraftBtn')?.addEventListener('click', startMockDraft);
  $('#resetMockDraftBtn')?.addEventListener('click', resetMockDraft);
}
