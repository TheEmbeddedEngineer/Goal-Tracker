import { calDayItems, calDayTotals, calGoalsForDay, state, ui } from './state.js';
import { calRenderLogCard } from './log.js';
import { calRenderBurnCard, calRenderWeightCard } from './metrics.js';
import { buildMonthGrid, buildTrendChart, dstr, todayStr } from '../core.js';
import { sharedSettings } from '../shared.js';

function calDayStatus(person, dateStr) {
  const items = calDayItems(person, dateStr);
  if (items.length === 0) return 'none';
  const totals = calDayTotals(person, dateStr);
  const goal = calGoalsForDay(dateStr)[person];
  const calOk = totals.calories <= goal.calories;
  const protOk = totals.protein >= goal.protein;
  if (calOk && protOk) return 'good';
  // Today isn't over yet, so an unmet goal so far isn't a "miss" — it's still in progress.
  if (dateStr === todayStr()) return 'inprogress';
  return 'bad';
}

export function calRenderMonth() {
  const year = state.calViewedMonth.getFullYear();
  const month = state.calViewedMonth.getMonth();
  document.getElementById('monthLabel').textContent = state.calViewedMonth.toLocaleDateString(undefined, { month:'long', year:'numeric' });

  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  document.getElementById('nextMonthBtn').disabled = isCurrentMonth;
  document.getElementById('nextMonthBtn').style.opacity = isCurrentMonth ? 0.4 : 1;
  document.getElementById('nextMonthBtn').style.cursor = isCurrentMonth ? 'default' : 'pointer';

  const cells = buildMonthGrid(year, month);
  const wrap = document.getElementById('monthCols');
  wrap.innerHTML = ['p1','p2'].map(pk => {
    const name = pk==='p1' ? sharedSettings.p1 : sharedSettings.p2;
    const squares = cells.map(d => {
      if (d === null) return '<div class="month-day blank"></div>';
      const ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      const status = calDayStatus(pk, ds);
      const totals = calDayTotals(pk, ds);
      const title = status === 'none' ? d + ': not logged' : d + ': ' + Math.round(totals.calories) + ' kcal, ' + Math.round(totals.protein) + 'g protein' + (status === 'inprogress' ? ' (today, still logging)' : '');
      const selected = state.calSelectedMonthDate === ds && state.calActivePerson === pk ? ' selected' : '';
      return `<div class="month-day ${status}${selected}" data-date="${ds}" data-person="${pk}" title="${title}"></div>`;
    }).join('');
    const hasEverLogged = Object.values(state.calEntries[pk] || {}).some(day => (day.items || []).length > 0);
    const emptyHint = hasEverLogged ? '' : `<div class="empty-state" style="padding:8px 0 0; text-align:left; font-size:12px;">No food logged yet — use "Log food" above to start.</div>`;
    return `<div class="month-col">
      <div class="pname" style="color:var(--${pk})">${name}</div>
      <div class="month-grid">${squares}</div>
      ${emptyHint}
    </div>`;
  }).join('');
  wrap.querySelectorAll('.month-day[data-date]').forEach(el => {
    el.addEventListener('click', () => {
      state.calActivePerson = el.dataset.person;
      state.calSelectedMonthDate = el.dataset.date;
      document.getElementById('calDatePicker').value = el.dataset.date;
      ui.renderPersonTabs();
      calRenderLogCard();
      calRenderMonth();
      calRenderTrendChart();
      calRenderWeightCard();
      calRenderBurnCard();
      document.getElementById('foodItemsList').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

let calTrendMetric = 'calories';

// Starts from i=days (oldest) down to i=1 (yesterday) — today is deliberately excluded
// for the food metrics since the day is still in progress and would read as a misleading
// dip on the chart. Weight is different: a weigh-in is final the moment it's logged, so
// today's measurement belongs on the chart immediately.
function calTrendPoints(person, metric, days) {
  const points = [];
  const today = new Date();
  const newestOffset = metric === 'weight' ? 0 : 1;
  for (let i = days; i >= newestOffset; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = dstr(d);
    let value;
    if (metric === 'weight') {
      value = (state.calWeightLog[person] || {})[ds];
    } else if (calDayItems(person, ds).length > 0) {
      value = calDayTotals(person, ds)[metric];
    }
    if (value !== undefined) points.push({ date: ds, value });
  }
  return points;
}

export function calRenderTrendChart() {
  const el = document.getElementById('calTrendChart');
  if (!el) return;
  const metric = calTrendMetric;
  const points = calTrendPoints(state.calActivePerson, metric, 30);
  const personGoals = state.calGoals[state.calActivePerson] || {};
  const goal = metric === 'calories' ? personGoals.calories
    : metric === 'protein' ? personGoals.protein
    : (personGoals.weightGoal > 0 ? personGoals.weightGoal : null);
  const unit = metric === 'calories' ? '' : metric === 'protein' ? 'g' : 'kg';
  el.innerHTML = buildTrendChart(points, { color: '--' + state.calActivePerson, goal, unit, detailId: 'calTrendDetail' });
  el.querySelectorAll('.trend-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const p = points[parseInt(dot.dataset.i)];
      document.getElementById('calTrendDetail').textContent = `${p.date}: ${p.value}${unit}`;
    });
  });
  calRenderRecap();
}

// i starts at 1 (yesterday), not 0 (today) — today is still in progress so it's excluded
// from both the day count and the averages, same reasoning as calTrendPoints.
function calRecapStats(person, days) {
  const today = new Date();
  let daysLogged = 0, daysCalMet = 0, daysProtMet = 0, sumCal = 0, sumProt = 0;
  for (let i = 1; i <= days; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = dstr(d);
    if (calDayItems(person, ds).length === 0) continue;
    daysLogged++;
    const totals = calDayTotals(person, ds);
    const goal = calGoalsForDay(ds)[person];
    if (totals.calories <= goal.calories) daysCalMet++;
    if (totals.protein >= goal.protein) daysProtMet++;
    sumCal += totals.calories;
    sumProt += totals.protein;
  }
  return {
    daysLogged, daysCalMet, daysProtMet,
    avgCal: daysLogged ? Math.round(sumCal / daysLogged) : 0,
    avgProt: daysLogged ? Math.round(sumProt / daysLogged) : 0
  };
}

export function calRenderRecap() {
  const el = document.getElementById('calRecapStats');
  if (!el) return;
  const stats = calRecapStats(state.calActivePerson, 7);
  if (stats.daysLogged === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:1rem 0;">No food logged in the last 7 days.</div>';
    return;
  }
  el.innerHTML = `
    <div class="recap-row"><span class="rname">Days logged</span><span class="rvalue">${stats.daysLogged}/7</span></div>
    <div class="recap-row"><span class="rname">Calorie goal met</span><span class="rvalue">${stats.daysCalMet}/${stats.daysLogged}</span></div>
    <div class="recap-row"><span class="rname">Protein goal met</span><span class="rvalue">${stats.daysProtMet}/${stats.daysLogged}</span></div>
    <div class="recap-row"><span class="rname">Avg calories/day</span><span class="rvalue">${stats.avgCal} kcal</span></div>
    <div class="recap-row"><span class="rname">Avg protein/day</span><span class="rvalue">${stats.avgProt}g</span></div>
  `;
}

document.getElementById('prevMonthBtn').addEventListener('click', () => {
  state.calViewedMonth = new Date(state.calViewedMonth.getFullYear(), state.calViewedMonth.getMonth() - 1, 1);
  calRenderMonth();
});
document.getElementById('nextMonthBtn').addEventListener('click', () => {
  const now = new Date();
  const nowMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (state.calViewedMonth.getTime() >= nowMonthStart.getTime()) return;
  state.calViewedMonth = new Date(state.calViewedMonth.getFullYear(), state.calViewedMonth.getMonth() + 1, 1);
  calRenderMonth();
});

document.querySelectorAll('#calTrendTabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    calTrendMetric = btn.dataset.metric;
    document.querySelectorAll('#calTrendTabs button').forEach(b => b.classList.toggle('active', b === btn));
    calRenderTrendChart();
  });
});
