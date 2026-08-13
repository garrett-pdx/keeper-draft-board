import { DEFAULT_LEAGUE_RULES, type MarketSource } from '../types';
import { isSuperflexLeague, suggestedRulesFromLeague } from '../domain/leagueSettings';
import { pprLabel } from '../domain/marketValue';
import { state, updateRules } from '../state';
import { ensureAdpLoaded } from '../data';
import { updateAdpSourceBadge } from './header';
import { $, el } from './dom';
import { renderBoard } from './board';
import { renderDraft } from './draft';
import { renderRosters, renderRostersNote } from './rosters';

// One line each on what the source actually measures, since the difference
// between them is the whole reason this setting exists. The MFL hint names its
// two caveats up front — a much smaller sample, and no quarterbacks at all
// (see scripts/fetch-mfl-adp.mjs for why the QBs are dropped).
const MARKET_SOURCE_HINTS: Record<MarketSource, string> = {
  value:
    'How good each player is, from FantasyCalc’s trade values. Steadier than draft data, and matched by exact Sleeper id.',
  adp: 'Where players actually go, averaged over recent mock drafts on Fantasy Football Calculator. Large sample, but nobody drafting has anything at stake.',
  'adp-real':
    'Where players actually go in real, non-mock redraft leagues people paid to host, via MyFantasyLeague. Far fewer drafts than the mock data, and it prices no quarterbacks — that pool mixes 1QB and superflex leagues, so QB is left out rather than shown wrong.',
  blend:
    'The average of all three sources, per player, over whichever of them price him. Smooths out any single source’s bad week, at the cost of not being a measurement of anything in particular.',
};

/** Short names, for describing a source a league is on but can no longer pick. */
const MARKET_SOURCE_LABELS: Record<MarketSource, string> = {
  value: 'FantasyCalc — value ranking',
  adp: 'Fantasy Football Calculator — mock-draft ADP',
  'adp-real': 'MyFantasyLeague — real-league ADP',
  blend: 'Blend — average of all three sources',
};

/**
 * The only two a user picks between: one source, or all of them averaged.
 *
 * The individual ADP sources are deliberately NOT offered. Nothing about them
 * is removed — both are still fetched daily, still validated, still what the
 * blend is built out of, and `ensureAdpLoaded` still falls back to them when a
 * preferred snapshot fails (which is why the header badge and the roster and
 * draft notes all still have branches naming them). Choosing between two crowd
 * ADP feeds by hand was a decision with no good answer; the blend is the answer.
 */
const SELECTABLE_MARKET_SOURCES: MarketSource[] = ['value', 'blend'];

const LEGACY_MARKET_OPTION = 'legacy-market-source';

/**
 * Re-add the league's own source to the dropdown when it isn't one of the two
 * on offer.
 *
 * 'adp' was selectable for months, so a browser that configured this league
 * before today can still have it stored. Rendering only the two current options
 * would leave the select showing "FantasyCalc" while the app was in fact
 * running on FFC's ADP — the UI lying about which source is in use, which is
 * the one thing the market-source code is not allowed to do. So the stored
 * source is shown, marked, and can be switched away from but never back to.
 */
function syncMarketSourceOptions(select: HTMLSelectElement): void {
  select.querySelectorAll(`.${LEGACY_MARKET_OPTION}`).forEach((o) => o.remove());
  const current = state.rules.marketSource;
  if (SELECTABLE_MARKET_SOURCES.includes(current)) return;
  select.appendChild(
    el(
      'option',
      { value: current, class: LEGACY_MARKET_OPTION },
      `${MARKET_SOURCE_LABELS[current]} (no longer offered)`,
    ),
  );
}

async function reloadMarketData(): Promise<void> {
  await ensureAdpLoaded(true);
  updateAdpSourceBadge();
  renderSettings();
  rerenderLoadedTabs();
}

function rerenderLoadedTabs(): void {
  renderRosters();
  // The rosters explainer names the market source, so it goes stale the moment
  // the source changes — it was only ever rendered on the initial load. That
  // was cosmetic while the sources differed in provenance alone; it isn't now,
  // because the MFL sentence is where "quarterbacks aren't priced" is stated.
  renderRostersNote();
  if (state.adpMap) renderDraft();
  if (state.boardLoadedAt) renderBoard();
}

export function renderSettings(): void {
  ($('#maxKeepersInput') as HTMLInputElement).value = String(state.rules.maxKeepers);
  ($('#inflationRoundsInput') as HTMLInputElement).value = String(state.rules.inflationRounds);
  const noKeeperCostInput = $('#noKeeperCostInput') as HTMLInputElement;
  noKeeperCostInput.checked = state.rules.noKeeperCost;
  ($('#inflationRoundsInput') as HTMLInputElement).disabled = state.rules.noKeeperCost;
  const marketSourceInput = $('#marketSourceInput') as HTMLSelectElement;
  syncMarketSourceOptions(marketSourceInput);
  marketSourceInput.value = state.rules.marketSource;
  $('#marketSourceHint')!.textContent = MARKET_SOURCE_HINTS[state.rules.marketSource];
  renderLeagueFacts();
  renderSleeperHint();
}

/**
 * Read-only summary of what was pulled from Sleeper, and which market-data
 * entry it selected as a result.
 *
 * The point is auditability: the app silently makes several inferences from a
 * league's config — superflex-ness, scoring, size — and each one changes the
 * numbers on every other tab. Showing the inputs and the resulting choice side
 * by side means a number that looks wrong can be traced instead of guessed at.
 */
function renderLeagueFacts(): void {
  const box = $('#leagueFacts')!;
  box.replaceChildren();
  const league = state.league;
  if (!league) {
    box.appendChild(el('div', { class: 'setup-hint' }, 'Load a league to see its settings.'));
    return;
  }

  const rec = league.scoring_settings?.rec;
  const superflex = isSuperflexLeague(league.roster_positions);
  const qbSlots = (league.roster_positions || []).filter((slot) => slot === 'QB').length;
  const starters = (league.roster_positions || []).filter((slot) => slot !== 'BN');
  const sleeperMax = league.settings?.max_keepers;

  const facts: Array<[string, string]> = [
    ['League', league.name || '—'],
    ['Season', String(league.season ?? '—')],
    ['Teams', String(state.rosters.length || league.total_rosters || '—')],
    ['Scoring', typeof rec === 'number' ? `${pprLabel(rec)} (${rec} per reception)` : 'unknown'],
    [
      'Quarterbacks',
      superflex
        ? `superflex — ${(league.roster_positions || []).includes('SUPER_FLEX') ? 'SUPER_FLEX slot' : `${qbSlots} QB starters`}`
        : '1 QB',
    ],
    ['Starting lineup', starters.length ? starters.join(', ') : '—'],
    ['Sleeper max keepers', typeof sleeperMax === 'number' ? String(sleeperMax) : 'not set'],
    ['Market data in use', marketDataLabel()],
  ];

  for (const [label, value] of facts) {
    box.appendChild(el('dt', null, label));
    box.appendChild(el('dd', null, value));
  }
}

function marketDataLabel(): string {
  if (!state.adpSource) return 'not loaded yet';
  if (state.adpSource === 'rank') return 'Sleeper rank proxy (no snapshot matched)';
  const which =
    state.adpSource === 'value'
      ? 'FantasyCalc value rank'
      : state.adpSource === 'adp-real'
        ? 'MyFantasyLeague real-league ADP'
        : state.adpSource === 'blend'
          ? 'Blend of all sources'
          : 'Fantasy Football Calculator ADP';
  return state.marketEntryLabel ? `${which} — ${state.marketEntryLabel}` : which;
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

function handleMarketSourceChange(): void {
  const input = $('#marketSourceInput') as HTMLSelectElement;
  const chosen: MarketSource = (['value', 'adp', 'adp-real', 'blend'] as const).includes(
    input.value as MarketSource,
  )
    ? (input.value as MarketSource)
    : 'value';
  updateRules({ marketSource: chosen });
  // The market map itself has to be rebuilt from the other snapshot, so this
  // reloads rather than just re-rendering what's already in memory.
  state.adpMap = null;
  void reloadMarketData();
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
  $('#marketSourceInput')!.addEventListener('change', handleMarketSourceChange);
  $('#resetRulesBtn')!.addEventListener('click', handleResetRules);
}
