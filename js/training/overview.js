import { TR_STEPS_GOAL, TR_STREAK_MIN_LOGS, state, trCurrentStreak, trDayShortLabel, trDayVariantLabel, trFindPreviousLog, trFirstActivityDate, trLogsForDate, trRenderLogDetail, trWeekLogCount } from './state.js';
import { buildMonthGrid, feature, getMonday, todayStr } from '../core.js';
import { TR_EXTRA_ACTIVITIES } from '../data.js';
import { sharedSettings } from '../shared.js';

export function trRenderOverview(plan) {
  const streak = trCurrentStreak(state.trActivePerson);
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
      <span><span class="legend-swatch" style="background:var(--red-border)"></span>No sport</span>
      <span><span class="legend-swatch" style="background:var(--blue-border)"></span>Vacation</span>
      <span><span class="legend-swatch" style="background:var(--heat-none)"></span>Not logged</span>
    </div>
    <div id="trOverviewSelectedDay"></div>

    ${(TR_EXTRA_ACTIVITIES[state.trActivePerson] || []).length ? `
      <div class="section-title">Other activities</div>
      ${TR_EXTRA_ACTIVITIES[state.trActivePerson].map(act => `
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

    ${state.trActivePerson === 'p1' ? `
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

export function trRenderOverviewCalendarGrid() {
  const year = state.trOverviewViewedMonth.getFullYear();
  const month = state.trOverviewViewedMonth.getMonth();
  document.getElementById('trOverviewMonthLabel').textContent = state.trOverviewViewedMonth.toLocaleDateString(undefined, { month:'long', year:'numeric' });

  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const nextBtn = document.getElementById('trOverviewNextMonthBtn');
  nextBtn.disabled = isCurrentMonth;
  nextBtn.style.opacity = isCurrentMonth ? 0.4 : 1;
  nextBtn.style.cursor = isCurrentMonth ? 'default' : 'pointer';

  const cells = buildMonthGrid(year, month);
  const wrap = document.getElementById('trOverviewCalGrid');
  // Vacations are defined in the Calories tab's Goals card but color this calendar
  // too — cross-feature, so it comes through the registry, never a direct import.
  const isVacationDay = (feature('calories') || {}).isVacationDay || (() => false);
  const today = todayStr();
  const firstActivity = trFirstActivityDate(state.trActivePerson);
  wrap.innerHTML = cells.map(d => {
    if (d === null) return '<div class="month-day blank"></div>';
    const ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const logs = trLogsForDate(state.trActivePerson, ds);
    const coreDone = (state.trCoreLog[state.trActivePerson] || []).includes(ds);
    const extraDone = (TR_EXTRA_ACTIVITIES[state.trActivePerson] || []).filter(act => ((state.trExtraLog[state.trActivePerson] || {})[act] || []).includes(ds));
    const stepsDone = state.trActivePerson === 'p1' && (state.trStepsCheckLog.p1 || []).includes(ds);
    const hasAny = logs.length > 0 || coreDone || extraDone.length > 0 || stepsDone;
    // A trained vacation day still shows green; today isn't red yet — it's not over.
    const vacation = !hasAny && isVacationDay(ds);
    const missed = !hasAny && !vacation && firstActivity && ds >= firstActivity && ds < today;
    const status = hasAny ? 'good' : vacation ? 'vacation' : missed ? 'bad' : '';
    const selected = state.trOverviewSelectedDate === ds ? ' selected' : '';
    const titleParts = logs.map(trDayVariantLabel).concat(extraDone);
    if (coreDone) titleParts.push('Core stability');
    if (stepsDone) titleParts.push(`${TR_STEPS_GOAL.toLocaleString()}+ steps`);
    const title = hasAny ? ds + ': ' + titleParts.join(', ')
      : vacation ? ds + ': vacation'
      : missed ? ds + ': no sport' : ds + ': not logged';
    const labelParts = logs.map(trDayShortLabel).concat(extraDone.map(act => act[0]));
    if (coreDone) labelParts.push('C');
    if (stepsDone) labelParts.push('S');
    const label = labelParts.join('/');
    return `<div class="month-day ${status}${selected}" data-date="${ds}" title="${title}">${label}</div>`;
  }).join('');
  wrap.querySelectorAll('.month-day[data-date]').forEach(el => {
    el.addEventListener('click', () => {
      const ds = el.dataset.date;
      state.trOverviewSelectedDate = ds;
      trRenderOverviewCalendarGrid();
      trRenderOverviewSelectedDay();
      // Also jump the steps / extra-activity date pickers below to the tapped day,
      // so (un)checking Tennis or 10k steps for that day doesn't need a re-pick.
      if (ds <= todayStr()) {
        document.querySelectorAll('.extra-activity-date, #stepsCheckDate').forEach(inp => {
          if (inp.value === ds) return;
          inp.value = ds;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
    });
  });
}

export function trRenderOverviewSelectedDay() {
  const el = document.getElementById('trOverviewSelectedDay');
  if (!el) return;
  if (!state.trOverviewSelectedDate) {
    el.innerHTML = '<div class="empty-state" style="padding:0.5rem 0;">Tap a day in the calendar to see what was logged.</div>';
    return;
  }
  const logs = trLogsForDate(state.trActivePerson, state.trOverviewSelectedDate);
  const coreDone = (state.trCoreLog[state.trActivePerson] || []).includes(state.trOverviewSelectedDate);
  const extraDone = (TR_EXTRA_ACTIVITIES[state.trActivePerson] || []).filter(act => ((state.trExtraLog[state.trActivePerson] || {})[act] || []).includes(state.trOverviewSelectedDate));
  const stepsDone = state.trActivePerson === 'p1' && (state.trStepsCheckLog.p1 || []).includes(state.trOverviewSelectedDate);
  if (logs.length === 0 && !coreDone && extraDone.length === 0 && !stepsDone) {
    el.innerHTML = `<div class="empty-state" style="padding:0.5rem 0;">No training logged on ${state.trOverviewSelectedDate}.</div>`;
    return;
  }
  const coreHtml = coreDone ? `<div class="past-log-row" style="margin-bottom:8px;">
    <div class="pl-header" style="cursor:default;">
      <span class="pl-date">${state.trOverviewSelectedDate}</span>
      <span class="pl-meta">Core stability block</span>
    </div>
  </div>` : '';
  const stepsHtml = stepsDone ? `<div class="past-log-row" style="margin-bottom:8px;">
    <div class="pl-header" style="cursor:default;">
      <span class="pl-date">${state.trOverviewSelectedDate}</span>
      <span class="pl-meta">${TR_STEPS_GOAL.toLocaleString()}+ steps</span>
    </div>
  </div>` : '';
  const extraHtml = extraDone.map(act => `<div class="past-log-row" style="margin-bottom:8px;">
    <div class="pl-header" style="cursor:default;">
      <span class="pl-date">${state.trOverviewSelectedDate}</span>
      <span class="pl-meta">${act}</span>
    </div>
  </div>`).join('');
  el.innerHTML = coreHtml + stepsHtml + extraHtml + logs.map(l => {
    const prev = trFindPreviousLog(state.trActivePerson, l.day, l.variant, l.date);
    return `<div class="past-log-row" style="margin-bottom:8px;">
      <div class="pl-header" style="cursor:default;">
        <span class="pl-date">${l.date}</span>
        <span class="pl-meta">${trDayVariantLabel(l)}</span>
      </div>
      <div class="pl-detail open">${trRenderLogDetail(l, prev)}</div>
    </div>`;
  }).join('');
}
