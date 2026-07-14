import { CATS, DAY_LABELS, EARLIEST_VISIBLE_WEEK, state } from './state.js';
import { wkPushToCloud } from './sync.js';
import { confirmWipe, dstr, getMonday, parseDate, saveActivePerson, todayStr } from '../core.js';
import { renderGlanceBar, renderTodayCard, sharedSettings } from '../shared.js';

function fmtDate(s) { return parseDate(s).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
function weekKeyFor(dateStr) { return dstr(getMonday(parseDate(dateStr))); }

async function wkSaveThresholds() {
  state.wkThresholds = {
    nutrition: parseInt(document.getElementById('thNutrition').value) || 1,
    screen: parseInt(document.getElementById('thScreen').value) || 1,
    sport: parseInt(document.getElementById('thSport').value) || 1
  };
  try { localStorage.setItem('settings', JSON.stringify({ p1: sharedSettings.p1, p2: sharedSettings.p2, thresholds: state.wkThresholds })); } catch (err) {}
  wkRenderAll();
  wkPushToCloud();
}

export function wkRenderPersonTabs() {
  const tabs = document.getElementById('wkPersonTabs');
  tabs.innerHTML = `
    <button data-p="p1" class="${state.wkActivePerson==='p1'?'active':''}">${sharedSettings.p1}</button>
    <button data-p="p2" class="${state.wkActivePerson==='p2'?'active':''}">${sharedSettings.p2}</button>
  `;
  tabs.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      state.wkActivePerson = b.dataset.p;
      saveActivePerson('wkActivePerson', state.wkActivePerson);
      wkRenderPersonTabs();
      wkLoadCheckboxesForDate();
      renderGlanceBar();
    });
  });
}

function wkSelectedDate() { return document.getElementById('wkDatePicker').value || todayStr(); }

export function wkLoadCheckboxesForDate() {
  const ds = wkSelectedDate();
  const day = (state.wkEntries[state.wkActivePerson] || {})[ds] || {};
  document.getElementById('cbNutrition').checked = !!day.nutrition;
  document.getElementById('cbScreen').checked = !!day.screen;
  document.getElementById('cbSport').checked = !!day.sport;
  wkUpdateRowStyles();
}

function wkUpdateRowStyles() {
  document.querySelectorAll('#section-weekly .goal-row').forEach(row => {
    const cb = row.querySelector('input');
    row.classList.toggle('done', cb.checked);
  });
}

async function wkSaveDay() {
  const ds = wkSelectedDate();
  if (!state.wkEntries[state.wkActivePerson]) state.wkEntries[state.wkActivePerson] = {};
  state.wkEntries[state.wkActivePerson][ds] = {
    nutrition: document.getElementById('cbNutrition').checked,
    screen: document.getElementById('cbScreen').checked,
    sport: document.getElementById('cbSport').checked
  };
  try { localStorage.setItem('entries', JSON.stringify(state.wkEntries)); } catch (err) { console.error(err); }
  wkRenderAll();
  wkPushToCloud();
}

// Freezing runs inside render paths (history, streaks, glance bar), which can visit
// many unfrozen past weeks in one pass — coalesce the resulting cloud writes into a
// single deferred push instead of one full setDoc per week.
let wkFreezePushQueued = false;

export function wkThresholdsForWeek(weekMonday) {
  const key = dstr(weekMonday);
  const nowMonday = getMonday(new Date());
  if (weekMonday.getTime() < nowMonday.getTime()) {
    if (!state.wkWeeklyThresholds[key]) {
      state.wkWeeklyThresholds[key] = { ...state.wkThresholds };
      try { localStorage.setItem('weeklyThresholds', JSON.stringify(state.wkWeeklyThresholds)); } catch (err) {}
      if (!wkFreezePushQueued) {
        wkFreezePushQueued = true;
        setTimeout(() => { wkFreezePushQueued = false; wkPushToCloud(); }, 0);
      }
    }
    return state.wkWeeklyThresholds[key];
  }
  return state.wkThresholds;
}

export function wkCatCountsForWeek(personKey, weekMonday) {
  const counts = { nutrition:0, screen:0, sport:0 };
  const personEntries = state.wkEntries[personKey] || {};
  for (let i=0;i<7;i++) {
    const d = new Date(weekMonday); d.setDate(d.getDate()+i);
    const day = personEntries[dstr(d)];
    if (day) { CATS.forEach(([k]) => { if (day[k]) counts[k]++; }); }
  }
  return counts;
}

function wkDayCompletionLevel(personKey, dateStr) {
  const day = (state.wkEntries[personKey] || {})[dateStr];
  if (!day) return -1;
  let n = 0;
  CATS.forEach(([k]) => { if (day[k]) n++; });
  return n;
}

function wkRenderHeatmap(personKey, weekMonday) {
  let html = '<div class="heatmap">';
  for (let i=0;i<7;i++) {
    const d = new Date(weekMonday); d.setDate(d.getDate()+i);
    const ds = dstr(d);
    const level = wkDayCompletionLevel(personKey, ds);
    const heatVar = level < 0 ? 'var(--heat-0)' : `var(--heat-${level})`;
    const title = level < 0 ? fmtDate(ds) + ': not logged' : fmtDate(ds) + ': ' + level + '/3 categories';
    html += `<div class="heat-day" data-date="${ds}" data-person="${personKey}" title="${title}"><div class="heat-square" style="background:${heatVar}"></div><span class="dlabel">${DAY_LABELS[i]}</span></div>`;
  }
  html += '</div>';
  return html;
}

// Detailed per-category breakdown for a single day, shown on hover/tap of a heatmap square.
function wkDayDetailText(personKey, dateStr) {
  const label = parseDate(dateStr).toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
  const day = (state.wkEntries[personKey] || {})[dateStr];
  if (!day) return label + ': nothing logged yet';
  const parts = CATS.map(([k, catLabel]) => (day[k] ? '✓ ' : '✗ ') + catLabel);
  return label + ' — ' + parts.join('   ');
}

// Consecutive most-recently-completed weeks (not counting the in-progress current week)
// with no fine, i.e. every category threshold met. Breaks on the first missed week, or
// hits the app's data horizon.
export function wkCurrentStreak(person) {
  let monday = getMonday(new Date());
  monday.setDate(monday.getDate() - 7);
  let streak = 0;
  while (dstr(monday) >= EARLIEST_VISIBLE_WEEK) {
    const thresholds = wkThresholdsForWeek(monday);
    const counts = wkCatCountsForWeek(person, monday);
    const fine = CATS.some(([k]) => counts[k] < thresholds[k]);
    if (fine) break;
    streak++;
    monday.setDate(monday.getDate() - 7);
  }
  return streak;
}

export function wkRenderAll() {
  wkRenderThisWeek();
  wkRenderHistory();
  renderTodayCard();
}

function wkRenderThisWeek() {
  const monday = state.wkViewedWeekMonday;
  const nowMonday = getMonday(new Date());
  const isCurrentWeek = monday.getTime() === nowMonday.getTime();
  // Days fully finished so far this week — today doesn't count until it's over,
  // so "remaining" still includes today while it's in progress.
  const daysElapsed = monday.getTime() < nowMonday.getTime()
    ? 7
    : Math.min(7, Math.floor((new Date() - monday) / 86400000));
  const remaining = 7 - daysElapsed;

  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  document.getElementById('weekRangeLabel').textContent = isCurrentWeek
    ? 'This week'
    : fmtDate(dstr(monday)) + ' – ' + fmtDate(dstr(sunday));
  document.getElementById('nextWeekBtn').disabled = isCurrentWeek;
  document.getElementById('nextWeekBtn').style.opacity = isCurrentWeek ? 0.4 : 1;
  document.getElementById('nextWeekBtn').style.cursor = isCurrentWeek ? 'default' : 'pointer';

  const isEarliestWeek = dstr(monday) <= EARLIEST_VISIBLE_WEEK;
  document.getElementById('prevWeekBtn').disabled = isEarliestWeek;
  document.getElementById('prevWeekBtn').style.opacity = isEarliestWeek ? 0.4 : 1;
  document.getElementById('prevWeekBtn').style.cursor = isEarliestWeek ? 'default' : 'pointer';

  const wrap = document.getElementById('weekCols');
  const thresholds = wkThresholdsForWeek(monday);

  wrap.innerHTML = ['p1','p2'].map(pk => {
    const name = pk==='p1' ? sharedSettings.p1 : sharedSettings.p2;
    const counts = wkCatCountsForWeek(pk, monday);
    let fine = false;
    const rows = CATS.map(([key,label]) => {
      const threshold = thresholds[key];
      const count = counts[key];
      const needed = threshold - count;
      let status, cls;
      if (needed <= 0) { status = 'Met'; cls = 'met'; }
      else if (needed <= remaining) { status = 'On track'; cls = 'ontrack'; }
      else { status = 'Missed'; cls = 'missed'; fine = true; }
      return `<div class="cat-row"><span class="catname">${label}</span><span><span class="count">${count}/${threshold}</span><span class="status ${cls}">${status}</span></span></div>`;
    }).join('');
    const streak = wkCurrentStreak(pk);
    return `<div class="week-col">
      <div class="pname" style="color:var(--${pk})">${name}${streak > 0 ? ` <span class="streak-badge" title="Consecutive completed weeks with every category goal met, no fine">&#128293; ${streak}-week no-fine streak</span>` : ''}</div>
      ${wkRenderHeatmap(pk, monday)}
      <div class="day-detail" id="wkDayDetail-${pk}">Hover or tap a day above to see what was logged.</div>
      ${rows}
      <div class="fine-line"><span>Fine this week</span><span class="fine-tag ${fine?'yes':'no'}">${fine?'Yes':'No'}</span></div>
    </div>`;
  }).join('');

  wrap.querySelectorAll('.heat-day[data-date]').forEach(el => {
    const show = () => {
      const target = document.getElementById('wkDayDetail-' + el.dataset.person);
      if (target) target.textContent = wkDayDetailText(el.dataset.person, el.dataset.date);
    };
    el.addEventListener('mouseenter', show);
    el.addEventListener('click', show);
  });
}

function wkAllWeekKeys() {
  const keys = new Set();
  ['p1','p2'].forEach(pk => {
    Object.keys(state.wkEntries[pk] || {}).forEach(ds => keys.add(weekKeyFor(ds)));
  });
  return Array.from(keys).filter(k => k >= EARLIEST_VISIBLE_WEEK).sort().reverse();
}

function wkRenderHistory() {
  const viewedWeekKey = dstr(state.wkViewedWeekMonday);
  const nowWeekKey = dstr(getMonday(new Date()));
  const weeks = wkAllWeekKeys().filter(w => w !== viewedWeekKey && w !== nowWeekKey);
  const list = document.getElementById('historyList');
  if (weeks.length === 0) { list.innerHTML = '<div class="empty">No completed weeks yet</div>'; return; }

  list.innerHTML = weeks.map(wk => {
    const monday = parseDate(wk);
    const sunday = new Date(monday); sunday.setDate(sunday.getDate()+6);
    const thresholds = wkThresholdsForWeek(monday);
    const rows = ['p1','p2'].map(pk => {
      const name = pk==='p1' ? sharedSettings.p1 : sharedSettings.p2;
      const counts = wkCatCountsForWeek(pk, monday);
      const fine = CATS.some(([k]) => counts[k] < thresholds[k]);
      return `<div class="history-person${fine?'':' celebrate'}">
        <span class="pname">${name}</span>
        <span class="fine-tag ${fine?'yes':'no'}">${fine?'Fine':'🎉 You rocked!'}</span>
      </div>`;
    }).join('');
    return `<div class="history-week">
      <div class="wk-title">${fmtDate(dstr(monday))} – ${fmtDate(dstr(sunday))}</div>
      ${rows}
    </div>`;
  }).join('');
}

function setWkThresholdsCollapsed(collapsed) {
  document.getElementById('wkThresholdsBody').classList.toggle('collapsed', collapsed);
  document.getElementById('wkThresholdsArrow').innerHTML = collapsed ? '&#9656;' : '&#9662;';
  try { localStorage.setItem('wkThresholdsCollapsed', collapsed ? '1' : '0'); } catch (err) {}
}
document.getElementById('wkThresholdsToggle').addEventListener('click', () => {
  setWkThresholdsCollapsed(!document.getElementById('wkThresholdsBody').classList.contains('collapsed'));
});

// Toggling saves immediately — the rows read as instant state, and requiring a
// separate "Save this day" press silently discarded toggles whenever the person or
// date changed first. The button stays as explicit reassurance; it's now a no-op
// re-save of the same state.
document.querySelectorAll('#section-weekly .goal-row').forEach(row => {
  row.addEventListener('click', (evt) => {
    if (evt.target.tagName !== 'INPUT') { const cb = row.querySelector('input'); cb.checked = !cb.checked; }
    wkUpdateRowStyles();
    wkSaveDay();
  });
});

document.getElementById('saveBtn').addEventListener('click', wkSaveDay);
document.getElementById('prevWeekBtn').addEventListener('click', () => {
  if (dstr(state.wkViewedWeekMonday) <= EARLIEST_VISIBLE_WEEK) return;
  state.wkViewedWeekMonday.setDate(state.wkViewedWeekMonday.getDate() - 7);
  wkRenderAll();
});
document.getElementById('nextWeekBtn').addEventListener('click', () => {
  const nowMonday = getMonday(new Date());
  if (state.wkViewedWeekMonday.getTime() >= nowMonday.getTime()) return;
  state.wkViewedWeekMonday.setDate(state.wkViewedWeekMonday.getDate() + 7);
  wkRenderAll();
});
document.getElementById('wkDatePicker').addEventListener('change', wkLoadCheckboxesForDate);
['thNutrition','thScreen','thSport'].forEach(id => {
  document.getElementById(id).addEventListener('change', wkSaveThresholds);
});

document.getElementById('wkResetBtn').addEventListener('click', async () => {
  if (!confirmWipe('tracked weekly data')) return;
  state.wkEntries = {};
  state.wkWeeklyThresholds = {};
  try { localStorage.removeItem('entries'); } catch (err) {}
  try { localStorage.removeItem('weeklyThresholds'); } catch (err) {}
  wkLoadCheckboxesForDate();
  wkRenderAll();
  wkPushToCloud({ replace: true });
});

let initialWkThresholdsCollapsed = true;
try { initialWkThresholdsCollapsed = localStorage.getItem('wkThresholdsCollapsed') !== '0'; } catch (err) {}
setWkThresholdsCollapsed(initialWkThresholdsCollapsed);
