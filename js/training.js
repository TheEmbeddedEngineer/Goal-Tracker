import {
  db, doc, setDoc, getDoc, getDocs, deleteDoc, onSnapshot, collection,
  query, where, documentId, deleteField,
  ensureAuth, setSyncStatus, markSynced, coupleCode, confirmWipe, register,
  loadActivePerson, saveActivePerson, todayStr, parseDate, dstr, getMonday,
  calRound2, buildMonthGrid, buildTrendChart
} from './core.js';
import { sharedSettings, renderTodayCard, renderGlanceBar, applySharedSettingsToInputs } from './shared.js';
import { PLAN_P1, PLAN_P2, DAY_ORDER, DAY_LABELS_TR, TR_EXERCISE_RENAMES, TR_EXTRA_ACTIVITIES } from './data.js';


let trActivePerson = loadActivePerson('trActivePerson');
let trActiveDay = 'overview';
let trActiveVariant = 'gym';
let trTrainingLog = { p1: [], p2: [] };
// Dates (YYYY-MM-DD) the core stability block was done — a single checkbox per day,
// not a per-exercise log like trTrainingLog. Doesn't count toward trWeekLogCount: it's a
// short add-on, not a standalone session, so it shouldn't inflate the weekly session
// total or streak the way a real workout/activity does.
let trCoreLog = { p1: [], p2: [] };
// Other loggable activities outside the day1-day5 plan — person -> activity name -> dates
// (same shape/merge semantics as trCoreLog), but these DO count as real sessions since
// they're standalone efforts, not a finisher tacked onto another workout.
let trExtraLog = { p1: {}, p2: {} };
// Simple "hit 10,000+ steps today" checkbox, same shape/treatment as trCoreLog: a plain
// array of dates, doesn't count toward trWeekLogCount (it's a passive daily target, not a
// session). p1-only — the checkbox only renders when viewing him.
let trStepsCheckLog = { p1: [], p2: [] };
const TR_STEPS_GOAL = 10000;
let trOverviewViewedMonth = null;
let trOverviewSelectedDate = null;
let trUnsub = null;
let trApplyingRemote = false;

function trCurrentPlan() { return trActivePerson === 'p1' ? PLAN_P1 : PLAN_P2; }

function trApplyLegacyExerciseRenames() {
  let changed = false;
  ['p1', 'p2'].forEach(pk => {
    (trTrainingLog[pk] || []).forEach(l => {
      if (!l.weights) return;
      Object.keys(TR_EXERCISE_RENAMES).forEach(oldName => {
        if (l.weights[oldName] === undefined) return;
        const newName = TR_EXERCISE_RENAMES[oldName];
        if (l.weights[newName] === undefined) l.weights[newName] = l.weights[oldName];
        delete l.weights[oldName];
        changed = true;
      });
    });
  });
  if (changed) {
    try { localStorage.setItem('training_log', JSON.stringify(trTrainingLog)); } catch (err) {}
    trRenderAll();
    trPushToCloud();
  }
}

function trApplyRemoteData(data) {
  trApplyingRemote = true;
  if (data.settings) {
    sharedSettings.p1 = data.settings.p1 || sharedSettings.p1;
    sharedSettings.p2 = data.settings.p2 || sharedSettings.p2;
  }
  trTrainingLog = data.trainingLog || { p1: [], p2: [] };
  trCoreLog = data.coreLog || { p1: [], p2: [] };
  trExtraLog = data.extraLog || { p1: {}, p2: {} };
  trStepsCheckLog = data.stepsCheckLog || { p1: [], p2: [] };
  applySharedSettingsToInputs();
  try { localStorage.setItem('training_settings', JSON.stringify({ p1: sharedSettings.p1, p2: sharedSettings.p2 })); } catch (err) {}
  try { localStorage.setItem('training_log', JSON.stringify(trTrainingLog)); } catch (err) {}
  try { localStorage.setItem('training_coreLog', JSON.stringify(trCoreLog)); } catch (err) {}
  try { localStorage.setItem('training_extraLog', JSON.stringify(trExtraLog)); } catch (err) {}
  try { localStorage.setItem('training_stepsCheckLog', JSON.stringify(trStepsCheckLog)); } catch (err) {}
  trRenderAll();
  trApplyingRemote = false;
  trApplyLegacyExerciseRenames();
}

function trSubscribeToCloud(code) {
  if (trUnsub) { trUnsub(); trUnsub = null; }
  if (!code) return;
  ensureAuth().then(() => {
    const ref = doc(db, 'training', code);
    trUnsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        trApplyRemoteData(snap.data());
      } else {
        trPushToCloud({ replace: true });
      }
      markSynced();
    }, (err) => {
      console.error(err);
      setSyncStatus('Sync error (training): ' + err.message);
    });
  });
}

// Same wholesale-array-replacement risk as the calorie food bank: two devices logging
// workouts around the same time can otherwise clobber each other's entries. Merge the
// latest remote log into the local one (by date+day+variant) before pushing, except
// right after a delete — there, trust the local list so the merge doesn't resurrect the
// entry that was just removed.
function trMergeLogArray(localArr, remoteArr) {
  const key = l => l.date + '|' + l.day + '|' + l.variant;
  const byKey = new Map();
  (remoteArr || []).forEach(l => byKey.set(key(l), l));
  (localArr || []).forEach(l => byKey.set(key(l), l));
  return Array.from(byKey.values());
}

// Same idea for core-stability check-off dates: union the two lists so a concurrent
// check-in isn't lost. Skipped on uncheck so a stale remote copy can't resurrect a date
// that was just unchecked.
function trMergeCoreLog(localArr, remoteArr) {
  return Array.from(new Set([...(remoteArr || []), ...(localArr || [])])).sort();
}

// Same union-by-date merge as trMergeCoreLog, applied per activity name (Tennis, Hyrox,
// Runs, ...) since each person can have a different set of activities.
function trMergeExtraLog(localObj, remoteObj) {
  const merged = {};
  const names = new Set([...Object.keys(localObj || {}), ...Object.keys(remoteObj || {})]);
  names.forEach(name => {
    merged[name] = trMergeCoreLog((localObj || {})[name], (remoteObj || {})[name]);
  });
  return merged;
}

async function trPushToCloud(opts = {}) {
  if (!coupleCode || trApplyingRemote) return;
  try {
    await ensureAuth();
    if (!opts.skipMerge) {
      try {
        const snap = await getDoc(doc(db, 'training', coupleCode));
        if (snap.exists()) {
          const remote = snap.data();
          trTrainingLog.p1 = trMergeLogArray(trTrainingLog.p1, remote.trainingLog && remote.trainingLog.p1);
          trTrainingLog.p2 = trMergeLogArray(trTrainingLog.p2, remote.trainingLog && remote.trainingLog.p2);
          trCoreLog.p1 = trMergeCoreLog(trCoreLog.p1, remote.coreLog && remote.coreLog.p1);
          trCoreLog.p2 = trMergeCoreLog(trCoreLog.p2, remote.coreLog && remote.coreLog.p2);
          trExtraLog.p1 = trMergeExtraLog(trExtraLog.p1, remote.extraLog && remote.extraLog.p1);
          trExtraLog.p2 = trMergeExtraLog(trExtraLog.p2, remote.extraLog && remote.extraLog.p2);
          trStepsCheckLog.p1 = trMergeCoreLog(trStepsCheckLog.p1, remote.stepsCheckLog && remote.stepsCheckLog.p1);
          trStepsCheckLog.p2 = trMergeCoreLog(trStepsCheckLog.p2, remote.stepsCheckLog && remote.stepsCheckLog.p2);
        }
      } catch (err) { console.error('Could not merge remote training log before push:', err); }
    }
    const writeOpts = opts.replace ? {} : { merge: true };
    await setDoc(doc(db, 'training', coupleCode), {
      settings: { p1: sharedSettings.p1, p2: sharedSettings.p2 },
      trainingLog: trTrainingLog,
      coreLog: trCoreLog,
      extraLog: trExtraLog,
      stepsCheckLog: trStepsCheckLog
    }, writeOpts);
    try { localStorage.setItem('training_log', JSON.stringify(trTrainingLog)); } catch (err) {}
    try { localStorage.setItem('training_coreLog', JSON.stringify(trCoreLog)); } catch (err) {}
    try { localStorage.setItem('training_extraLog', JSON.stringify(trExtraLog)); } catch (err) {}
    try { localStorage.setItem('training_stepsCheckLog', JSON.stringify(trStepsCheckLog)); } catch (err) {}
    trRenderContent();
  } catch (err) {
    console.error(err);
    setSyncStatus('Sync error (training): could not save');
  }
}

function trRenderPersonTabs() {
  const el = document.getElementById('trPersonTabs');
  el.innerHTML = `
    <button data-p="p1" class="${trActivePerson === 'p1' ? 'active' : ''}">${sharedSettings.p1}</button>
    <button data-p="p2" class="${trActivePerson === 'p2' ? 'active' : ''}">${sharedSettings.p2}</button>
  `;
  el.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      trActivePerson = b.dataset.p;
      saveActivePerson('trActivePerson', trActivePerson);
      const order = (trCurrentPlan() && trCurrentPlan().dayOrder) || DAY_ORDER;
      if (!order.includes(trActiveDay)) trActiveDay = 'overview';
      trActiveVariant = 'gym';
      trOverviewSelectedDate = null;
      trRenderAll();
    });
  });
}

function trRenderDayTabs() {
  const el = document.getElementById('trDayTabs');
  const order = (trCurrentPlan() && trCurrentPlan().dayOrder) || DAY_ORDER;
  el.innerHTML = order.map(d => `<button data-d="${d}" class="${trActiveDay === d ? 'active' : ''}">${DAY_LABELS_TR[d]}</button>`).join('');
  el.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => { trActiveDay = b.dataset.d; trActiveVariant = 'gym'; trRenderContent(); trUpdateActiveTabStyles(); });
  });
}

function trUpdateActiveTabStyles() {
  document.querySelectorAll('#trDayTabs button').forEach(b => b.classList.toggle('active', b.dataset.d === trActiveDay));
}

function trExName(name, url) {
  return url
    ? `<a class="ex-video-link" href="${url}" target="_blank" rel="noopener">${name}<span class="ex-play">&#9654;</span></a>`
    : name;
}

function trExRow([name, reps, url]) {
  return `<div class="ex-row"><span class="ex-name">${trExName(name, url)}</span><span class="ex-reps">${reps}</span></div>`;
}

function trRenderOverview(plan) {
  const streak = trCurrentStreak(trActivePerson);
  const weekMonday = getMonday(new Date());
  const p1Count = trWeekLogCount('p1', weekMonday);
  const p2Count = trWeekLogCount('p2', weekMonday);
  const total = p1Count + p2Count;
  const bothTrainedLine = total > 0 ? `<div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">
    ${p1Count > 0 && p2Count > 0 ? '🎉 You\'ve both trained this week — ' : ''}sessions this week: <span style="color:var(--p1); font-weight:600;">${sharedSettings.p1} ${p1Count}/${TR_STREAK_MIN_LOGS}</span> &middot; <span style="color:var(--p2); font-weight:600;">${sharedSettings.p2} ${p2Count}/${TR_STREAK_MIN_LOGS}</span>
  </div>` : '';
  return `
    ${streak > 0 ? `<div class="tr-streak-badge" title="Consecutive weeks with ${TR_STREAK_MIN_LOGS}+ workout or other logged activity (core stability doesn't count as its own session)">&#128293; ${streak}-week streak (${TR_STREAK_MIN_LOGS}+ sessions every week)</div>` : ''}
    ${bothTrainedLine}
    <h2>Training log calendar</h2>
    <div class="month-nav">
      <button id="trOverviewPrevMonthBtn">&larr;</button>
      <h2 id="trOverviewMonthLabel" style="margin:0; font-size:15px;"></h2>
      <button id="trOverviewNextMonthBtn">&rarr;</button>
    </div>
    <div class="month-grid" id="trOverviewCalGrid" style="margin-bottom:10px;"></div>
    <div class="month-legend" style="margin-bottom:14px;">
      <span><span class="legend-swatch" style="background:var(--green-border)"></span>Trained (day shown in square)</span>
      <span><span class="legend-swatch" style="background:var(--heat-none)"></span>Not logged</span>
    </div>
    <div id="trOverviewSelectedDay"></div>

    ${(TR_EXTRA_ACTIVITIES[trActivePerson] || []).length ? `
      <div class="section-title">Other activities</div>
      ${TR_EXTRA_ACTIVITIES[trActivePerson].map(act => `
        <div class="core-log-row">
          <label class="core-check-inline">
            <input type="checkbox" class="extra-activity-checkbox" data-activity="${act}">
            <span>${act}</span>
          </label>
          <input type="date" class="extra-activity-date" data-activity="${act}">
          <button class="primary extra-activity-save" data-activity="${act}">Save</button>
        </div>
      `).join('')}
    ` : ''}

    ${trActivePerson === 'p1' ? `
      <div class="core-log-row">
        <label class="core-check-inline">
          <input type="checkbox" id="stepsCheckCheckbox">
          <span>${TR_STEPS_GOAL.toLocaleString()}+ steps</span>
        </label>
        <input type="date" id="stepsCheckDate">
        <button class="primary" id="stepsCheckSaveBtn">Save</button>
      </div>
    ` : ''}

    <h2 style="margin-top:20px;">Overview</h2>
    <p class="card-sub">${plan.goal}</p>
    <details class="tr-overview-details">
      <summary>Rules, muscle frequency &amp; notes</summary>
      <div class="section-title">Flexible scheduling rules</div>
      <ul class="rule-list">${plan.rules.map(r => `<li>${r}</li>`).join('')}</ul>
      <div class="section-title">Muscle frequency check</div>
      <table class="freq-table">
        <tr><th>Muscle group</th><th>Hit on</th><th>Frequency</th></tr>
        ${plan.frequency.map(row => `<tr><td>${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td></tr>`).join('')}
      </table>
      <div class="section-title">Notes</div>
      <ul class="rule-list">${plan.notes.map(n => `<li>${n}</li>`).join('')}</ul>
    </details>
  `;
}

function trLogsForDate(person, dateStr) {
  return (trTrainingLog[person] || []).filter(l => l.date === dateStr);
}

const TR_STREAK_MIN_LOGS = 4;

// Core stability is intentionally excluded here — it's a short add-on, not a standalone
// session, so it shouldn't inflate the weekly count or streak. Other logged activities
// (Tennis, Hyrox, Runs, ...) DO count since they're real standalone efforts.
function trWeekLogCount(person, weekMonday) {
  const start = dstr(weekMonday);
  const sunday = new Date(weekMonday); sunday.setDate(sunday.getDate() + 6);
  const end = dstr(sunday);
  const workoutCount = (trTrainingLog[person] || []).filter(l => l.date >= start && l.date <= end).length;
  const extraCount = Object.values(trExtraLog[person] || {})
    .reduce((sum, dates) => sum + dates.filter(ds => ds >= start && ds <= end).length, 0);
  return workoutCount + extraCount;
}

// Consecutive weeks (including the current in-progress one, since training is a flexible
// rotation rather than a daily habit) with at least TR_STREAK_MIN_LOGS total sessions
// (workouts + other logged activities combined — see trWeekLogCount for why core doesn't
// count here).
function trCurrentStreak(person) {
  let monday = getMonday(new Date());
  let streak = 0;
  for (let i = 0; i < 52; i++) {
    if (trWeekLogCount(person, monday) < TR_STREAK_MIN_LOGS) break;
    streak++;
    monday.setDate(monday.getDate() - 7);
  }
  return streak;
}

function trDayVariantLabel(l) {
  const label = DAY_LABELS_TR[l.day] || l.day;
  return l.variant === 'home' ? label + ' (Home)' : l.variant === 'gym' ? label + ' (Gym)' : label;
}

// Short label shown directly inside the calendar square, e.g. "day2" -> "D2".
function trDayShortLabel(l) {
  const m = /^day(\d+)$/.exec(l.day);
  return m ? 'D' + m[1] : (l.day === 'backcare' ? 'BC' : l.day);
}

function trRenderOverviewCalendarGrid() {
  const year = trOverviewViewedMonth.getFullYear();
  const month = trOverviewViewedMonth.getMonth();
  document.getElementById('trOverviewMonthLabel').textContent = trOverviewViewedMonth.toLocaleDateString(undefined, { month:'long', year:'numeric' });

  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const nextBtn = document.getElementById('trOverviewNextMonthBtn');
  nextBtn.disabled = isCurrentMonth;
  nextBtn.style.opacity = isCurrentMonth ? 0.4 : 1;
  nextBtn.style.cursor = isCurrentMonth ? 'default' : 'pointer';

  const cells = buildMonthGrid(year, month);
  const wrap = document.getElementById('trOverviewCalGrid');
  wrap.innerHTML = cells.map(d => {
    if (d === null) return '<div class="month-day blank"></div>';
    const ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const logs = trLogsForDate(trActivePerson, ds);
    const coreDone = (trCoreLog[trActivePerson] || []).includes(ds);
    const extraDone = (TR_EXTRA_ACTIVITIES[trActivePerson] || []).filter(act => ((trExtraLog[trActivePerson] || {})[act] || []).includes(ds));
    const stepsDone = trActivePerson === 'p1' && (trStepsCheckLog.p1 || []).includes(ds);
    const hasAny = logs.length > 0 || coreDone || extraDone.length > 0 || stepsDone;
    const status = hasAny ? 'good' : '';
    const selected = trOverviewSelectedDate === ds ? ' selected' : '';
    const titleParts = logs.map(trDayVariantLabel).concat(extraDone);
    if (coreDone) titleParts.push('Core stability');
    if (stepsDone) titleParts.push(`${TR_STEPS_GOAL.toLocaleString()}+ steps`);
    const title = hasAny ? ds + ': ' + titleParts.join(', ') : ds + ': not logged';
    const labelParts = logs.map(trDayShortLabel).concat(extraDone.map(act => act[0]));
    if (coreDone) labelParts.push('C');
    if (stepsDone) labelParts.push('S');
    const label = labelParts.join('/');
    return `<div class="month-day ${status}${selected}" data-date="${ds}" title="${title}">${label}</div>`;
  }).join('');
  wrap.querySelectorAll('.month-day[data-date]').forEach(el => {
    el.addEventListener('click', () => {
      trOverviewSelectedDate = el.dataset.date;
      trRenderOverviewCalendarGrid();
      trRenderOverviewSelectedDay();
    });
  });
}

function trRenderOverviewSelectedDay() {
  const el = document.getElementById('trOverviewSelectedDay');
  if (!el) return;
  if (!trOverviewSelectedDate) {
    el.innerHTML = '<div class="empty-state" style="padding:0.5rem 0;">Tap a day in the calendar to see what was logged.</div>';
    return;
  }
  const logs = trLogsForDate(trActivePerson, trOverviewSelectedDate);
  const coreDone = (trCoreLog[trActivePerson] || []).includes(trOverviewSelectedDate);
  const extraDone = (TR_EXTRA_ACTIVITIES[trActivePerson] || []).filter(act => ((trExtraLog[trActivePerson] || {})[act] || []).includes(trOverviewSelectedDate));
  const stepsDone = trActivePerson === 'p1' && (trStepsCheckLog.p1 || []).includes(trOverviewSelectedDate);
  if (logs.length === 0 && !coreDone && extraDone.length === 0 && !stepsDone) {
    el.innerHTML = `<div class="empty-state" style="padding:0.5rem 0;">No training logged on ${trOverviewSelectedDate}.</div>`;
    return;
  }
  const coreHtml = coreDone ? `<div class="past-log-row" style="margin-bottom:8px;">
    <div class="pl-header" style="cursor:default;">
      <span class="pl-date">${trOverviewSelectedDate}</span>
      <span class="pl-meta">Core stability block</span>
    </div>
  </div>` : '';
  const stepsHtml = stepsDone ? `<div class="past-log-row" style="margin-bottom:8px;">
    <div class="pl-header" style="cursor:default;">
      <span class="pl-date">${trOverviewSelectedDate}</span>
      <span class="pl-meta">${TR_STEPS_GOAL.toLocaleString()}+ steps</span>
    </div>
  </div>` : '';
  const extraHtml = extraDone.map(act => `<div class="past-log-row" style="margin-bottom:8px;">
    <div class="pl-header" style="cursor:default;">
      <span class="pl-date">${trOverviewSelectedDate}</span>
      <span class="pl-meta">${act}</span>
    </div>
  </div>`).join('');
  el.innerHTML = coreHtml + stepsHtml + extraHtml + logs.map(l => {
    const prev = trFindPreviousLog(trActivePerson, l.day, l.variant, l.date);
    return `<div class="past-log-row" style="margin-bottom:8px;">
      <div class="pl-header" style="cursor:default;">
        <span class="pl-date">${l.date}</span>
        <span class="pl-meta">${trDayVariantLabel(l)}</span>
      </div>
      <div class="pl-detail open">${trRenderLogDetail(l, prev)}</div>
    </div>`;
  }).join('');
}

function trDayLogs(person, dayKey) {
  return (trTrainingLog[person] || []).filter(l => l.day === dayKey).sort((a, b) => b.date.localeCompare(a.date));
}

function trFindLog(person, dayKey, date, variant) {
  return (trTrainingLog[person] || []).find(l => l.day === dayKey && l.date === date && l.variant === variant);
}

function trFindPreviousLog(person, dayKey, variant, beforeDate) {
  const arr = (trTrainingLog[person] || [])
    .filter(l => l.day === dayKey && l.variant === variant && l.date < beforeDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  return arr[0] || null;
}

const trExpandedLogs = new Set();
function trLogKey(date, variant) { return date + '|' + variant; }

// Exercise names in the order the training plan lists them for this log's day+variant,
// so past sessions display in plan order instead of the object's insertion order.
function trExerciseOrderForLog(l) {
  const plan = trCurrentPlan();
  const day = plan && plan[l.day];
  if (!day) return [];
  const orderList = (day.home && l.variant === 'home') ? day.home : day.gym;
  return (orderList || []).map(ex => ex[0]);
}

function trRenderLogDetail(l, prev) {
  const orderedNames = trExerciseOrderForLog(l).filter(name => l.weights[name] !== undefined);
  Object.keys(l.weights).forEach(name => { if (!orderedNames.includes(name)) orderedNames.push(name); });
  return orderedNames.map(name => {
    const w = l.weights[name];
    let deltaHtml = '<span class="pl-ex-delta flat">first time</span>';
    if (prev && prev.weights[name] !== undefined) {
      const d = Math.round((w - prev.weights[name]) * 100) / 100;
      if (d > 0) deltaHtml = `<span class="pl-ex-delta up">&#9650; +${d}kg</span>`;
      else if (d < 0) deltaHtml = `<span class="pl-ex-delta down">&#9660; ${d}kg</span>`;
      else deltaHtml = '<span class="pl-ex-delta flat">no change</span>';
    }
    return `<div class="pl-ex-row"><span class="pl-ex-name">${name}</span><span class="pl-ex-weight">${w}kg</span>${deltaHtml}</div>`;
  }).join('');
}

function trRenderDay(day, dayKey) {
  const hasVariants = !!(day.gym && day.home);
  const list = hasVariants ? (trActiveVariant === 'gym' ? day.gym : day.home) : day.gym;
  const logs = trDayLogs(trActivePerson, dayKey);
  return `
    <h2>${day.title}</h2>
    <p class="card-sub">${day.duration}</p>
    ${hasVariants ? `
      <div class="variant-tabs">
        <button id="variantGym" class="${trActiveVariant === 'gym' ? 'active' : ''}">Gym</button>
        <button id="variantHome" class="${trActiveVariant === 'home' ? 'active' : ''}">Home (dumbbell)</button>
      </div>` : ''}
    <div class="log-date-row">
      <label>Date</label>
      <input type="date" id="logDate">
    </div>
    <div id="logWeights">
      ${list.map((ex, i) => `<div class="log-weight-row"><span class="lw-name">${trExName(ex[0], ex[2])}<span class="lw-reps">${ex[1]}</span></span><span class="lw-last" id="lwLast_${i}" data-target="logW_${i}" title="Tap to use this weight"></span><input type="number" id="logW_${i}" placeholder="kg" min="0"></div>`).join('')}
    </div>
    <p id="logError" class="field-error" style="display:none;">Enter at least one weight.</p>
    <button class="primary" id="saveLogBtn">Save log</button>

    <div class="section-title" style="margin-top:20px;">Past sessions</div>
    <div id="pastLogs">
      ${logs.length === 0 ? '<div class="empty-state" style="padding:1rem 0;">No sessions logged yet.</div>' : logs.map(l => {
        const key = trLogKey(l.date, l.variant);
        const open = trExpandedLogs.has(key);
        const prev = trFindPreviousLog(trActivePerson, dayKey, l.variant, l.date);
        const count = Object.keys(l.weights).length;
        return `<div class="past-log-row" data-date="${l.date}" data-variant="${l.variant}">
          <div class="pl-header">
            <span class="pl-chevron ${open ? 'open' : ''}">&#9656;</span>
            <span class="pl-date">${l.date}</span>
            <span class="pl-meta">${l.variant === 'home' ? 'Home' : 'Gym'} &middot; ${count} exercise${count === 1 ? '' : 's'}</span>
            <button class="pl-edit" data-date="${l.date}" data-variant="${l.variant}" title="Load into form">&#9998;</button>
            <button class="pl-del" data-date="${l.date}" data-variant="${l.variant}" title="Delete">&times;</button>
          </div>
          <div class="pl-detail ${open ? 'open' : ''}">${trRenderLogDetail(l, prev)}</div>
        </div>`;
      }).join('')}
    </div>

    <div class="section-title" style="margin-top:20px;">Progress</div>
    <select id="trProgressExercise" style="width:100%; padding:7px 8px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:13px; margin-bottom:4px;">
      ${trProgressExerciseNames(trActivePerson, dayKey, trActiveVariant, list).map(o => `<option value="${o.name}">${o.name}${o.retired ? ' (no longer in plan)' : ''}</option>`).join('')}
    </select>
    <div id="trProgressChart"></div>
  `;
}

function trExerciseProgressPoints(person, dayKey, variant, exerciseName) {
  return (trTrainingLog[person] || [])
    .filter(l => l.day === dayKey && l.variant === variant && l.weights[exerciseName] !== undefined)
    .map(l => ({ date: l.date, value: l.weights[exerciseName] }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Progress dropdown options: current plan exercises first, plus any exercise names that
// have historical logs for this day/variant but were later removed from the plan (e.g. a
// swapped exercise) — those must stay selectable so their past progress data doesn't
// become unreachable just because the plan changed.
function trProgressExerciseNames(person, dayKey, variant, list) {
  const planNames = list.map(ex => ex[0]);
  const logged = new Set();
  (trTrainingLog[person] || []).forEach(l => {
    if (l.day === dayKey && l.variant === variant) Object.keys(l.weights).forEach(n => logged.add(n));
  });
  const retired = [...logged].filter(n => !planNames.includes(n));
  return planNames.concat(retired).map(name => ({ name, retired: !planNames.includes(name) }));
}

function trRenderProgressChart() {
  const select = document.getElementById('trProgressExercise');
  const chartEl = document.getElementById('trProgressChart');
  if (!select || !chartEl) return;
  const exName = select.value || null;
  if (!exName) { chartEl.innerHTML = ''; return; }
  const points = trExerciseProgressPoints(trActivePerson, trActiveDay, trActiveVariant, exName);
  chartEl.innerHTML = buildTrendChart(points, { color: '--' + trActivePerson, unit: 'kg', detailId: 'trProgressDetail' });
  chartEl.querySelectorAll('.trend-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const p = points[parseInt(dot.dataset.i)];
      document.getElementById('trProgressDetail').textContent = `${p.date}: ${p.value}kg`;
    });
  });
}

function trLoadLogIntoForm(dayKey, list, variant) {
  const dateInput = document.getElementById('logDate');
  const date = dateInput.value;
  const existing = trFindLog(trActivePerson, dayKey, date, variant);
  const prev = trFindPreviousLog(trActivePerson, dayKey, variant, date);
  list.forEach((ex, i) => {
    const input = document.getElementById('logW_' + i);
    if (!input) return;
    input.value = existing && existing.weights[ex[0]] !== undefined ? existing.weights[ex[0]] : '';
    const hint = document.getElementById('lwLast_' + i);
    if (hint) {
      const prevW = prev && prev.weights[ex[0]] !== undefined ? prev.weights[ex[0]] : null;
      hint.textContent = prevW !== null ? `last: ${prevW}kg` : '';
      hint.classList.toggle('has-val', prevW !== null);
      if (prevW !== null) hint.dataset.val = prevW; else delete hint.dataset.val;
    }
  });
}

function trSaveLog(dayKey, list, variant) {
  const date = document.getElementById('logDate').value || todayStr();
  const weights = {};
  list.forEach((ex, i) => {
    const v = parseFloat(document.getElementById('logW_' + i).value);
    if (!isNaN(v)) weights[ex[0]] = v;
  });
  if (Object.keys(weights).length === 0) {
    const errEl = document.getElementById('logError');
    if (errEl) errEl.style.display = '';
    return;
  }
  if (!trTrainingLog[trActivePerson]) trTrainingLog[trActivePerson] = [];
  const arr = trTrainingLog[trActivePerson];
  const idx = arr.findIndex(l => l.day === dayKey && l.date === date && l.variant === variant);
  const entry = { date, day: dayKey, variant, weights };
  if (idx >= 0) arr[idx] = entry; else arr.push(entry);
  try { localStorage.setItem('training_log', JSON.stringify(trTrainingLog)); } catch (err) {}
  trPushToCloud();
  trRenderContent();
}

function trDeleteLog(dayKey, date, variant) {
  if (!confirm(`Delete the workout logged on ${date}?`)) return;
  const arr = trTrainingLog[trActivePerson] || [];
  const idx = arr.findIndex(l => l.day === dayKey && l.date === date && l.variant === variant);
  if (idx >= 0) arr.splice(idx, 1);
  try { localStorage.setItem('training_log', JSON.stringify(trTrainingLog)); } catch (err) {}
  trPushToCloud({ skipMerge: true });
  trRenderContent();
}

let trPendingViewLog = null;

// Selected date in the core-stability save form — kept across re-renders so saving
// doesn't silently jump the date picker back to today.
let trCoreLogDate = null;

function trLoadCoreCheckboxForDate() {
  const dateInput = document.getElementById('coreLogDate');
  const checkbox = document.getElementById('coreDoneCheckbox');
  if (!dateInput || !checkbox) return;
  trCoreLogDate = dateInput.value;
  checkbox.checked = (trCoreLog[trActivePerson] || []).includes(trCoreLogDate);
}

function trSaveCoreLog() {
  const ds = document.getElementById('coreLogDate').value || todayStr();
  const checked = document.getElementById('coreDoneCheckbox').checked;
  trCoreLogDate = ds;
  const arr = trCoreLog[trActivePerson] || (trCoreLog[trActivePerson] = []);
  const idx = arr.indexOf(ds);
  const wasPresent = idx >= 0;
  if (checked && !wasPresent) arr.push(ds);
  else if (!checked && wasPresent) arr.splice(idx, 1);
  else return;
  try { localStorage.setItem('training_coreLog', JSON.stringify(trCoreLog)); } catch (err) {}
  // Unchecking is a delete — skip the merge so a stale remote copy can't bring it back.
  trPushToCloud({ skipMerge: !checked });
}

// Same pattern as trCoreLogDate/trLoadCoreCheckboxForDate/trSaveCoreLog, for the p1-only
// "10,000+ steps" checkbox.
let trStepsCheckDate = null;

function trLoadStepsCheckboxForDate() {
  const dateInput = document.getElementById('stepsCheckDate');
  const checkbox = document.getElementById('stepsCheckCheckbox');
  if (!dateInput || !checkbox) return;
  trStepsCheckDate = dateInput.value;
  checkbox.checked = (trStepsCheckLog.p1 || []).includes(trStepsCheckDate);
}

function trSaveStepsCheck() {
  const ds = document.getElementById('stepsCheckDate').value || todayStr();
  const checked = document.getElementById('stepsCheckCheckbox').checked;
  trStepsCheckDate = ds;
  const arr = trStepsCheckLog.p1 || (trStepsCheckLog.p1 = []);
  const idx = arr.indexOf(ds);
  const wasPresent = idx >= 0;
  if (checked && !wasPresent) arr.push(ds);
  else if (!checked && wasPresent) arr.splice(idx, 1);
  else return;
  try { localStorage.setItem('training_stepsCheckLog', JSON.stringify(trStepsCheckLog)); } catch (err) {}
  trPushToCloud({ skipMerge: !checked });
}

// Same pattern as trCoreLogDate/trLoadCoreCheckboxForDate/trSaveCoreLog, generalized to
// however many extra activities the active person has (see TR_EXTRA_ACTIVITIES).
let trExtraLogDates = {};

function trLoadExtraActivityCheckbox(activity) {
  const dateInput = document.querySelector(`.extra-activity-date[data-activity="${activity}"]`);
  const checkbox = document.querySelector(`.extra-activity-checkbox[data-activity="${activity}"]`);
  if (!dateInput || !checkbox) return;
  trExtraLogDates[activity] = dateInput.value;
  checkbox.checked = ((trExtraLog[trActivePerson] || {})[activity] || []).includes(dateInput.value);
}

function trSaveExtraActivity(activity) {
  const dateInput = document.querySelector(`.extra-activity-date[data-activity="${activity}"]`);
  const checkbox = document.querySelector(`.extra-activity-checkbox[data-activity="${activity}"]`);
  if (!dateInput || !checkbox) return;
  const ds = dateInput.value || todayStr();
  const checked = checkbox.checked;
  trExtraLogDates[activity] = ds;
  if (!trExtraLog[trActivePerson]) trExtraLog[trActivePerson] = {};
  const arr = trExtraLog[trActivePerson][activity] || (trExtraLog[trActivePerson][activity] = []);
  const idx = arr.indexOf(ds);
  const wasPresent = idx >= 0;
  if (checked && !wasPresent) arr.push(ds);
  else if (!checked && wasPresent) arr.splice(idx, 1);
  else return;
  try { localStorage.setItem('training_extraLog', JSON.stringify(trExtraLog)); } catch (err) {}
  trPushToCloud({ skipMerge: !checked });
}

function trRenderBackCare(bc) {
  return `
    <h2>Back care</h2>
    <p class="card-sub">${bc.intro}</p>
    ${bc.sections.map(s => {
      const isCore = s.title.indexOf('Core stability') === 0;
      return `
      <div class="section-title">${s.title}</div>
      ${s.items.map(trExRow).join('')}
      ${isCore ? `
        <div class="core-log-row">
          <label class="core-check-inline">
            <input type="checkbox" id="coreDoneCheckbox">
            <span>Done</span>
          </label>
          <input type="date" id="coreLogDate">
          <button class="primary" id="coreSaveBtn">Save</button>
        </div>
      ` : ''}
    `;
    }).join('')}
    <p class="note" style="margin-top:14px;">${bc.tightNote}</p>
  `;
}

function trRenderContent() {
  const plan = trCurrentPlan();
  const contentEl = document.getElementById('trContent');
  if (!plan) {
    contentEl.innerHTML = `<div class="empty-state">No training plan added for Partner yet.</div>`;
    return;
  }
  if (trActiveDay === 'overview') {
    contentEl.innerHTML = trRenderOverview(plan.overview);
    document.getElementById('trOverviewPrevMonthBtn').addEventListener('click', () => {
      trOverviewViewedMonth = new Date(trOverviewViewedMonth.getFullYear(), trOverviewViewedMonth.getMonth() - 1, 1);
      trRenderOverviewCalendarGrid();
    });
    document.getElementById('trOverviewNextMonthBtn').addEventListener('click', () => {
      const now = new Date();
      const nowMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      if (trOverviewViewedMonth.getTime() >= nowMonthStart.getTime()) return;
      trOverviewViewedMonth = new Date(trOverviewViewedMonth.getFullYear(), trOverviewViewedMonth.getMonth() + 1, 1);
      trRenderOverviewCalendarGrid();
    });
    trRenderOverviewCalendarGrid();
    trRenderOverviewSelectedDay();
    (TR_EXTRA_ACTIVITIES[trActivePerson] || []).forEach(act => {
      const dateInput = document.querySelector(`.extra-activity-date[data-activity="${act}"]`);
      if (dateInput) {
        dateInput.max = todayStr();
        dateInput.value = trExtraLogDates[act] || todayStr();
        dateInput.addEventListener('change', () => trLoadExtraActivityCheckbox(act));
      }
      trLoadExtraActivityCheckbox(act);
      const saveBtn = document.querySelector(`.extra-activity-save[data-activity="${act}"]`);
      if (saveBtn) saveBtn.addEventListener('click', () => trSaveExtraActivity(act));
    });
    if (trActivePerson === 'p1') {
      const stepsDateInput = document.getElementById('stepsCheckDate');
      if (stepsDateInput) {
        stepsDateInput.max = todayStr();
        stepsDateInput.value = trStepsCheckDate || todayStr();
        stepsDateInput.addEventListener('change', trLoadStepsCheckboxForDate);
      }
      trLoadStepsCheckboxForDate();
      const stepsSaveBtn = document.getElementById('stepsCheckSaveBtn');
      if (stepsSaveBtn) stepsSaveBtn.addEventListener('click', trSaveStepsCheck);
    }
  } else if (trActiveDay === 'backcare') {
    contentEl.innerHTML = trRenderBackCare(plan.backcare);
    const coreDateInput = document.getElementById('coreLogDate');
    if (coreDateInput) {
      coreDateInput.max = todayStr();
      coreDateInput.value = trCoreLogDate || todayStr();
      trLoadCoreCheckboxForDate();
      coreDateInput.addEventListener('change', trLoadCoreCheckboxForDate);
    }
    const coreSaveBtn = document.getElementById('coreSaveBtn');
    if (coreSaveBtn) coreSaveBtn.addEventListener('click', trSaveCoreLog);
  } else {
    const day = plan[trActiveDay];
    contentEl.innerHTML = trRenderDay(day, trActiveDay);
    const gymBtn = document.getElementById('variantGym');
    const homeBtn = document.getElementById('variantHome');
    if (gymBtn) gymBtn.addEventListener('click', () => { trActiveVariant = 'gym'; trRenderContent(); });
    if (homeBtn) homeBtn.addEventListener('click', () => { trActiveVariant = 'home'; trRenderContent(); });

    const hasVariants = !!(day.gym && day.home);
    const list = hasVariants ? (trActiveVariant === 'gym' ? day.gym : day.home) : day.gym;

    const dateInput = document.getElementById('logDate');
    if (dateInput) {
      dateInput.max = todayStr();
      dateInput.value = trPendingViewLog ? trPendingViewLog.date : todayStr();
      trLoadLogIntoForm(trActiveDay, list, trActiveVariant);
      dateInput.addEventListener('change', () => trLoadLogIntoForm(trActiveDay, list, trActiveVariant));
    }
    trPendingViewLog = null;

    const saveBtn = document.getElementById('saveLogBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => trSaveLog(trActiveDay, list, trActiveVariant));

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
        trDeleteLog(trActiveDay, btn.dataset.date, btn.dataset.variant);
      });
    });
    document.querySelectorAll('#trContent .pl-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const date = btn.dataset.date;
        const variant = btn.dataset.variant;
        if (variant !== trActiveVariant) {
          trActiveVariant = variant;
          trPendingViewLog = { date };
          trRenderContent();
        } else {
          document.getElementById('logDate').value = date;
          trLoadLogIntoForm(trActiveDay, list, trActiveVariant);
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
}

function trRenderAll() {
  trRenderPersonTabs();
  trRenderDayTabs();
  trRenderContent();
  renderTodayCard();
}

function trLoadData() {
  try {
    trTrainingLog = JSON.parse(localStorage.getItem('training_log') || '{}');
    trTrainingLog.p1 = trTrainingLog.p1 || [];
    trTrainingLog.p2 = trTrainingLog.p2 || [];
  } catch (err) { trTrainingLog = { p1: [], p2: [] }; }
  try {
    trCoreLog = JSON.parse(localStorage.getItem('training_coreLog') || '{}');
    trCoreLog.p1 = trCoreLog.p1 || [];
    trCoreLog.p2 = trCoreLog.p2 || [];
  } catch (err) { trCoreLog = { p1: [], p2: [] }; }
  try {
    trExtraLog = JSON.parse(localStorage.getItem('training_extraLog') || '{}');
    trExtraLog.p1 = trExtraLog.p1 || {};
    trExtraLog.p2 = trExtraLog.p2 || {};
  } catch (err) { trExtraLog = { p1: {}, p2: {} }; }
  try {
    trStepsCheckLog = JSON.parse(localStorage.getItem('training_stepsCheckLog') || '{}');
    trStepsCheckLog.p1 = trStepsCheckLog.p1 || [];
    trStepsCheckLog.p2 = trStepsCheckLog.p2 || [];
  } catch (err) { trStepsCheckLog = { p1: [], p2: [] }; }

  const now = new Date();
  trOverviewViewedMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  trRenderAll();
  trApplyLegacyExerciseRenames();
}

register('training', {
  loadData: trLoadData,
  subscribe: (code) => trSubscribeToCloud(code),
  renderAll: trRenderAll,
  isDoneToday: (pk) => trLogsForDate(pk, todayStr()).length > 0 || (trCoreLog[pk] || []).includes(todayStr())
    || (TR_EXTRA_ACTIVITIES[pk] || []).some(act => ((trExtraLog[pk] || {})[act] || []).includes(todayStr()))
    || (pk === 'p1' && (trStepsCheckLog.p1 || []).includes(todayStr())),
  glanceHtml: () => {
    const pk = trActivePerson;
    const n = trWeekLogCount(pk, getMonday(new Date()));
    const streak = trCurrentStreak(pk);
    return `<b>${n}/${TR_STREAK_MIN_LOGS}</b> sessions this week`
      + (streak > 0 ? ` &middot; &#128293;${streak}-wk streak` : '');
  },
  jumpToToday: (pk) => {
    trActivePerson = pk;
    saveActivePerson('trActivePerson', pk);
    trActiveDay = 'overview';
    trOverviewSelectedDate = todayStr();
    trRenderAll();
  },
  setPerson: (pk) => {
    trActivePerson = pk;
    saveActivePerson('trActivePerson', pk);
    const order = (trCurrentPlan() && trCurrentPlan().dayOrder) || DAY_ORDER;
    if (!order.includes(trActiveDay)) trActiveDay = 'overview';
    trActiveVariant = 'gym';
    trRenderAll();
  },
  onSettingsChanged: () => { trRenderPersonTabs(); trRenderDayTabs(); trRenderContent(); trPushToCloud(); },
  exportData: () => ({
    trainingLog: trTrainingLog, coreLog: trCoreLog,
    stepsCheckLog: trStepsCheckLog, extraLog: trExtraLog
  })
});
