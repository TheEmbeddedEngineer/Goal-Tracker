import { state, trDayLogs, trExName, trExRow, trExpandedLogs, trFindLog, trFindPreviousLog, trLogKey, trRenderLogDetail, ui } from './state.js';
import { trPushToCloud } from './sync.js';
import { buildTrendChart, todayStr } from '../core.js';

export function trRenderDay(day, dayKey) {
  const hasVariants = !!(day.gym && day.home);
  const list = hasVariants ? (state.trActiveVariant === 'gym' ? day.gym : day.home) : day.gym;
  const logs = trDayLogs(state.trActivePerson, dayKey);
  return `
    <h2>${day.title}</h2>
    <p class="card-sub">${day.duration}</p>
    ${hasVariants ? `
      <div class="variant-tabs">
        <button id="variantGym" class="${state.trActiveVariant === 'gym' ? 'active' : ''}">Gym</button>
        <button id="variantHome" class="${state.trActiveVariant === 'home' ? 'active' : ''}">Home (dumbbell)</button>
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
        const prev = trFindPreviousLog(state.trActivePerson, dayKey, l.variant, l.date);
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
      ${trProgressExerciseNames(state.trActivePerson, dayKey, state.trActiveVariant, list).map(o => `<option value="${o.name}">${o.name}${o.retired ? ' (no longer in plan)' : ''}</option>`).join('')}
    </select>
    <div id="trProgressChart"></div>
  `;
}

function trExerciseProgressPoints(person, dayKey, variant, exerciseName) {
  return (state.trTrainingLog[person] || [])
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
  (state.trTrainingLog[person] || []).forEach(l => {
    if (l.day === dayKey && l.variant === variant) Object.keys(l.weights).forEach(n => logged.add(n));
  });
  const retired = [...logged].filter(n => !planNames.includes(n));
  return planNames.concat(retired).map(name => ({ name, retired: !planNames.includes(name) }));
}

export function trRenderProgressChart() {
  const select = document.getElementById('trProgressExercise');
  const chartEl = document.getElementById('trProgressChart');
  if (!select || !chartEl) return;
  const exName = select.value || null;
  if (!exName) { chartEl.innerHTML = ''; return; }
  const points = trExerciseProgressPoints(state.trActivePerson, state.trActiveDay, state.trActiveVariant, exName);
  chartEl.innerHTML = buildTrendChart(points, { color: '--' + state.trActivePerson, unit: 'kg', detailId: 'trProgressDetail' });
  chartEl.querySelectorAll('.trend-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const p = points[parseInt(dot.dataset.i)];
      document.getElementById('trProgressDetail').textContent = `${p.date}: ${p.value}kg`;
    });
  });
}

export function trLoadLogIntoForm(dayKey, list, variant) {
  const dateInput = document.getElementById('logDate');
  const date = dateInput.value;
  const existing = trFindLog(state.trActivePerson, dayKey, date, variant);
  const prev = trFindPreviousLog(state.trActivePerson, dayKey, variant, date);
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

export function trSaveLog(dayKey, list, variant) {
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
  if (!state.trTrainingLog[state.trActivePerson]) state.trTrainingLog[state.trActivePerson] = [];
  const arr = state.trTrainingLog[state.trActivePerson];
  const idx = arr.findIndex(l => l.day === dayKey && l.date === date && l.variant === variant);
  const entry = { date, day: dayKey, variant, weights };
  if (idx >= 0) arr[idx] = entry; else arr.push(entry);
  try { localStorage.setItem('training_log', JSON.stringify(state.trTrainingLog)); } catch (err) {}
  trPushToCloud();
  ui.renderContent();
}

export function trDeleteLog(dayKey, date, variant) {
  if (!confirm(`Delete the workout logged on ${date}?`)) return;
  const arr = state.trTrainingLog[state.trActivePerson] || [];
  const idx = arr.findIndex(l => l.day === dayKey && l.date === date && l.variant === variant);
  if (idx >= 0) arr.splice(idx, 1);
  try { localStorage.setItem('training_log', JSON.stringify(state.trTrainingLog)); } catch (err) {}
  trPushToCloud({ skipMerge: true });
  ui.renderContent();
}

export function trLoadCoreCheckboxForDate() {
  const dateInput = document.getElementById('coreLogDate');
  const checkbox = document.getElementById('coreDoneCheckbox');
  if (!dateInput || !checkbox) return;
  state.trCoreLogDate = dateInput.value;
  checkbox.checked = (state.trCoreLog[state.trActivePerson] || []).includes(state.trCoreLogDate);
}

export function trSaveCoreLog() {
  const ds = document.getElementById('coreLogDate').value || todayStr();
  const checked = document.getElementById('coreDoneCheckbox').checked;
  state.trCoreLogDate = ds;
  const arr = state.trCoreLog[state.trActivePerson] || (state.trCoreLog[state.trActivePerson] = []);
  const idx = arr.indexOf(ds);
  const wasPresent = idx >= 0;
  if (checked && !wasPresent) arr.push(ds);
  else if (!checked && wasPresent) arr.splice(idx, 1);
  else return;
  try { localStorage.setItem('training_coreLog', JSON.stringify(state.trCoreLog)); } catch (err) {}
  // Unchecking is a delete — skip the merge so a stale remote copy can't bring it back.
  trPushToCloud({ skipMerge: !checked });
}

export function trLoadStepsCheckboxForDate() {
  const dateInput = document.getElementById('stepsCheckDate');
  const checkbox = document.getElementById('stepsCheckCheckbox');
  if (!dateInput || !checkbox) return;
  state.trStepsCheckDate = dateInput.value;
  checkbox.checked = (state.trStepsCheckLog.p1 || []).includes(state.trStepsCheckDate);
}

export function trSaveStepsCheck() {
  const ds = document.getElementById('stepsCheckDate').value || todayStr();
  const checked = document.getElementById('stepsCheckCheckbox').checked;
  state.trStepsCheckDate = ds;
  const arr = state.trStepsCheckLog.p1 || (state.trStepsCheckLog.p1 = []);
  const idx = arr.indexOf(ds);
  const wasPresent = idx >= 0;
  if (checked && !wasPresent) arr.push(ds);
  else if (!checked && wasPresent) arr.splice(idx, 1);
  else return;
  try { localStorage.setItem('training_stepsCheckLog', JSON.stringify(state.trStepsCheckLog)); } catch (err) {}
  trPushToCloud({ skipMerge: !checked });
}

export function trLoadExtraActivityCheckbox(activity) {
  const dateInput = document.querySelector(`.extra-activity-date[data-activity="${activity}"]`);
  const checkbox = document.querySelector(`.extra-activity-checkbox[data-activity="${activity}"]`);
  if (!dateInput || !checkbox) return;
  state.trExtraLogDates[activity] = dateInput.value;
  checkbox.checked = ((state.trExtraLog[state.trActivePerson] || {})[activity] || []).includes(dateInput.value);
}

export function trSaveExtraActivity(activity) {
  const dateInput = document.querySelector(`.extra-activity-date[data-activity="${activity}"]`);
  const checkbox = document.querySelector(`.extra-activity-checkbox[data-activity="${activity}"]`);
  if (!dateInput || !checkbox) return;
  const ds = dateInput.value || todayStr();
  const checked = checkbox.checked;
  state.trExtraLogDates[activity] = ds;
  if (!state.trExtraLog[state.trActivePerson]) state.trExtraLog[state.trActivePerson] = {};
  const arr = state.trExtraLog[state.trActivePerson][activity] || (state.trExtraLog[state.trActivePerson][activity] = []);
  const idx = arr.indexOf(ds);
  const wasPresent = idx >= 0;
  if (checked && !wasPresent) arr.push(ds);
  else if (!checked && wasPresent) arr.splice(idx, 1);
  else return;
  try { localStorage.setItem('training_extraLog', JSON.stringify(state.trExtraLog)); } catch (err) {}
  trPushToCloud({ skipMerge: !checked });
}

export function trRenderBackCare(bc) {
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
