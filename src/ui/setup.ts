import { sleeper } from '../api/sleeper';
import type { SleeperLeague } from '../api/schemas';
import {
  loadKeepersFromStorage,
  loadRulesFromStorage,
  LS_LEAGUE_ID,
  LS_SEASON,
  LS_USERNAME,
  state,
} from '../state';
import { $, el } from './dom';
import { loadRosters } from './rosters';

export function initSeasonOptions(): void {
  const sel = $('#seasonInput') as HTMLSelectElement;
  const now = new Date();
  const currentGuess = now.getFullYear();
  for (let y = currentGuess + 1; y >= currentGuess - 3; y--) {
    sel.appendChild(el('option', { value: String(y) }, String(y)));
  }
  sel.value = String(currentGuess);
}

function showSetupError(msg: string): void {
  const box = $('#setupError')!;
  box.textContent = msg;
  box.style.display = 'block';
}
function hideSetupError(): void {
  $('#setupError')!.style.display = 'none';
}

export function toggleManualEntry(show?: boolean): void {
  const manual = $('#manualIdField')!;
  const isHidden = manual.hasAttribute('hidden');
  const next = show ?? isHidden;
  manual.toggleAttribute('hidden', !next);
}

// Shared by the picker's "Load League" button and the manual-entry "Load League"
// button, so both paths validate/persist/enter identically.
async function commitLeagueAndEnter(leagueId: string, season: string): Promise<void> {
  hideSetupError();
  try {
    const league = await sleeper.league(leagueId);
    if (!league || !league.league_id) {
      throw new Error('not found');
    }
    localStorage.setItem(LS_LEAGUE_ID, leagueId);
    localStorage.setItem(LS_SEASON, season);
    state.leagueId = leagueId;
    state.season = season;
    enterApp();
  } catch {
    showSetupError("Couldn't load that league. Double check it's public/accessible.");
  }
}

export async function handleLoadLeague(): Promise<void> {
  const idRaw = ($('#leagueIdInput') as HTMLInputElement).value.trim();
  const season = ($('#seasonInput') as HTMLSelectElement).value;
  hideSetupError();
  if (!/^[0-9]+$/.test(idRaw)) {
    showSetupError('League ID should be a numeric ID from your Sleeper league URL.');
    return;
  }
  const btn = $('#loadLeagueBtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.querySelector('span')!.textContent = 'Checking league…';
  await commitLeagueAndEnter(idRaw, season);
  btn.disabled = false;
  btn.querySelector('span')!.textContent = 'Load League';
}

function populateLeaguePicker(leagues: SleeperLeague[]): void {
  const sel = $('#leaguePickerSelect') as HTMLSelectElement;
  sel.replaceChildren();
  leagues.forEach((lg) => {
    const label = lg.total_rosters
      ? `${lg.name || 'Unnamed League'} (${lg.total_rosters} teams)`
      : lg.name || 'Unnamed League';
    sel.appendChild(el('option', { value: lg.league_id }, label));
  });
}

export async function handleFindLeagues(): Promise<void> {
  const username = ($('#usernameInput') as HTMLInputElement).value.trim();
  const season = ($('#seasonInput') as HTMLSelectElement).value;
  hideSetupError();
  $('#leaguePickerField')!.setAttribute('hidden', '');
  if (!username) {
    showSetupError('Enter your Sleeper username.');
    return;
  }
  const btn = $('#findLeaguesBtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.querySelector('span')!.textContent = 'Looking up…';
  try {
    const user = await sleeper.userByUsername(username);
    if (!user) {
      showSetupError(
        `No Sleeper user found for "${username}". Check the spelling, or paste a league ID directly below.`,
      );
      toggleManualEntry(true);
      return;
    }
    const leagues = await sleeper.leaguesForUser(user.user_id, season);
    if (leagues.length === 0) {
      showSetupError(
        `No ${season} leagues found for "${username}". Try a different season, or paste a league ID directly below.`,
      );
      toggleManualEntry(true);
      return;
    }
    populateLeaguePicker(leagues);
    localStorage.setItem(LS_USERNAME, username);
    $('#leaguePickerField')!.removeAttribute('hidden');
  } catch {
    showSetupError('Could not reach Sleeper. Check your connection and try again.');
    toggleManualEntry(true);
  } finally {
    btn.disabled = false;
    btn.querySelector('span')!.textContent = 'Find My Leagues';
  }
}

export async function handleConfirmLeague(): Promise<void> {
  const sel = $('#leaguePickerSelect') as HTMLSelectElement;
  const leagueId = sel.value;
  const season = ($('#seasonInput') as HTMLSelectElement).value;
  if (!leagueId) return;
  await commitLeagueAndEnter(leagueId, season);
}

export function showSetupScreen(): void {
  $('#app')!.style.display = 'none';
  $('#setupScreen')!.style.display = 'flex';
  const savedId = localStorage.getItem(LS_LEAGUE_ID);
  if (savedId) ($('#leagueIdInput') as HTMLInputElement).value = savedId;
  const savedSeason = localStorage.getItem(LS_SEASON);
  if (savedSeason) ($('#seasonInput') as HTMLSelectElement).value = savedSeason;
  const savedUsername = localStorage.getItem(LS_USERNAME);
  if (savedUsername) ($('#usernameInput') as HTMLInputElement).value = savedUsername;
}

export function enterApp(): void {
  $('#setupScreen')!.style.display = 'none';
  $('#app')!.style.display = 'flex';
  loadKeepersFromStorage();
  loadRulesFromStorage();
  loadRosters(false);
}
