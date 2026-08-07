// Tab switching, and the freshness policy that decides whether viewing a tab
// re-loads it.
//
// Its own module because two entry points need it — main.ts wires the tab bar,
// setup.ts loads the rosters tab on entering a league — and routing that
// through main.ts would make setup.ts import its own importer.
import { isTabStale } from '../refresh';
import { state } from '../state';
import { $, $all, setSpin } from './dom';
import { loadBoard } from './board';
import { loadDraft } from './draft';
import { loadRosters } from './rosters';
import { renderSettings } from './settings';

export type TabName = 'rosters' | 'draft' | 'board' | 'settings';

const DATA_TABS = {
  rosters: { loadedAt: () => state.rostersLoadedAt, load: loadRosters },
  draft: { loadedAt: () => state.draftLoadedAt, load: loadDraft },
  board: { loadedAt: () => state.boardLoadedAt, load: loadBoard },
} as const;

type DataTab = keyof typeof DATA_TABS;

function isDataTab(tab: TabName): tab is DataTab {
  return tab !== 'settings';
}

/** Spinner lives on the tab button itself — feedback where the click landed. */
function setTabLoading(tab: DataTab, on: boolean): void {
  setSpin(`spin-${tab}`, on);
  $(`.tab-btn[data-tab="${tab}"]`)?.classList.toggle('loading', on);
}

/** Load one data tab, showing its spinner for the duration. */
export async function loadTab(tab: DataTab, force = false): Promise<void> {
  setTabLoading(tab, true);
  try {
    await DATA_TABS[tab].load(force);
  } finally {
    setTabLoading(tab, false);
  }
}

export function switchTab(tab: TabName): void {
  $all('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#panel-rosters')!.classList.toggle('active', tab === 'rosters');
  $('#panel-draft')!.classList.toggle('active', tab === 'draft');
  $('#panel-board')!.classList.toggle('active', tab === 'board');
  $('#panel-settings')!.classList.toggle('active', tab === 'settings');

  if (tab === 'settings') {
    renderSettings();
    return;
  }
  if (!isDataTab(tab)) return;
  // Not forced: the ensure* loaders keep their own caches, so this refreshes
  // the cheap Sleeper calls (rosters, users, draft order) while leaving the
  // multi-megabyte player dictionary and the ADP snapshot on their own TTLs.
  if (isTabStale(DATA_TABS[tab].loadedAt())) void loadTab(tab, false);
}
