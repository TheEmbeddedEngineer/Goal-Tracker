import { CAL_DEFICIT_GOAL, CAL_KCAL_PER_KG, calDayItems, calDayTotals, state, ui } from './state.js';
import { calPushToCloud } from './sync.js';
import { calRound2, dstr, getMonday, parseDate, todayStr } from '../core.js';
import { sharedSettings } from '../shared.js';

function calLatestWeight(person) {
  const days = Object.keys(state.calWeightLog[person] || {}).sort();
  if (!days.length) return null;
  const last = days[days.length - 1];
  return { date: last, value: state.calWeightLog[person][last] };
}

export function calRenderWeightCard() {
  const dateInput = document.getElementById('weightDate');
  if (!dateInput.value) dateInput.value = todayStr();
  dateInput.max = todayStr();
  const ds = dateInput.value;
  const existing = (state.calWeightLog[state.calActivePerson] || {})[ds];
  document.getElementById('weightValue').value = existing !== undefined ? existing : '';
  const latest = calLatestWeight(state.calActivePerson);
  document.getElementById('weightLatest').textContent = latest
    ? `Latest: ${latest.value}kg on ${latest.date}`
    : 'No weight logged yet.';
  calRenderWeightHistory();
}

// Shows the Mon-Sun week containing whichever date is currently picked, not a flat list
// of the most recent entries — scrolling the date picker browses week by week.
function calRenderWeightHistory() {
  const el = document.getElementById('weightHistory');
  if (!el) return;
  const selectedDate = document.getElementById('weightDate').value || todayStr();
  const monday = getMonday(parseDate(selectedDate));
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  const label = document.getElementById('weightWeekLabel');

  const rows = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(d.getDate() + i);
    rows.push(dstr(d));
  }
  const loggedDays = rows.filter(ds => (state.calWeightLog[state.calActivePerson] || {})[ds] !== undefined);
  if (loggedDays.length === 0) {
    if (label) label.textContent = '';
    el.innerHTML = '';
    return;
  }
  if (label) label.textContent = `Week of ${dstr(monday)} – ${dstr(sunday)}`;
  el.innerHTML = loggedDays.map(ds => {
    const val = state.calWeightLog[state.calActivePerson][ds];
    return `
    <div class="food-item">
      <span class="fi-name">${ds}</span>
      <span class="fi-macros">${val}kg</span>
      <button class="fi-edit" data-date="${ds}" title="Load into form">&#9998;</button><button class="fi-del" data-date="${ds}" title="Delete">&times;</button>
    </div>`;
  }).join('');
  el.querySelectorAll('.fi-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('weightDate').value = btn.dataset.date;
      calRenderWeightCard();
    });
  });
  el.querySelectorAll('.fi-del').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm(`Delete the weight entry for ${btn.dataset.date}?`)) return;
      delete state.calWeightLog[state.calActivePerson][btn.dataset.date];
      try { localStorage.setItem('calorie_weightLog', JSON.stringify(state.calWeightLog)); } catch (err) {}
      calRenderWeightCard();
      ui.renderTrendChart();
      calPushToCloud();
    });
  });
}

function calSaveWeight() {
  const ds = document.getElementById('weightDate').value || todayStr();
  const val = calRound2(parseFloat(document.getElementById('weightValue').value));
  if (isNaN(val) || val <= 0) { alert('Enter a valid weight.'); return; }
  if (!state.calWeightLog[state.calActivePerson]) state.calWeightLog[state.calActivePerson] = {};
  state.calWeightLog[state.calActivePerson][ds] = val;
  try { localStorage.setItem('calorie_weightLog', JSON.stringify(state.calWeightLog)); } catch (err) {}
  calRenderWeightCard();
  ui.renderTrendChart();
  calPushToCloud();
}

function calLatestBurn(person) {
  const days = Object.keys(state.calBurnLog[person] || {}).sort();
  if (!days.length) return null;
  const last = days[days.length - 1];
  return { date: last, value: state.calBurnLog[person][last] };
}

export function calRenderBurnCard() {
  const dateInput = document.getElementById('burnDate');
  if (!dateInput.value) dateInput.value = todayStr();
  dateInput.max = todayStr();
  const ds = dateInput.value;
  const existing = (state.calBurnLog[state.calActivePerson] || {})[ds];
  document.getElementById('burnValue').value = existing !== undefined ? existing : '';
  const latest = calLatestBurn(state.calActivePerson);
  document.getElementById('burnLatest').textContent = latest
    ? `Latest: ${latest.value} kcal on ${latest.date}`
    : 'No calories burned logged yet.';
  calRenderBurnHistory();
  calRenderDeficitCard();
}

// Same week-scoped pattern as the weight history: only the Mon-Sun week containing the
// selected date, only days that actually have an entry.
function calRenderBurnHistory() {
  const el = document.getElementById('burnHistory');
  if (!el) return;
  const selectedDate = document.getElementById('burnDate').value || todayStr();
  const monday = getMonday(parseDate(selectedDate));
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  const label = document.getElementById('burnWeekLabel');

  const rows = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(d.getDate() + i);
    rows.push(dstr(d));
  }
  const loggedDays = rows.filter(ds => (state.calBurnLog[state.calActivePerson] || {})[ds] !== undefined);
  if (loggedDays.length === 0) {
    if (label) label.textContent = '';
    el.innerHTML = '';
    return;
  }
  if (label) label.textContent = `Week of ${dstr(monday)} – ${dstr(sunday)}`;
  el.innerHTML = loggedDays.map(ds => {
    const val = state.calBurnLog[state.calActivePerson][ds];
    return `
    <div class="food-item">
      <span class="fi-name">${ds}</span>
      <span class="fi-macros">${val} kcal</span>
      <button class="fi-edit" data-date="${ds}" title="Load into form">&#9998;</button><button class="fi-del" data-date="${ds}" title="Delete">&times;</button>
    </div>`;
  }).join('');
  el.querySelectorAll('.fi-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('burnDate').value = btn.dataset.date;
      calRenderBurnCard();
    });
  });
  el.querySelectorAll('.fi-del').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm(`Delete the calories-burned entry for ${btn.dataset.date}?`)) return;
      delete state.calBurnLog[state.calActivePerson][btn.dataset.date];
      try { localStorage.setItem('calorie_burnLog', JSON.stringify(state.calBurnLog)); } catch (err) {}
      calRenderBurnCard();
      calPushToCloud();
    });
  });
}

function calSaveBurn() {
  const ds = document.getElementById('burnDate').value || todayStr();
  const val = Math.round(parseFloat(document.getElementById('burnValue').value));
  if (isNaN(val) || val <= 0) { alert('Enter a valid calorie amount.'); return; }
  if (!state.calBurnLog[state.calActivePerson]) state.calBurnLog[state.calActivePerson] = {};
  state.calBurnLog[state.calActivePerson][ds] = val;
  try { localStorage.setItem('calorie_burnLog', JSON.stringify(state.calBurnLog)); } catch (err) {}
  calRenderBurnCard();
  calPushToCloud();
}

// Deficit = calories burned (total daily expenditure) - calories eaten. Only counted for
// days that have BOTH a burn entry and logged food — without both, there's nothing
// meaningful to compute (assuming 0 eaten on an unlogged day would wildly overstate it).
function calDailyDeficit(person, ds) {
  if (calDayItems(person, ds).length === 0) return null;
  let burned = (state.calBurnLog[person] || {})[ds];
  if (burned === undefined) {
    // Fall back to the configured default burn so a day with food logged but a
    // forgotten burn entry doesn't silently drop out of the deficit total.
    // Fallback only estimates COMPLETED days: today is still being eaten through,
    // so counting it against the default burn would show a large fake deficit until
    // the day's food is fully logged. An explicit burn entry for today still counts —
    // logging it is the deliberate end-of-day signal.
    const fallback = (state.calGoals[person] || {}).defaultBurn;
    if (!(fallback > 0) || ds >= todayStr()) return null;
    burned = fallback;
  }
  return burned - calDayTotals(person, ds).calories;
}

function calWeekDeficit(person, weekMonday) {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekMonday); d.setDate(d.getDate() + i);
    const deficit = calDailyDeficit(person, dstr(d));
    if (deficit !== null) total += deficit;
  }
  return total;
}

export function calCumulativeDeficit(person) {
  const days = new Set([...Object.keys(state.calBurnLog[person] || {}), ...Object.keys(state.calEntries[person] || {})]);
  let total = 0;
  days.forEach(ds => {
    const deficit = calDailyDeficit(person, ds);
    if (deficit !== null) total += deficit;
  });
  return total;
}

// A day only counts toward the deficit total if it has BOTH a burn entry and logged food
// (see calDailyDeficit) — most days that are missing one or the other drop out silently.
// This tells you how much of the tracked window actually got counted, so the big total
// doesn't read as more complete than it is.
function calDeficitDayCoverage(person) {
  const allDates = [...Object.keys(state.calBurnLog[person] || {}), ...Object.keys(state.calEntries[person] || {})];
  if (allDates.length === 0) return { counted: 0, totalDays: 0 };
  const start = parseDate(allDates.sort()[0]);
  const totalDays = Math.floor((new Date() - start) / 86400000) + 1;
  let counted = 0;
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    if (calDailyDeficit(person, dstr(d)) !== null) counted++;
  }
  return { counted, totalDays };
}

export function calRenderDeficitCard() {
  const el = document.getElementById('calDeficitBig');
  const card = document.getElementById('calDeficitCard');
  if (!el) return;
  // The 50,000 kcal / ~7kg deficit goal (CAL_DEFICIT_GOAL above) was set as a personal
  // target, not a shared couple feature — only show it for the person it was defined for
  // rather than presenting the other person with a goal they never set.
  if (card) card.style.display = state.calActivePerson === 'p1' ? '' : 'none';
  if (state.calActivePerson !== 'p1') return;
  const total = calCumulativeDeficit(state.calActivePerson);
  const weekTotal = calWeekDeficit(state.calActivePerson, getMonday(new Date()));
  const pct = Math.max(0, Math.min(100, (total / CAL_DEFICIT_GOAL) * 100));
  const kg = total / CAL_KCAL_PER_KG;
  const coverage = calDeficitDayCoverage(state.calActivePerson);
  el.innerHTML = `
    <div style="text-align:center; padding:8px 0;">
      <div style="font-size:36px; font-weight:700; color:var(--${state.calActivePerson});">${Math.round(total).toLocaleString()}</div>
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">of ${CAL_DEFICIT_GOAL.toLocaleString()} kcal deficit &middot; &asymp; ${kg.toFixed(1)}kg lost</div>
      <div style="height:10px; background:var(--border); border-radius:100px; overflow:hidden;">
        <div style="height:100%; width:${pct}%; background:var(--${state.calActivePerson}); border-radius:100px;"></div>
      </div>
    </div>
    <div class="recap-row"><span class="rname">This week's deficit</span><span class="rvalue">${Math.round(weekTotal).toLocaleString()} kcal</span></div>
    <div class="recap-row" title="A day only counts if it has both a calories-burned entry and logged food"><span class="rname">Days counted</span><span class="rvalue">${coverage.counted} of ${coverage.totalDays}</span></div>
  `;
}

export function calPopulateGoalsInputs() {
  document.getElementById('p1CalGoal').value = state.calGoals.p1.calories;
  document.getElementById('p1ProtGoal').value = state.calGoals.p1.protein;
  document.getElementById('p2CalGoal').value = state.calGoals.p2.calories;
  document.getElementById('p2ProtGoal').value = state.calGoals.p2.protein;
  document.getElementById('p1DefaultBurn').value = state.calGoals.p1.defaultBurn || 0;
  // These labels used to read the same generic "Calorie goal (max, kcal)" text for both
  // people with nothing to tell the two rows apart beyond position in the layout — prefix
  // with the actual name so it's unambiguous which row is whose.
  document.getElementById('p1CalLabel').textContent = sharedSettings.p1 + ' — Calorie goal (max, kcal)';
  document.getElementById('p1ProtLabel').textContent = sharedSettings.p1 + ' — Protein goal (min, g)';
  document.getElementById('p2CalLabel').textContent = sharedSettings.p2 + ' — Calorie goal (max, kcal)';
  document.getElementById('p2ProtLabel').textContent = sharedSettings.p2 + ' — Protein goal (min, g)';
  document.getElementById('p1BurnLabel').textContent = sharedSettings.p1 + ' — Default daily burn (kcal), fallback for past days with food logged but no burn entry; today only counts once a burn is logged (0 = off)';
}

async function calSaveGoals() {
  // Freeze the goal that was in effect for every already-logged past day before
  // applying the new one, so this change doesn't retroactively affect them.
  const today = todayStr();
  const loggedDates = new Set();
  ['p1','p2'].forEach(pk => Object.keys(state.calEntries[pk] || {}).forEach(ds => loggedDates.add(ds)));
  loggedDates.forEach(ds => {
    if (ds < today && !state.calDailyGoals[ds]) {
      state.calDailyGoals[ds] = { p1: { ...state.calGoals.p1 }, p2: { ...state.calGoals.p2 } };
    }
  });

  state.calGoals = {
    p1: {
      calories: parseInt(document.getElementById('p1CalGoal').value) || 0,
      protein: parseInt(document.getElementById('p1ProtGoal').value) || 0,
      defaultBurn: parseInt(document.getElementById('p1DefaultBurn').value) || 0
    },
    p2: {
      calories: parseInt(document.getElementById('p2CalGoal').value) || 0,
      protein: parseInt(document.getElementById('p2ProtGoal').value) || 0
    }
  };
  try { localStorage.setItem('calorie_settings', JSON.stringify({ p1: sharedSettings.p1, p2: sharedSettings.p2, goals: state.calGoals })); } catch (err) {}
  try { localStorage.setItem('calorie_dailyGoals', JSON.stringify(state.calDailyGoals)); } catch (err) {}
  ui.renderPersonTabs();
  ui.renderAll();
  calPushToCloud();
}

document.getElementById('weightDate').addEventListener('change', calRenderWeightCard);
document.getElementById('weightSaveBtn').addEventListener('click', calSaveWeight);
document.getElementById('burnDate').addEventListener('change', calRenderBurnCard);
document.getElementById('burnSaveBtn').addEventListener('click', calSaveBurn);

['p1CalGoal','p1ProtGoal','p2CalGoal','p2ProtGoal','p1DefaultBurn'].forEach(id => {
  document.getElementById(id).addEventListener('change', calSaveGoals);
});

function setCalGoalsCollapsed(collapsed) {
  document.getElementById('calGoalsBody').classList.toggle('collapsed', collapsed);
  document.getElementById('calGoalsArrow').innerHTML = collapsed ? '&#9656;' : '&#9662;';
  try { localStorage.setItem('calGoalsCollapsed', collapsed ? '1' : '0'); } catch (err) {}
}
document.getElementById('calGoalsToggle').addEventListener('click', () => {
  setCalGoalsCollapsed(!document.getElementById('calGoalsBody').classList.contains('collapsed'));
});

let initialCalGoalsCollapsed = true;
try { initialCalGoalsCollapsed = localStorage.getItem('calGoalsCollapsed') !== '0'; } catch (err) {}
setCalGoalsCollapsed(initialCalGoalsCollapsed);
