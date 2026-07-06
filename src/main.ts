import './styles.css';
import { LS_LEAGUE_ID, LS_SEASON, state } from './state';
import { $, $all } from './ui/dom';
import { loadBoard } from './ui/board';
import { loadDraft, renderDraft } from './ui/draft';
import { loadRosters } from './ui/rosters';
import { renderSettings, wireSettingsEvents } from './ui/settings';
import {
  enterApp,
  handleConfirmLeague,
  handleFindLeagues,
  handleLoadLeague,
  initSeasonOptions,
  showSetupScreen,
  toggleManualEntry,
} from './ui/setup';

type TabName = 'rosters' | 'draft' | 'board' | 'settings';

function switchTab(tab: TabName): void {
  $all('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#panel-rosters')!.classList.toggle('active', tab === 'rosters');
  $('#panel-draft')!.classList.toggle('active', tab === 'draft');
  $('#panel-board')!.classList.toggle('active', tab === 'board');
  $('#panel-settings')!.classList.toggle('active', tab === 'settings');
  if (tab === 'draft' && !state.adpMap) {
    loadDraft(false);
  }
  if (tab === 'board' && !state.boardLoadedAt) {
    loadBoard(false);
  }
  if (tab === 'settings') {
    renderSettings();
  }
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

  $all('.tab-btn').forEach((b) =>
    b.addEventListener('click', () => switchTab(b.dataset.tab as TabName)),
  );

  $('#refreshRosters')!.addEventListener('click', () => loadRosters(true));
  $('#refreshDraft')!.addEventListener('click', () => loadDraft(true));
  $('#refreshBoard')!.addEventListener('click', () => loadBoard(true));

  $('#draftSearch')!.addEventListener('input', () => {
    if (state.adpMap) renderDraft();
  });
  $('#draftPosFilter')!.addEventListener('change', () => {
    if (state.adpMap) renderDraft();
  });

  wireSettingsEvents();

  const savedId = localStorage.getItem(LS_LEAGUE_ID);
  const savedSeason = localStorage.getItem(LS_SEASON);
  if (savedId) {
    state.leagueId = savedId;
    state.season = savedSeason || String(new Date().getFullYear());
    enterApp();
  }
}

document.addEventListener('DOMContentLoaded', init);
