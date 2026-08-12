// Stateful glue for the Draft Board's mock draft — the only module that
// imports both domain/mockDraft.ts and ui/board.ts/ui/mockDraftPicker.ts, and
// the only one that reads/writes state.mockDraft directly. Local-only
// practice tool; never touches the shared Gist (see MockDraftState's doc
// comment in state.ts).
import {
  buildMockDraftSlots,
  bestAvailablePlayer,
  filterByPositionCaps,
  filterByStarterPriority,
  type MockDraftSlot,
} from './domain/mockDraft';
import { orderRosterIdsBySlot } from './domain/draftOrder';
import { pickCapacity } from './domain/tradedPicks';
import {
  keepersInCellFor,
  mockDraftAvailablePlayerIds,
  mockDraftPositionCaps,
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
 * True once a mock draft's frozen roster order no longer matches the
 * league's current rosters (a commissioner added/removed a team since
 * Start). Never repaired automatically — board.ts shows a banner and this
 * blocks advance()/the picker until Reset.
 */
export function mockDraftRosterMismatch(): boolean {
  if (!state.mockDraft) return false;
  const currentIds = new Set(state.rosters.map((r) => r.roster_id));
  return state.mockDraft.slotOrderRosterIds.some((id) => !currentIds.has(id));
}

export function startMockDraft(): void {
  const claimedRosterId = myRosterId();
  if (claimedRosterId === null || !state.rosters.length) return; // Start button is disabled in this case
  const rosterIds = state.rosters.map((r) => r.roster_id);
  const slotOrderRosterIds = orderRosterIdsBySlot(
    state.draft,
    rosterIds.map(String),
  ).map(Number);
  const rounds = state.boardRounds || 0;
  const trades = state.tradedPicks || [];
  const slots = buildMockDraftSlots(
    rounds,
    slotOrderRosterIds,
    (round, rosterId) => pickCapacity(trades, round, rosterId),
    keepersInCellFor,
  );
  state.mockDraft = {
    active: true,
    teamCount: state.rosters.length || 10,
    rounds,
    slotOrderRosterIds,
    claimedRosterId,
    slots,
    picks: slots.map(() => null),
    startedAt: new Date().toISOString(),
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
  // roster/round (a roster holding an extra pick that round via trade) — a
  // heads-up shown on the FIRST of the run; by the second, `remaining` is
  // back to 1 and the label reads like any other ordinary turn.
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
  if (!state.mockDraft?.active || mockDraftRosterMismatch()) return;
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
    // Two AI-only heuristics, layered on top of plain best-player-available,
    // never applied to the user's own pick (the picker always shows the
    // full, unfiltered list). Each stage falls back to the previous pool
    // when it empties out, since a pick has to happen either way:
    //  1. Position cap — stop drafting a position once the roster already
    //     has enough to fill its starting slots (FLEX-eligible slots
    //     included) plus a small bench buffer, so BPA can't spiral into a
    //     6th QB or 3rd TE.
    //  2. Starter priority — fill real roster gaps before backups: a 1st
    //     QB/TE before a 5th RB/WR, and a 1st QB before a 2nd TE (and vice
    //     versa) — otherwise a team can legally stay under its position cap
    //     while still front-loading 2-3 QBs in the first few rounds ahead
    //     of any RB/WR.
    const playersMap = state.playersMap || {};
    const positionOf = (pid: string) => playersMap[pid]?.pos;
    const counts = rosterPositionCountsFor(slot.rosterId);
    const capped = filterByPositionCaps(available, positionOf, counts, mockDraftPositionCaps());
    const cappedPool = capped.length ? capped : available;
    const prioritized = filterByStarterPriority(cappedPool, positionOf, counts);
    const playerId = bestAvailablePlayer(
      prioritized.length ? prioritized : cappedPool,
      state.adpMap || {},
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
  if (mockDraftRosterMismatch()) return; // board.ts shows a banner instead
  advance(false);
}

export function wireMockDraftEvents(): void {
  $('#startMockDraftBtn')?.addEventListener('click', startMockDraft);
  $('#resetMockDraftBtn')?.addEventListener('click', resetMockDraft);
}
