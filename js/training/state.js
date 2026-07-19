import { dstr, getMonday, loadActivePerson } from '../core.js';
import { DAY_LABELS_TR, PLAN_P1, PLAN_P2 } from '../data.js';

// Shared mutable state for this feature. One object so any sibling file can
// reassign fields; single-file state stays as plain lets in its own file.
export const state = {
  trActivePerson: loadActivePerson('trActivePerson'),
  trActiveDay: 'overview',
  trActiveVariant: 'gym',
  trTrainingLog: { p1: [], p2: [] },
  // Dates (YYYY-MM-DD) the core stability block was done — a single checkbox per day,
  // not a per-exercise log like trTrainingLog. Doesn't count toward trWeekLogCount: it's a
  // short add-on, not a standalone session, so it shouldn't inflate the weekly session
  // total or streak the way a real workout/activity does.
  trCoreLog: { p1: [], p2: [] },
  // Other loggable activities outside the day1-day5 plan — person -> activity name -> dates
  // (same shape/merge semantics as trCoreLog), but these DO count as real sessions since
  // they're standalone efforts, not a finisher tacked onto another workout.
  trExtraLog: { p1: {}, p2: {} },
  // Simple "hit 10,000+ steps today" checkbox, same shape/treatment as trCoreLog: a plain
  // array of dates, doesn't count toward trWeekLogCount (it's a passive daily target, not a
  // session). p1-only — the checkbox only renders when viewing him.
  trStepsCheckLog: { p1: [], p2: [] },
  trOverviewViewedMonth: null,
  trOverviewSelectedDate: null,
  // Selected date in the core-stability save form — kept across re-renders so saving
  // doesn't silently jump the date picker back to today.
  trCoreLogDate: null,
  // Same pattern as trCoreLogDate/trLoadCoreCheckboxForDate/trSaveCoreLog, for the p1-only
  // "10,000+ steps" checkbox.
  trStepsCheckDate: null,
  // Same pattern as trCoreLogDate/trLoadCoreCheckboxForDate/trSaveCoreLog, generalized to
  // however many extra activities the active person has (see TR_EXTRA_ACTIVITIES).
  trExtraLogDates: {},
  // The workout-log form's chosen date, kept across re-renders (saving, remote-sync
  // renders, variant switches) so it doesn't silently snap back to today mid-logging.
  // Cleared (= today) on person/day-tab switches and jumpToToday.
  trLogDate: null,
  // Show the "Saved ✓" note in the log form while now < this timestamp — it has to
  // survive the immediate re-render AND the async post-push re-render.
  trSavedFlashUntil: 0,
};

// Late-bound entry points assigned by index.js — used for the few upward
// calls (e.g. sync re-rendering after a remote update) so imports stay one-way.
export const ui = {};

export const TR_STEPS_GOAL = 10000;

export function trCurrentPlan() { return state.trActivePerson === 'p1' ? PLAN_P1 : PLAN_P2; }

export function trExName(name, url) {
  return url
    ? `<a class="ex-video-link" href="${url}" target="_blank" rel="noopener">${name}<span class="ex-play">&#9654;</span></a>`
    : name;
}

export function trExRow([name, reps, url]) {
  return `<div class="ex-row"><span class="ex-name">${trExName(name, url)}</span><span class="ex-reps">${reps}</span></div>`;
}

export function trLogsForDate(person, dateStr) {
  return (state.trTrainingLog[person] || []).filter(l => l.date === dateStr);
}

// Earliest date this person ever logged anything (workout, core, extra activity, or a
// steps check) — the calendar's "no sport" red marks only start here, so months from
// before tracking began don't render as a wall of misses.
export function trFirstActivityDate(person) {
  const dates = (state.trTrainingLog[person] || []).map(l => l.date)
    .concat(state.trCoreLog[person] || [], state.trStepsCheckLog[person] || []);
  Object.values(state.trExtraLog[person] || {}).forEach(ds => dates.push(...ds));
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}

export const TR_STREAK_MIN_LOGS = 4;

// Core stability is intentionally excluded here — it's a short add-on, not a standalone
// session, so it shouldn't inflate the weekly count or streak. Other logged activities
// (Tennis, Hyrox, Runs, ...) DO count since they're real standalone efforts.
export function trWeekLogCount(person, weekMonday) {
  const start = dstr(weekMonday);
  const sunday = new Date(weekMonday); sunday.setDate(sunday.getDate() + 6);
  const end = dstr(sunday);
  const workoutCount = (state.trTrainingLog[person] || []).filter(l => l.date >= start && l.date <= end).length;
  const extraCount = Object.values(state.trExtraLog[person] || {})
    .reduce((sum, dates) => sum + dates.filter(ds => ds >= start && ds <= end).length, 0);
  return workoutCount + extraCount;
}

// Consecutive weeks (including the current in-progress one, since training is a flexible
// rotation rather than a daily habit) with at least TR_STREAK_MIN_LOGS total sessions
// (workouts + other logged activities combined — see trWeekLogCount for why core doesn't
// count here).
export function trCurrentStreak(person) {
  let monday = getMonday(new Date());
  let streak = 0;
  for (let i = 0; i < 52; i++) {
    if (trWeekLogCount(person, monday) < TR_STREAK_MIN_LOGS) break;
    streak++;
    monday.setDate(monday.getDate() - 7);
  }
  return streak;
}

export function trDayVariantLabel(l) {
  const label = DAY_LABELS_TR[l.day] || l.day;
  return l.variant === 'home' ? label + ' (Home)' : l.variant === 'gym' ? label + ' (Gym)' : label;
}

// Short label shown directly inside the calendar square, e.g. "day2" -> "D2".
export function trDayShortLabel(l) {
  const m = /^day(\d+)$/.exec(l.day);
  return m ? 'D' + m[1] : (l.day === 'backcare' ? 'BC' : l.day);
}

export function trDayLogs(person, dayKey) {
  return (state.trTrainingLog[person] || []).filter(l => l.day === dayKey).sort((a, b) => b.date.localeCompare(a.date));
}

export function trFindLog(person, dayKey, date, variant) {
  return (state.trTrainingLog[person] || []).find(l => l.day === dayKey && l.date === date && l.variant === variant);
}

export function trFindPreviousLog(person, dayKey, variant, beforeDate) {
  const arr = (state.trTrainingLog[person] || [])
    .filter(l => l.day === dayKey && l.variant === variant && l.date < beforeDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  return arr[0] || null;
}

export const trExpandedLogs = new Set();
export function trLogKey(date, variant) { return date + '|' + variant; }

// Exercise names in the order the training plan lists them for this log's day+variant,
// so past sessions display in plan order instead of the object's insertion order.
function trExerciseOrderForLog(l) {
  const plan = trCurrentPlan();
  const day = plan && plan[l.day];
  if (!day) return [];
  const orderList = (day.home && l.variant === 'home') ? day.home : day.gym;
  return (orderList || []).map(ex => ex[0]);
}

export function trRenderLogDetail(l, prev) {
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
