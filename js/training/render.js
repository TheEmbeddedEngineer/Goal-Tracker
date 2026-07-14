import { state, trCurrentPlan, trExpandedLogs, trLogKey } from './state.js';
import { trRenderOverview, trRenderOverviewCalendarGrid, trRenderOverviewSelectedDay } from './overview.js';
import { trDeleteLog, trLoadCoreCheckboxForDate, trLoadExtraActivityCheckbox, trLoadLogIntoForm, trLoadStepsCheckboxForDate, trRenderBackCare, trRenderDay, trRenderProgressChart, trSaveCoreLog, trSaveExtraActivity, trSaveLog, trSaveStepsCheck } from './day.js';
import { saveActivePerson, todayStr } from '../core.js';
import { DAY_LABELS_TR, DAY_ORDER, TR_EXTRA_ACTIVITIES } from '../data.js';
import { renderTodayCard, scanDatePickers, sharedSettings } from '../shared.js';

export function trRenderPersonTabs() {
  const el = document.getElementById('trPersonTabs');
  el.innerHTML = `
    <button data-p="p1" class="${state.trActivePerson === 'p1' ? 'active' : ''}">${sharedSettings.p1}</button>
    <button data-p="p2" class="${state.trActivePerson === 'p2' ? 'active' : ''}">${sharedSettings.p2}</button>
  `;
  el.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      state.trActivePerson = b.dataset.p;
      saveActivePerson('trActivePerson', state.trActivePerson);
      const order = (trCurrentPlan() && trCurrentPlan().dayOrder) || DAY_ORDER;
      if (!order.includes(state.trActiveDay)) state.trActiveDay = 'overview';
      state.trActiveVariant = 'gym';
      state.trOverviewSelectedDate = null;
      state.trLogDate = null;
      trRenderAll();
    });
  });
}

export function trRenderDayTabs() {
  const el = document.getElementById('trDayTabs');
  const order = (trCurrentPlan() && trCurrentPlan().dayOrder) || DAY_ORDER;
  el.innerHTML = order.map(d => `<button data-d="${d}" class="${state.trActiveDay === d ? 'active' : ''}">${DAY_LABELS_TR[d]}</button>`).join('');
  el.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => { state.trActiveDay = b.dataset.d; state.trActiveVariant = 'gym'; state.trLogDate = null; trRenderContent(); trUpdateActiveTabStyles(); });
  });
}

function trUpdateActiveTabStyles() {
  document.querySelectorAll('#trDayTabs button').forEach(b => b.classList.toggle('active', b.dataset.d === state.trActiveDay));
}

let trPendingViewLog = null;

export function trRenderContent() {
  const plan = trCurrentPlan();
  const contentEl = document.getElementById('trContent');
  if (!plan) {
    contentEl.innerHTML = `<div class="empty-state">No training plan added for Partner yet.</div>`;
    return;
  }
  if (state.trActiveDay === 'overview') {
    contentEl.innerHTML = trRenderOverview(plan.overview);
    document.getElementById('trOverviewPrevMonthBtn').addEventListener('click', () => {
      state.trOverviewViewedMonth = new Date(state.trOverviewViewedMonth.getFullYear(), state.trOverviewViewedMonth.getMonth() - 1, 1);
      trRenderOverviewCalendarGrid();
    });
    document.getElementById('trOverviewNextMonthBtn').addEventListener('click', () => {
      const now = new Date();
      const nowMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      if (state.trOverviewViewedMonth.getTime() >= nowMonthStart.getTime()) return;
      state.trOverviewViewedMonth = new Date(state.trOverviewViewedMonth.getFullYear(), state.trOverviewViewedMonth.getMonth() + 1, 1);
      trRenderOverviewCalendarGrid();
    });
    trRenderOverviewCalendarGrid();
    trRenderOverviewSelectedDay();
    (TR_EXTRA_ACTIVITIES[state.trActivePerson] || []).forEach(act => {
      const dateInput = document.querySelector(`.extra-activity-date[data-activity="${act}"]`);
      if (dateInput) {
        dateInput.max = todayStr();
        dateInput.value = state.trExtraLogDates[act] || todayStr();
        dateInput.addEventListener('change', () => trLoadExtraActivityCheckbox(act));
      }
      trLoadExtraActivityCheckbox(act);
      const saveBtn = document.querySelector(`.extra-activity-save[data-activity="${act}"]`);
      if (saveBtn) saveBtn.addEventListener('click', () => trSaveExtraActivity(act));
    });
    if (state.trActivePerson === 'p1') {
      const stepsDateInput = document.getElementById('stepsCheckDate');
      if (stepsDateInput) {
        stepsDateInput.max = todayStr();
        stepsDateInput.value = state.trStepsCheckDate || todayStr();
        stepsDateInput.addEventListener('change', trLoadStepsCheckboxForDate);
      }
      trLoadStepsCheckboxForDate();
      const stepsSaveBtn = document.getElementById('stepsCheckSaveBtn');
      if (stepsSaveBtn) stepsSaveBtn.addEventListener('click', trSaveStepsCheck);
    }
  } else if (state.trActiveDay === 'backcare') {
    contentEl.innerHTML = trRenderBackCare(plan.backcare);
    const coreDateInput = document.getElementById('coreLogDate');
    if (coreDateInput) {
      coreDateInput.max = todayStr();
      coreDateInput.value = state.trCoreLogDate || todayStr();
      trLoadCoreCheckboxForDate();
      coreDateInput.addEventListener('change', trLoadCoreCheckboxForDate);
    }
    const coreSaveBtn = document.getElementById('coreSaveBtn');
    if (coreSaveBtn) coreSaveBtn.addEventListener('click', trSaveCoreLog);
  } else {
    const day = plan[state.trActiveDay];
    contentEl.innerHTML = trRenderDay(day, state.trActiveDay);
    const gymBtn = document.getElementById('variantGym');
    const homeBtn = document.getElementById('variantHome');
    if (gymBtn) gymBtn.addEventListener('click', () => { state.trActiveVariant = 'gym'; trRenderContent(); });
    if (homeBtn) homeBtn.addEventListener('click', () => { state.trActiveVariant = 'home'; trRenderContent(); });

    const hasVariants = !!(day.gym && day.home);
    const list = hasVariants ? (state.trActiveVariant === 'gym' ? day.gym : day.home) : day.gym;

    const dateInput = document.getElementById('logDate');
    if (dateInput) {
      dateInput.max = todayStr();
      // state.trLogDate survives re-renders (saves, remote-sync renders, variant
      // switches), so the picked date no longer snaps back to today mid-logging.
      if (trPendingViewLog) state.trLogDate = trPendingViewLog.date;
      dateInput.value = state.trLogDate || todayStr();
      trLoadLogIntoForm(state.trActiveDay, list, state.trActiveVariant);
      dateInput.addEventListener('change', () => {
        state.trLogDate = dateInput.value;
        trLoadLogIntoForm(state.trActiveDay, list, state.trActiveVariant);
      });
    }
    trPendingViewLog = null;

    const saveBtn = document.getElementById('saveLogBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => trSaveLog(state.trActiveDay, list, state.trActiveVariant));

    // Tapping a "last: Xkg" hint copies that weight into the input — repeating last
    // session's weight is the most common case, so make it one tap instead of typing.
    document.querySelectorAll('#trContent .lw-last').forEach(hint => {
      hint.addEventListener('click', () => {
        if (hint.dataset.val === undefined) return;
        const input = document.getElementById(hint.dataset.target);
        if (input) input.value = hint.dataset.val;
        const errEl = document.getElementById('logError');
        if (errEl) errEl.style.display = 'none';
      });
    });
    const weightsWrap = document.getElementById('logWeights');
    if (weightsWrap) weightsWrap.addEventListener('input', () => {
      const errEl = document.getElementById('logError');
      if (errEl) errEl.style.display = 'none';
    });

    const progressSelect = document.getElementById('trProgressExercise');
    if (progressSelect) {
      progressSelect.addEventListener('change', trRenderProgressChart);
      trRenderProgressChart();
    }

    document.querySelectorAll('#trContent .pl-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        trDeleteLog(state.trActiveDay, btn.dataset.date, btn.dataset.variant);
      });
    });
    document.querySelectorAll('#trContent .pl-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const date = btn.dataset.date;
        const variant = btn.dataset.variant;
        if (variant !== state.trActiveVariant) {
          state.trActiveVariant = variant;
          trPendingViewLog = { date };
          trRenderContent();
        } else {
          state.trLogDate = date;
          document.getElementById('logDate').value = date;
          trLoadLogIntoForm(state.trActiveDay, list, state.trActiveVariant);
        }
      });
    });
    document.querySelectorAll('#trContent .pl-header').forEach(header => {
      header.addEventListener('click', () => {
        const row = header.closest('.past-log-row');
        const key = trLogKey(row.dataset.date, row.dataset.variant);
        if (trExpandedLogs.has(key)) trExpandedLogs.delete(key); else trExpandedLogs.add(key);
        trRenderContent();
      });
    });
  }
  // Upgrade any freshly rendered date inputs right away instead of leaving them as
  // bare native pickers until the next 700ms background scan tick.
  scanDatePickers();
}

export function trRenderAll() {
  trRenderPersonTabs();
  trRenderDayTabs();
  trRenderContent();
  renderTodayCard();
}
