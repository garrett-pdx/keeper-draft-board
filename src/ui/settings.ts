import { DEFAULT_LEAGUE_RULES } from '../types';
import { state, updateRules } from '../state';
import { $ } from './dom';
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
}

function handleMaxKeepersChange(): void {
  const input = $('#maxKeepersInput') as HTMLInputElement;
  const value = Math.min(4, Math.max(1, Math.round(Number(input.value) || DEFAULT_LEAGUE_RULES.maxKeepers)));
  input.value = String(value);
  updateRules({ maxKeepers: value });
  rerenderLoadedTabs();
}

function handleInflationRoundsChange(): void {
  const input = $('#inflationRoundsInput') as HTMLInputElement;
  const value = Math.max(0, Math.round(Number(input.value) || 0));
  input.value = String(value);
  updateRules({ inflationRounds: value });
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
  $('#resetRulesBtn')!.addEventListener('click', handleResetRules);
}
