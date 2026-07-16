import { TR_STREAK_MIN_LOGS, state, trCurrentPlan, trCurrentStreak, trLogsForDate, trWeekLogCount, ui } from './state.js';
import { trApplyLegacyExerciseRenames, trPushToCloud, trSubscribeToCloud } from './sync.js';
import { trLogStepsFromCounts, trLogStepsIfGoalMet, trLogTennisDates } from './day.js';
import { trRenderAll, trRenderContent, trRenderDayTabs, trRenderPersonTabs } from './render.js';
import { feature, getMonday, register, saveActivePerson, todayStr } from '../core.js';
import { DAY_ORDER, TR_EXTRA_ACTIVITIES } from '../data.js';

function trLoadData() {
  try {
    state.trTrainingLog = JSON.parse(localStorage.getItem('training_log') || '{}');
    state.trTrainingLog.p1 = state.trTrainingLog.p1 || [];
    state.trTrainingLog.p2 = state.trTrainingLog.p2 || [];
  } catch (err) { state.trTrainingLog = { p1: [], p2: [] }; }
  try {
    state.trCoreLog = JSON.parse(localStorage.getItem('training_coreLog') || '{}');
    state.trCoreLog.p1 = state.trCoreLog.p1 || [];
    state.trCoreLog.p2 = state.trCoreLog.p2 || [];
  } catch (err) { state.trCoreLog = { p1: [], p2: [] }; }
  try {
    state.trExtraLog = JSON.parse(localStorage.getItem('training_extraLog') || '{}');
    state.trExtraLog.p1 = state.trExtraLog.p1 || {};
    state.trExtraLog.p2 = state.trExtraLog.p2 || {};
  } catch (err) { state.trExtraLog = { p1: {}, p2: {} }; }
  try {
    state.trStepsCheckLog = JSON.parse(localStorage.getItem('training_stepsCheckLog') || '{}');
    state.trStepsCheckLog.p1 = state.trStepsCheckLog.p1 || [];
    state.trStepsCheckLog.p2 = state.trStepsCheckLog.p2 || [];
  } catch (err) { state.trStepsCheckLog = { p1: [], p2: [] }; }

  const now = new Date();
  state.trOverviewViewedMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  trRenderAll();
  trApplyLegacyExerciseRenames();
  // Training is the last feature to load (see js/app.js order), so all three features'
  // local data is in memory here — first chance to derive the weekly auto-checks.
  feature('weekly').refreshAutoChecks();
}

register('training', {
  loadData: trLoadData,
  subscribe: (code) => trSubscribeToCloud(code),
  renderAll: trRenderAll,
  isDoneToday: (pk) => trLogsForDate(pk, todayStr()).length > 0 || (state.trCoreLog[pk] || []).includes(todayStr())
    || (TR_EXTRA_ACTIVITIES[pk] || []).some(act => ((state.trExtraLog[pk] || {})[act] || []).includes(todayStr()))
    || (pk === 'p1' && (state.trStepsCheckLog.p1 || []).includes(todayStr())),
  // For the weekly tab's Sport auto-check: a logged workout, an extra activity
  // (Tennis/Hyrox/Runs), or the 10k-steps check (p1-only, rule set 2026-07-16 — steps
  // used to be excluded). Core stability alone still doesn't count, and trWeekLogCount
  // (streak/glance) still counts only real sessions.
  isSessionOnDate: (pk, ds) => trLogsForDate(pk, ds).length > 0
    || (TR_EXTRA_ACTIVITIES[pk] || []).some(act => ((state.trExtraLog[pk] || {})[act] || []).includes(ds))
    || (pk === 'p1' && (state.trStepsCheckLog.p1 || []).includes(ds)),
  glanceHtml: () => {
    const pk = state.trActivePerson;
    const n = trWeekLogCount(pk, getMonday(new Date()));
    const streak = trCurrentStreak(pk);
    return `<b>${n}/${TR_STREAK_MIN_LOGS}</b> sessions this week`
      + (streak > 0 ? ` &middot; &#128293;${streak}-wk streak` : '');
  },
  jumpToToday: (pk) => {
    state.trActivePerson = pk;
    saveActivePerson('trActivePerson', pk);
    state.trActiveDay = 'overview';
    state.trOverviewSelectedDate = todayStr();
    state.trLogDate = null;
    trRenderAll();
  },
  setPerson: (pk) => {
    state.trActivePerson = pk;
    saveActivePerson('trActivePerson', pk);
    const order = (trCurrentPlan() && trCurrentPlan().dayOrder) || DAY_ORDER;
    if (!order.includes(state.trActiveDay)) state.trActiveDay = 'overview';
    state.trActiveVariant = 'gym';
    state.trLogDate = null;
    trRenderAll();
  },
  onSettingsChanged: () => { trRenderPersonTabs(); trRenderDayTabs(); trRenderContent(); trPushToCloud(); },
  // Health-ingest entry points (see js/app.js).
  logStepsIfGoalMet: trLogStepsIfGoalMet,
  logStepsFromCounts: trLogStepsFromCounts,
  logTennisDates: trLogTennisDates,
  exportData: () => ({
    trainingLog: state.trTrainingLog, coreLog: state.trCoreLog,
    stepsCheckLog: state.trStepsCheckLog, extraLog: state.trExtraLog
  })
});

// Wire the late-bound slots (see state.js) now that everything is defined.
ui.renderAll = trRenderAll;
ui.renderContent = trRenderContent;
ui.renderDayTabs = trRenderDayTabs;
ui.renderPersonTabs = trRenderPersonTabs;

