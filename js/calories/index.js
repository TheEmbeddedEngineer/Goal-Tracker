import { calDayItems, calDayTotals, calGoalsForDay, calRefreshTopFoodsCache, state, ui } from './state.js';
import { calEntriesCollectionQuery, calPushToCloud, calSubscribeToCloud, calSubscribeToEntriesCloud } from './sync.js';
import { calPopulateCategorySelect, calRenderLogCard, calRenderRecentChips } from './log.js';
import { calCumulativeDeficit, calPopulateGoalsInputs, calRenderBurnCard, calRenderDeficitCard, calRenderWeightCard } from './metrics.js';
import { calRenderFoodBankList } from './bank.js';
import { calRenderMonth, calRenderRecap, calRenderTrendChart } from './insights.js';
import { calRound2, confirmWipe, coupleCode, deleteDoc, ensureAuth, getDocs, register, saveActivePerson, setSyncStatus, todayStr } from '../core.js';
import { renderGlanceBar, renderTodayCard, sharedSettings } from '../shared.js';

function calRenderPersonTabs() {
  const tabs = document.getElementById('calPersonTabs');
  tabs.innerHTML = `
    <button data-p="p1" class="${state.calActivePerson==='p1'?'active':''}">${sharedSettings.p1}</button>
    <button data-p="p2" class="${state.calActivePerson==='p2'?'active':''}">${sharedSettings.p2}</button>
  `;
  tabs.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      state.calActivePerson = b.dataset.p;
      saveActivePerson('calActivePerson', state.calActivePerson);
      calRenderPersonTabs();
      calRenderLogCard();
      calRenderWeightCard();
      calRenderBurnCard();
      calRenderTrendChart();
      calRenderDeficitCard();
      renderGlanceBar();
    });
  });
}

function calRenderAll() {
  calRenderLogCard();
  calRenderFoodBankList();
  calRenderMonth();
  calRenderTrendChart();
  calRenderDeficitCard();
  renderTodayCard();
}

function calLoadData() {
  try { state.calEntries = JSON.parse(localStorage.getItem('calorie_entries') || '{}'); } catch (err) { state.calEntries = {}; }
  try {
    const s = localStorage.getItem('calorie_settings');
    if (s) { const parsed = JSON.parse(s); state.calGoals = parsed.goals || state.calGoals; }
  } catch (err) {}
  try { state.calDailyGoals = JSON.parse(localStorage.getItem('calorie_dailyGoals') || '{}'); } catch (err) { state.calDailyGoals = {}; }
  try { state.calFoodBank = JSON.parse(localStorage.getItem('calorie_foodBank') || '[]'); } catch (err) { state.calFoodBank = []; }
  try {
    state.calWeightLog = JSON.parse(localStorage.getItem('calorie_weightLog') || '{}');
    state.calWeightLog.p1 = state.calWeightLog.p1 || {};
    state.calWeightLog.p2 = state.calWeightLog.p2 || {};
  } catch (err) { state.calWeightLog = { p1: {}, p2: {} }; }
  try {
    state.calBurnLog = JSON.parse(localStorage.getItem('calorie_burnLog') || '{}');
    state.calBurnLog.p1 = state.calBurnLog.p1 || {};
    state.calBurnLog.p2 = state.calBurnLog.p2 || {};
  } catch (err) { state.calBurnLog = { p1: {}, p2: {} }; }

  calPopulateCategorySelect();
  calPopulateGoalsInputs();
  document.getElementById('calDatePicker').value = todayStr();
  document.getElementById('calDatePicker').max = todayStr();
  document.getElementById('weightDate').value = todayStr();
  document.getElementById('burnDate').value = todayStr();

  const now = new Date();
  state.calViewedMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  calRefreshTopFoodsCache();
  calRenderPersonTabs();
  calRenderAll();
  calRenderWeightCard();
  calRenderBurnCard();
}

document.getElementById('calResetBtn').addEventListener('click', async () => {
  if (!confirmWipe('logged food')) return;
  state.calEntries = {};
  try { localStorage.removeItem('calorie_entries'); } catch (err) {}
  // The "Most logged" chips read this cache — without a refresh they'd keep
  // offering foods from the history that was just wiped.
  calRefreshTopFoodsCache();
  calRenderAll();
  if (!coupleCode) return;
  try {
    await ensureAuth();
    const snap = await getDocs(calEntriesCollectionQuery(coupleCode));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  } catch (err) {
    console.error(err);
    setSyncStatus('Sync error (calories): could not clear');
  }
});

register('calories', {
  loadData: calLoadData,
  subscribe: (code) => { calSubscribeToCloud(code); calSubscribeToEntriesCloud(code); },
  renderAll: calRenderAll,
  isDoneToday: (pk) => calDayItems(pk, todayStr()).length > 0,
  glanceHtml: () => {
    const pk = state.calActivePerson;
    const ds = todayStr();
    const goal = calGoalsForDay(ds)[pk];
    const totals = calDayTotals(pk, ds);
    const kcalLeft = (goal.calories || 0) - totals.calories;
    const protLeft = (goal.protein || 0) - totals.protein;
    let html = (kcalLeft >= 0
        ? `<b>${kcalLeft.toLocaleString()}</b> kcal left`
        : `<b>${(-kcalLeft).toLocaleString()}</b> kcal over`)
      + (protLeft > 0 ? ` &middot; <b>${calRound2(protLeft)}g</b> protein to go` : ' &middot; protein &#10003;');
    if (pk === 'p1') html += ` &middot; deficit <b>${Math.round(calCumulativeDeficit('p1')).toLocaleString()}</b>`;
    return html;
  },
  jumpToToday: (pk) => {
    state.calActivePerson = pk;
    saveActivePerson('calActivePerson', pk);
    document.getElementById('calDatePicker').value = todayStr();
    state.calSelectedMonthDate = todayStr();
    calRenderPersonTabs();
    calRenderAll();
    calRenderWeightCard();
    calRenderBurnCard();
  },
  setPerson: (pk) => {
    state.calActivePerson = pk;
    saveActivePerson('calActivePerson', pk);
    calRenderPersonTabs();
    calRenderAll();
    calRenderWeightCard();
    calRenderBurnCard();
  },
  onSettingsChanged: () => { calRenderPersonTabs(); calPopulateGoalsInputs(); calRenderAll(); calPushToCloud(); },
  exportData: () => ({
    goals: state.calGoals, dailyGoals: state.calDailyGoals, entries: state.calEntries,
    foodBank: state.calFoodBank, weightLog: state.calWeightLog, burnLog: state.calBurnLog
  })
});

// Wire the late-bound slots (see state.js) now that everything is defined.
ui.populateGoalsInputs = calPopulateGoalsInputs;
ui.renderAll = calRenderAll;
ui.renderBurnCard = calRenderBurnCard;
ui.renderDeficitCard = calRenderDeficitCard;
ui.renderFoodBankList = calRenderFoodBankList;
ui.renderLogCard = calRenderLogCard;
ui.renderMonth = calRenderMonth;
ui.renderPersonTabs = calRenderPersonTabs;
ui.renderRecap = calRenderRecap;
ui.renderRecentChips = calRenderRecentChips;
ui.renderTrendChart = calRenderTrendChart;
ui.renderWeightCard = calRenderWeightCard;

