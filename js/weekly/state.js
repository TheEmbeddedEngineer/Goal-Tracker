import { loadActivePerson } from '../core.js';

// Shared mutable state for this feature. One object so any sibling file can
// reassign fields; single-file state stays as plain lets in its own file.
export const state = {
  wkEntries: {},
  wkThresholds: { nutrition:5, screen:5, sport:5 },
  wkWeeklyThresholds: {},
  wkActivePerson: loadActivePerson('wkActivePerson'),
  wkViewedWeekMonday: null,
};

// Late-bound entry points assigned by index.js — used for the few upward
// calls (e.g. sync re-rendering after a remote update) so imports stay one-way.
export const ui = {};




export const CATS = [['nutrition','Nutrition'],['screen','Screen time'],['sport','Sport']];
export const DAY_LABELS = ['M','T','W','T','F','S','S'];
export const EARLIEST_VISIBLE_WEEK = '2026-06-29';
// Auto-checks from the other trackers (see wkRefreshAutoChecks) never touch days
// before this — the feature shipped 2026-07-16 and must not rewrite finished weeks.
export const WK_AUTOCHECK_START = '2026-07-15';
