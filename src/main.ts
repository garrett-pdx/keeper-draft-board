import './styles.css';
import { LS_LEAGUE_ID, LS_SEASON, state } from './state';
import { $, $all, setSpin } from './ui/dom';
import { refreshAll } from './refresh';
import { withBusy } from './ui/overlay';
import { loadBoard } from './ui/board';
import { loadDraft, renderDraft } from './ui/draft';
import { loadRosters, rerenderAfterKeeperChange } from './ui/rosters';
import { openClaimPicker } from './ui/keeperControls';
import { wireMockDraftEvents } from './mockDraft';
import { wireSettingsEvents } from './ui/settings';
import { wireMarketSourceMenu } from './ui/marketSourceMenu';
import { switchTab, type TabName } from './ui/tabs';
import {
  enterApp,
  handleConfirmLeague,
  handleFindLeagues,
  handleLoadLeague,
  initSeasonOptions,
  showSetupScreen,
  toggleManualEntry,
} from './ui/setup';

async function handleRefreshAll(): Promise<void> {
  const btn = $('#refreshAllBtn') as HTMLButtonElement;
  btn.disabled = true;
  setSpin('refreshAllSpin', true);
  try {
    const failed = await withBusy('Refreshing everything…', () =>
      refreshAll({ rosters: loadRosters, draft: loadDraft, board: loadBoard }),
    );
    // Each tab renders its own error banner, so there's nothing to add when
    // everything worked — but a partial refresh is worth saying out loud, or
    // the untouched tabs quietly look as fresh as the rest.
    if (failed.length) {
      showRefreshWarning(`Couldn’t refresh: ${failed.join(', ')}. Everything else is up to date.`);
    } else {
      clearRefreshWarning();
    }
  } finally {
    setSpin('refreshAllSpin', false);
    btn.disabled = false;
  }
}

function showRefreshWarning(message: string): void {
  const box = $('#refreshWarning')!;
  box.textContent = message;
  box.removeAttribute('hidden');
}

function clearRefreshWarning(): void {
  $('#refreshWarning')!.setAttribute('hidden', '');
}

function init(): void {
  initSeasonOptions();
  showSetupScreen();

  $('#loadLeagueBtn')!.addEventListener('click', handleLoadLeague);
  $('#leagueIdInput')!.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') handleLoadLeague();
  });

  $('#findLeaguesBtn')!.addEventListener('click', handleFindLeagues);
  $('#usernameInput')!.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') handleFindLeagues();
  });
  $('#confirmLeagueBtn')!.addEventListener('click', handleConfirmLeague);
  $('#toggleManualEntry')!.addEventListener('click', (e) => {
    e.preventDefault();
    toggleManualEntry();
  });

  $('#changeLeagueBtn')!.addEventListener('click', () => {
    showSetupScreen();
  });

  // The identity badge is where you find out which team you're acting as, so
  // make it the way to change that — it opens the picker in place on the
  // Rosters tab rather than sending anyone hunting through Settings.
  $('#identityBadge')!.addEventListener('click', () => {
    openClaimPicker();
    switchTab('rosters');
    rerenderAfterKeeperChange();
  });

  $all('.tab-btn').forEach((b) =>
    b.addEventListener('click', () => switchTab(b.dataset.tab as TabName)),
  );

  $('#refreshAllBtn')!.addEventListener('click', handleRefreshAll);

  $('#draftSearch')!.addEventListener('input', () => {
    if (state.adpMap) renderDraft();
  });
  $('#draftPosFilter')!.addEventListener('change', () => {
    if (state.adpMap) renderDraft();
  });
  $('#draftHideKept')!.addEventListener('change', () => {
    if (state.adpMap) renderDraft();
  });

  wireSettingsEvents();
  wireMarketSourceMenu();
  wireMockDraftEvents();

  const savedId = localStorage.getItem(LS_LEAGUE_ID);
  const savedSeason = localStorage.getItem(LS_SEASON);
  if (savedId) {
    state.leagueId = savedId;
    state.season = savedSeason || String(new Date().getFullYear());
    enterApp();
  }
}

document.addEventListener('DOMContentLoaded', init);
