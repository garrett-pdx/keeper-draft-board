import { sleeper } from '../api/sleeper';
import { loadKeepersFromStorage, LS_LEAGUE_ID, LS_SEASON, state } from '../state';
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
  try {
    const league = await sleeper.league(idRaw);
    if (!league || !league.league_id) {
      throw new Error('not found');
    }
    localStorage.setItem(LS_LEAGUE_ID, idRaw);
    localStorage.setItem(LS_SEASON, season);
    state.leagueId = idRaw;
    state.season = season;
    enterApp();
  } catch {
    showSetupError(
      "Couldn't find that league. Double check the ID and that the league is public/accessible.",
    );
  } finally {
    btn.disabled = false;
    btn.querySelector('span')!.textContent = 'Load League';
  }
}

export function showSetupScreen(): void {
  $('#app')!.style.display = 'none';
  $('#setupScreen')!.style.display = 'flex';
  const savedId = localStorage.getItem(LS_LEAGUE_ID);
  if (savedId) ($('#leagueIdInput') as HTMLInputElement).value = savedId;
  const savedSeason = localStorage.getItem(LS_SEASON);
  if (savedSeason) ($('#seasonInput') as HTMLSelectElement).value = savedSeason;
}

export function enterApp(): void {
  $('#setupScreen')!.style.display = 'none';
  $('#app')!.style.display = 'flex';
  loadKeepersFromStorage();
  loadRosters(false);
}
