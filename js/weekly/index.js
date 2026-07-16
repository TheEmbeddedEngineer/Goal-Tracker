import { CATS, state, ui } from './state.js';
import { wkApplyFrozenFixes, wkPushToCloud, wkSubscribeToCloud } from './sync.js';
import { wkCatCountsForWeek, wkCurrentStreak, wkLoadCheckboxesForDate, wkRefreshAutoChecks, wkRenderAll, wkRenderPersonTabs, wkThresholdsForWeek } from './ui.js';
import { getMonday, register, saveActivePerson, todayStr } from '../core.js';

function wkLoadData() {
  try { state.wkEntries = JSON.parse(localStorage.getItem('entries') || '{}'); } catch (err) { state.wkEntries = {}; }
  try {
    const s = localStorage.getItem('settings');
    if (s) { const parsed = JSON.parse(s); state.wkThresholds = parsed.thresholds || state.wkThresholds; }
  } catch (err) {}
  try { state.wkWeeklyThresholds = JSON.parse(localStorage.getItem('weeklyThresholds') || '{}'); } catch (err) { state.wkWeeklyThresholds = {}; }

  document.getElementById('thNutrition').value = state.wkThresholds.nutrition;
  document.getElementById('thScreen').value = state.wkThresholds.screen;
  document.getElementById('thSport').value = state.wkThresholds.sport;
  document.getElementById('wkDatePicker').value = todayStr();
  document.getElementById('wkDatePicker').max = todayStr();

  state.wkViewedWeekMonday = getMonday(new Date());

  wkRenderPersonTabs();
  wkLoadCheckboxesForDate();
  wkRenderAll();
  wkApplyFrozenFixes();
}

register('weekly', {
  loadData: wkLoadData,
  subscribe: (code) => wkSubscribeToCloud(code),
  renderAll: wkRenderAll,
  // At least one category actually checked — since toggles auto-save, a mere
  // toggled-on-then-off day exists as an all-false entry and shouldn't show ✓.
  isDoneToday: (pk) => {
    const day = (state.wkEntries[pk] || {})[todayStr()];
    return !!day && Object.values(day).some(Boolean);
  },
  glanceHtml: () => {
    const pk = state.wkActivePerson;
    const monday = getMonday(new Date());
    const counts = wkCatCountsForWeek(pk, monday);
    const th = wkThresholdsForWeek(monday);
    const streak = wkCurrentStreak(pk);
    return CATS.map(([k, label]) => `${label.split(' ')[0]} <b>${counts[k]}/${th[k]}</b>`).join(' &middot; ')
      + (streak > 0 ? ` &middot; &#128293;${streak}` : '');
  },
  jumpToToday: (pk) => {
    state.wkActivePerson = pk;
    saveActivePerson('wkActivePerson', pk);
    state.wkViewedWeekMonday = getMonday(new Date());
    document.getElementById('wkDatePicker').value = todayStr();
    wkRenderPersonTabs();
    wkLoadCheckboxesForDate();
    wkRenderAll();
  },
  setPerson: (pk) => {
    state.wkActivePerson = pk;
    saveActivePerson('wkActivePerson', pk);
    wkRenderPersonTabs();
    wkLoadCheckboxesForDate();
    wkRenderAll();
  },
  onSettingsChanged: () => { wkRenderPersonTabs(); wkRenderAll(); wkPushToCloud(); },
  // Called by calories/training (via the registry) whenever their day data changes —
  // NOT from weekly's own loadData, which runs before the other features have loaded.
  refreshAutoChecks: wkRefreshAutoChecks,
  exportData: () => ({ entries: state.wkEntries, weeklyThresholds: state.wkWeeklyThresholds })
});

// Wire the late-bound slots (see state.js) now that everything is defined.
ui.loadCheckboxesForDate = wkLoadCheckboxesForDate;
ui.refreshAutoChecks = wkRefreshAutoChecks;
ui.renderAll = wkRenderAll;
ui.renderPersonTabs = wkRenderPersonTabs;

