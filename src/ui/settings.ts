import { DEFAULT_LEAGUE_RULES } from '../types';
import { suggestedRulesFromLeague } from '../domain/leagueSettings';
import { state, updateRules } from '../state';
import { $, el } from './dom';
import { renderBoard } from './board';
import { renderDraft } from './draft';
import { renderRosters } from './rosters';

function rerenderLoadedTabs(): void {
  renderRosters();
  if (state.adpMap) renderDraft();
  if (state.boardLoadedAt) renderBoard();
}

export function renderSettings(): void {
  ($('#maxKeepersInput') as HTMLInputElement).value = String(state.rules.maxKeepers);
  ($('#inflationRoundsInput') as HTMLInputElement).value = String(state.rules.inflationRounds);
  const noKeeperCostInput = $('#noKeeperCostInput') as HTMLInputElement;
  noKeeperCostInput.checked = state.rules.noKeeperCost;
  ($('#inflationRoundsInput') as HTMLInputElement).disabled = state.rules.noKeeperCost;
  renderSleeperHint();
}

/**
 * Show what Sleeper's own settings say when they disagree with what's set here,
 * and offer to adopt them — rather than silently overwriting a deliberate
 * choice on every load.
 */
function renderSleeperHint(): void {
  const box = $('#sleeperRulesHint')!;
  const suggested = suggestedRulesFromLeague(state.league);
  const differs = Object.entries(suggested).filter(
    ([k, v]) => state.rules[k as keyof typeof state.rules] !== v,
  );
  if (!differs.length) {
    box.setAttribute('hidden', '');
    return;
  }
  box.removeAttribute('hidden');
  box.replaceChildren(
    el(
      'span',
      null,
      `Sleeper has this league at ${differs.map(([k, v]) => `${LABELS[k] ?? k} ${v}`).join(', ')}. `,
    ),
    el(
      'button',
      {
        class: 'btn btn-ghost btn-sm',
        onclick: () => {
          updateRules(suggested);
          renderSettings();
          rerenderLoadedTabs();
        },
      },
      'Use Sleeper’s settings',
    ),
  );
}

const LABELS: Record<string, string> = { maxKeepers: 'max keepers' };

// Each handler re-renders the whole panel rather than just writing back its own
// clamped value: the Sleeper hint depends on the current rules, so editing a
// field has to give it a chance to appear or disappear.
function handleMaxKeepersChange(): void {
  const input = $('#maxKeepersInput') as HTMLInputElement;
  const value = Math.min(
    4,
    Math.max(1, Math.round(Number(input.value) || DEFAULT_LEAGUE_RULES.maxKeepers)),
  );
  updateRules({ maxKeepers: value });
  renderSettings();
  rerenderLoadedTabs();
}

function handleInflationRoundsChange(): void {
  const input = $('#inflationRoundsInput') as HTMLInputElement;
  const value = Math.max(0, Math.round(Number(input.value) || 0));
  updateRules({ inflationRounds: value });
  renderSettings();
  rerenderLoadedTabs();
}

function handleNoKeeperCostChange(): void {
  const input = $('#noKeeperCostInput') as HTMLInputElement;
  updateRules({ noKeeperCost: input.checked });
  renderSettings();
  rerenderLoadedTabs();
}

function handleResetRules(): void {
  updateRules({ ...DEFAULT_LEAGUE_RULES });
  renderSettings();
  rerenderLoadedTabs();
}

export function wireSettingsEvents(): void {
  $('#maxKeepersInput')!.addEventListener('change', handleMaxKeepersChange);
  $('#inflationRoundsInput')!.addEventListener('change', handleInflationRoundsChange);
  $('#noKeeperCostInput')!.addEventListener('change', handleNoKeeperCostChange);
  $('#resetRulesBtn')!.addEventListener('click', handleResetRules);
}
