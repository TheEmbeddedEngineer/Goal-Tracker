import { calRound2, dstr, loadActivePerson, query, todayStr } from '../core.js';

// Shared mutable state for this feature. One object so any sibling file can
// reassign fields; single-file state stays as plain lets in its own file.
export const state = {
  calEntries: {},
  calGoals: { p1: { calories: 2000, protein: 120 }, p2: { calories: 2000, protein: 120 } },
  // Goals in effect for a given past day, frozen at the moment the goal changes so that
  // editing goals later doesn't retroactively change how already-logged days evaluate.
  calDailyGoals: {},
  calFoodBank: [],
  // Body weight log, keyed by person -> date -> kg. A plain map (no arrays), so it's
  // already safe under Firestore's merge:true without any extra merge-before-push logic.
  calWeightLog: { p1: {}, p2: {} },
  // Total calories burned that day (e.g. from a fitness tracker's TDEE reading) — same
  // shape and sync-safety as calWeightLog.
  calBurnLog: { p1: {}, p2: {} },
  calActivePerson: loadActivePerson('calActivePerson'),
  calViewedMonth: null,
  calSelectedMonthDate: null,
  calTopFoodsCache: { p1: [], p2: [] },
};

// Late-bound entry points assigned by index.js — used for the few upward
// calls (e.g. sync re-rendering after a remote update) so imports stay one-way.
export const ui = {};

export const CAL_DEFICIT_GOAL = 50000;
export const CAL_KCAL_PER_KG = CAL_DEFICIT_GOAL / 7; // the user's own stated ratio: ~50000 kcal ≈ 7kg

// Food log entries are the fast-growing, unbounded part of this data — everything ever
// logged, forever, at ~450 bytes/item in Firestore's format. Packed into the single
// `calories/{code}` doc alongside foodBank/settings/etc, they'd hit Firestore's 1 MiB
// per-document limit within months at normal logging pace (and once that doc is full,
// every write to it fails outright — including unrelated fields like weight/goals). So
// entries live in their own collection, one document per calendar month
// (`calorieEntries/{code}_{YYYY-MM}`), which keeps every single document small and
// bounded forever. `calories/{code}` itself keeps only foodBank/settings/dailyGoals/
// weightLog/burnLog, which all stay small on their own.
export function calMonthKey(dateStr) { return dateStr.slice(0, 7); }

export function calGoalsForDay(dateStr) {
  return state.calDailyGoals[dateStr] || state.calGoals;
}

export function monthKey(y,m) { return y + '-' + String(m+1).padStart(2,'0'); }

// Same problem for a day's logged items: two devices logging around the same time can
// otherwise wipe out each other's additions for that day. Individual food items have no
// stable id, so identity is approximated by their full content — good enough to stop
// concurrent adds from being lost, at the cost of not being able to "merge" a concurrent
// edit to the exact same item (deletes/edits skip this merge entirely, see skipMerge).
export function calItemKey(it) {
  return [it.name, it.unit, it.grams, it.calories, it.protein, it.carbs, it.fat, it.category].join('|');
}

export function calSelectedDate() { return document.getElementById('calDatePicker').value || todayStr(); }

export function calDayItems(person, dateStr) {
  return ((state.calEntries[person] || {})[dateStr] || {}).items || [];
}

// Consecutive days with at least one food item logged, ending today — or yesterday if
// today hasn't been logged yet, so the streak doesn't look broken mid-day before there's
// been a chance to log anything.
export function calCurrentStreak(person) {
  let d = new Date();
  if (calDayItems(person, dstr(d)).length === 0) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (calDayItems(person, dstr(d)).length > 0) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function calDayTotals(person, dateStr) {
  const items = calDayItems(person, dateStr);
  const t = items.reduce((t, it) => ({
    calories: t.calories + (it.calories||0),
    protein: t.protein + (it.protein||0),
    carbs: t.carbs + (it.carbs||0),
    fat: t.fat + (it.fat||0)
  }), { calories:0, protein:0, carbs:0, fat:0 });
  return { calories: calRound2(t.calories), protein: calRound2(t.protein), carbs: calRound2(t.carbs), fat: calRound2(t.fat) };
}

export function calNormName(s) { return (s || '').trim().toLowerCase(); }

// A typed name may be "English", "Deutsch", or "English / Deutsch" (as inserted when picking a dropdown suggestion).
function calNameParts(name) { return (name || '').split('/').map(s => calNormName(s)).filter(Boolean); }

export function calFindInBank(name) {
  const parts = calNameParts(name);
  if (parts.length === 0) return null;
  return state.calFoodBank.find(f => parts.includes(calNormName(f.en)) || parts.includes(calNormName(f.de))) || null;
}

export function calSearchBank(query) {
  const n = calNormName(query);
  if (!n) return [];
  return state.calFoodBank.filter(f => calNormName(f.en).includes(n) || calNormName(f.de).includes(n)).slice(0, 8);
}

// Most-logged distinct foods for this person, ranked by how many times they've been
// logged (not recency). Computed once per page load / remote sync — see state.calTopFoodsCache
// — so the quick-add chips stay stable through a session instead of reshuffling after
// every add.
function calComputeTopFoods(person, limit) {
  const counts = new Map();
  Object.values(state.calEntries[person] || {}).forEach(day => {
    (day.items || []).forEach(it => {
      const entry = counts.get(it.name) || { count: 0, item: it };
      entry.count++;
      entry.item = it;
      counts.set(it.name, entry);
    });
  });
  return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, limit);
}

export function calRefreshTopFoodsCache() {
  state.calTopFoodsCache = { p1: calComputeTopFoods('p1', 10), p2: calComputeTopFoods('p2', 10) };
}
