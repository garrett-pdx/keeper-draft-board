import { canReadShared, canWriteShared, gistId, LS_GIST_ID, LS_GIST_TOKEN } from '../api/gist';
import { DEFAULT_LEAGUE_RULES } from '../types';
import { setCurrentUserId, state, teamNameForRoster, updateRules } from '../state';
import { ensureSharedKeepersLoaded } from '../sync';
import { $, el } from './dom';
import { renderBoard } from './board';
import { renderDraft } from './draft';
import { updateIdentityBadge, updateSyncBadge } from './header';
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
  renderSyncSettings();
}

// ---------- league keeper sharing ----------

export function renderSyncSettings(): void {
  const blurb = $('#syncBlurb')!;
  blurb.textContent = !canReadShared()
    ? 'Not set up yet. Paste a Gist ID below to share keeper picks with your league — everyone who enters the same ID sees the same locked-in keepers.'
    : canWriteShared()
      ? 'On. Pick your team below, then star your keepers on the Rosters tab and hit “Save & lock keepers”. Everyone else sees them as locked.'
      : 'Read-only. You can see the league’s locked keepers, but saving your own needs a write token.';

  const select = $('#identitySelect') as HTMLSelectElement;
  select.replaceChildren();
  select.appendChild(el('option', { value: '' }, 'Not set'));
  // Ordered by team name so the list is scannable; the value is the owner's
  // user_id, since that's what roster ownership is matched on.
  const claimed = state.rosters
    .filter((r) => r.owner_id)
    .map((r) => ({ userId: r.owner_id!, name: teamNameForRoster(r.roster_id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  claimed.forEach((t) => select.appendChild(el('option', { value: t.userId }, t.name)));
  select.value = state.currentUserId || '';
  select.disabled = !state.rosters.length;

  ($('#gistIdInput') as HTMLInputElement).value = localStorage.getItem(LS_GIST_ID) || '';
  ($('#gistIdInput') as HTMLInputElement).placeholder = gistId() || 'Gist ID';
  ($('#gistTokenInput') as HTMLInputElement).value = localStorage.getItem(LS_GIST_TOKEN) || '';
}

function handleIdentityChange(): void {
  const select = $('#identitySelect') as HTMLSelectElement;
  setCurrentUserId(select.value || null);
  // Changing who you are changes which team is editable and whether an
  // in-progress edit still belongs to you, so drop any open edit.
  state.editingRosterId = null;
  updateIdentityBadge();
  renderSyncSettings();
  rerenderLoadedTabs();
}

async function handleSaveSyncConfig(): Promise<void> {
  const id = ($('#gistIdInput') as HTMLInputElement).value.trim();
  const token = ($('#gistTokenInput') as HTMLInputElement).value.trim();
  // Blank clears the override so the value baked in at build time takes over
  // again, rather than pinning an empty string.
  if (id) localStorage.setItem(LS_GIST_ID, id);
  else localStorage.removeItem(LS_GIST_ID);
  if (token) localStorage.setItem(LS_GIST_TOKEN, token);
  else localStorage.removeItem(LS_GIST_TOKEN);

  const btn = $('#saveSyncConfigBtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Checking…';
  await ensureSharedKeepersLoaded();
  btn.disabled = false;
  btn.textContent = 'Save sharing settings';
  updateSyncBadge();
  updateIdentityBadge();
  renderSyncSettings();
  rerenderLoadedTabs();
}

// ---------- league rules ----------

function handleMaxKeepersChange(): void {
  const input = $('#maxKeepersInput') as HTMLInputElement;
  const value = Math.min(
    4,
    Math.max(1, Math.round(Number(input.value) || DEFAULT_LEAGUE_RULES.maxKeepers)),
  );
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
  $('#identitySelect')!.addEventListener('change', handleIdentityChange);
  $('#saveSyncConfigBtn')!.addEventListener('click', handleSaveSyncConfig);
}
