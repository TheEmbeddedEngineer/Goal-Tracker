import {
  db, doc, setDoc, getDoc, getDocs, deleteDoc, onSnapshot, collection,
  query, where, documentId, deleteField,
  ensureAuth, setSyncStatus, markSynced, coupleCode, confirmWipe, register,
  loadActivePerson, saveActivePerson, todayStr, parseDate, dstr, getMonday,
  calRound2, buildMonthGrid, buildTrendChart
} from './core.js';
import { sharedSettings, renderTodayCard, renderGlanceBar, applySharedSettingsToInputs } from './shared.js';



const CATS = [['nutrition','Nutrition'],['screen','Screen time'],['sport','Sport']];
const DAY_LABELS = ['M','T','W','T','F','S','S'];
const EARLIEST_VISIBLE_WEEK = '2026-06-29';
let wkEntries = {};
let wkThresholds = { nutrition:5, screen:5, sport:5 };
let wkWeeklyThresholds = {};
let wkActivePerson = loadActivePerson('wkActivePerson');
let wkViewedWeekMonday = null;
let wkUnsub = null;
let wkApplyingRemote = false;

function wkApplyRemoteData(data) {
  wkApplyingRemote = true;
  wkEntries = data.entries || {};
  if (data.settings) {
    sharedSettings.p1 = data.settings.p1 || sharedSettings.p1;
    sharedSettings.p2 = data.settings.p2 || sharedSettings.p2;
    wkThresholds = data.settings.thresholds || wkThresholds;
  }
  wkWeeklyThresholds = data.weeklyThresholds || {};
  applySharedSettingsToInputs();
  document.getElementById('thNutrition').value = wkThresholds.nutrition;
  document.getElementById('thScreen').value = wkThresholds.screen;
  document.getElementById('thSport').value = wkThresholds.sport;
  try { localStorage.setItem('entries', JSON.stringify(wkEntries)); } catch (err) {}
  try { localStorage.setItem('settings', JSON.stringify({ p1: sharedSettings.p1, p2: sharedSettings.p2, thresholds: wkThresholds })); } catch (err) {}
  try { localStorage.setItem('weeklyThresholds', JSON.stringify(wkWeeklyThresholds)); } catch (err) {}
  wkRenderPersonTabs();
  wkLoadCheckboxesForDate();
  wkRenderAll();
  wkApplyingRemote = false;
}

function wkSubscribeToCloud(code) {
  if (wkUnsub) { wkUnsub(); wkUnsub = null; }
  if (!code) return;
  ensureAuth().then(() => {
    const ref = doc(db, 'trackers', code);
    wkUnsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        wkApplyRemoteData(snap.data());
      } else {
        wkPushToCloud({ replace: true });
      }
      markSynced();
    }, (err) => {
      console.error(err);
      setSyncStatus('Sync error (weekly): ' + err.message);
    });
  });
}

async function wkPushToCloud(opts = {}) {
  if (!coupleCode || wkApplyingRemote) return;
  try {
    await ensureAuth();
    const writeOpts = opts.replace ? {} : { merge: true };
    await setDoc(doc(db, 'trackers', coupleCode), {
      entries: wkEntries,
      settings: { p1: sharedSettings.p1, p2: sharedSettings.p2, thresholds: wkThresholds },
      weeklyThresholds: wkWeeklyThresholds
    }, writeOpts);
  } catch (err) {
    console.error(err);
    setSyncStatus('Sync error (weekly): could not save');
  }
}
function fmtDate(s) { return parseDate(s).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
function weekKeyFor(dateStr) { return dstr(getMonday(parseDate(dateStr))); }

async function wkSaveThresholds() {
  wkThresholds = {
    nutrition: parseInt(document.getElementById('thNutrition').value) || 1,
    screen: parseInt(document.getElementById('thScreen').value) || 1,
    sport: parseInt(document.getElementById('thSport').value) || 1
  };
  try { localStorage.setItem('settings', JSON.stringify({ p1: sharedSettings.p1, p2: sharedSettings.p2, thresholds: wkThresholds })); } catch (err) {}
  wkRenderAll();
  wkPushToCloud();
}

function wkRenderPersonTabs() {
  const tabs = document.getElementById('wkPersonTabs');
  tabs.innerHTML = `
    <button data-p="p1" class="${wkActivePerson==='p1'?'active':''}">${sharedSettings.p1}</button>
    <button data-p="p2" class="${wkActivePerson==='p2'?'active':''}">${sharedSettings.p2}</button>
  `;
  tabs.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      wkActivePerson = b.dataset.p;
      saveActivePerson('wkActivePerson', wkActivePerson);
      wkRenderPersonTabs();
      wkLoadCheckboxesForDate();
      renderGlanceBar();
    });
  });
}

function wkSelectedDate() { return document.getElementById('wkDatePicker').value || todayStr(); }

function wkLoadCheckboxesForDate() {
  const ds = wkSelectedDate();
  const day = (wkEntries[wkActivePerson] || {})[ds] || {};
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
  if (!wkEntries[wkActivePerson]) wkEntries[wkActivePerson] = {};
  wkEntries[wkActivePerson][ds] = {
    nutrition: document.getElementById('cbNutrition').checked,
    screen: document.getElementById('cbScreen').checked,
    sport: document.getElementById('cbSport').checked
  };
  try { localStorage.setItem('entries', JSON.stringify(wkEntries)); } catch (err) { console.error(err); }
  wkRenderAll();
  wkPushToCloud();
}

function wkThresholdsForWeek(weekMonday) {
  const key = dstr(weekMonday);
  const nowMonday = getMonday(new Date());
  if (weekMonday.getTime() < nowMonday.getTime()) {
    if (!wkWeeklyThresholds[key]) {
      wkWeeklyThresholds[key] = { ...wkThresholds };
      try { localStorage.setItem('weeklyThresholds', JSON.stringify(wkWeeklyThresholds)); } catch (err) {}
      wkPushToCloud();
    }
    return wkWeeklyThresholds[key];
  }
  return wkThresholds;
}

function wkCatCountsForWeek(personKey, weekMonday) {
  const counts = { nutrition:0, screen:0, sport:0 };
  const personEntries = wkEntries[personKey] || {};
  for (let i=0;i<7;i++) {
    const d = new Date(weekMonday); d.setDate(d.getDate()+i);
    const day = personEntries[dstr(d)];
    if (day) { CATS.forEach(([k]) => { if (day[k]) counts[k]++; }); }
  }
  return counts;
}

function wkDayCompletionLevel(personKey, dateStr) {
  const day = (wkEntries[personKey] || {})[dateStr];
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
  const day = (wkEntries[personKey] || {})[dateStr];
  if (!day) return label + ': nothing logged yet';
  const parts = CATS.map(([k, catLabel]) => (day[k] ? '✓ ' : '✗ ') + catLabel);
  return label + ' — ' + parts.join('   ');
}

// Consecutive most-recently-completed weeks (not counting the in-progress current week)
// with no fine, i.e. every category threshold met. Breaks on the first missed week, or
// hits the app's data horizon.
function wkCurrentStreak(person) {
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

function wkRenderAll() {
  wkRenderThisWeek();
  wkRenderHistory();
  renderTodayCard();
}

function wkRenderThisWeek() {
  const monday = wkViewedWeekMonday;
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
    Object.keys(wkEntries[pk] || {}).forEach(ds => keys.add(weekKeyFor(ds)));
  });
  return Array.from(keys).filter(k => k >= EARLIEST_VISIBLE_WEEK).sort().reverse();
}

function wkRenderHistory() {
  const viewedWeekKey = dstr(wkViewedWeekMonday);
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

document.querySelectorAll('#section-weekly .goal-row').forEach(row => {
  row.addEventListener('click', (evt) => {
    if (evt.target.tagName !== 'INPUT') { const cb = row.querySelector('input'); cb.checked = !cb.checked; }
    wkUpdateRowStyles();
  });
});

document.getElementById('saveBtn').addEventListener('click', wkSaveDay);
document.getElementById('prevWeekBtn').addEventListener('click', () => {
  if (dstr(wkViewedWeekMonday) <= EARLIEST_VISIBLE_WEEK) return;
  wkViewedWeekMonday.setDate(wkViewedWeekMonday.getDate() - 7);
  wkRenderAll();
});
document.getElementById('nextWeekBtn').addEventListener('click', () => {
  const nowMonday = getMonday(new Date());
  if (wkViewedWeekMonday.getTime() >= nowMonday.getTime()) return;
  wkViewedWeekMonday.setDate(wkViewedWeekMonday.getDate() + 7);
  wkRenderAll();
});
document.getElementById('wkDatePicker').addEventListener('change', wkLoadCheckboxesForDate);
['thNutrition','thScreen','thSport'].forEach(id => {
  document.getElementById(id).addEventListener('change', wkSaveThresholds);
});

document.getElementById('wkResetBtn').addEventListener('click', async () => {
  if (!confirmWipe('tracked weekly data')) return;
  wkEntries = {};
  wkWeeklyThresholds = {};
  try { localStorage.removeItem('entries'); } catch (err) {}
  try { localStorage.removeItem('weeklyThresholds'); } catch (err) {}
  wkLoadCheckboxesForDate();
  wkRenderAll();
  wkPushToCloud({ replace: true });
});

function wkLoadData() {
  try { wkEntries = JSON.parse(localStorage.getItem('entries') || '{}'); } catch (err) { wkEntries = {}; }
  try {
    const s = localStorage.getItem('settings');
    if (s) { const parsed = JSON.parse(s); wkThresholds = parsed.thresholds || wkThresholds; }
  } catch (err) {}
  try { wkWeeklyThresholds = JSON.parse(localStorage.getItem('weeklyThresholds') || '{}'); } catch (err) { wkWeeklyThresholds = {}; }

  document.getElementById('thNutrition').value = wkThresholds.nutrition;
  document.getElementById('thScreen').value = wkThresholds.screen;
  document.getElementById('thSport').value = wkThresholds.sport;
  document.getElementById('wkDatePicker').value = todayStr();
  document.getElementById('wkDatePicker').max = todayStr();

  wkViewedWeekMonday = getMonday(new Date());

  wkRenderPersonTabs();
  wkLoadCheckboxesForDate();
  wkRenderAll();
}

register('weekly', {
  loadData: wkLoadData,
  subscribe: (code) => wkSubscribeToCloud(code),
  renderAll: wkRenderAll,
  isDoneToday: (pk) => !!((wkEntries[pk] || {})[todayStr()]),
  glanceHtml: () => {
    const pk = wkActivePerson;
    const monday = getMonday(new Date());
    const counts = wkCatCountsForWeek(pk, monday);
    const th = wkThresholdsForWeek(monday);
    const streak = wkCurrentStreak(pk);
    return CATS.map(([k, label]) => `${label.split(' ')[0]} <b>${counts[k]}/${th[k]}</b>`).join(' &middot; ')
      + (streak > 0 ? ` &middot; &#128293;${streak}` : '');
  },
  jumpToToday: (pk) => {
    wkActivePerson = pk;
    saveActivePerson('wkActivePerson', pk);
    wkViewedWeekMonday = getMonday(new Date());
    document.getElementById('wkDatePicker').value = todayStr();
    wkRenderPersonTabs();
    wkLoadCheckboxesForDate();
    wkRenderAll();
  },
  setPerson: (pk) => {
    wkActivePerson = pk;
    saveActivePerson('wkActivePerson', pk);
    wkRenderPersonTabs();
    wkLoadCheckboxesForDate();
    wkRenderAll();
  },
  onSettingsChanged: () => { wkRenderPersonTabs(); wkRenderAll(); wkPushToCloud(); },
  exportData: () => ({ entries: wkEntries, weeklyThresholds: wkWeeklyThresholds })
});

let initialWkThresholdsCollapsed = true;
try { initialWkThresholdsCollapsed = localStorage.getItem('wkThresholdsCollapsed') !== '0'; } catch (err) {}
setWkThresholdsCollapsed(initialWkThresholdsCollapsed);
