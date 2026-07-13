import {
  db, doc, setDoc, getDoc, getDocs, deleteDoc, onSnapshot, collection,
  query, where, documentId, deleteField,
  ensureAuth, setSyncStatus, markSynced, coupleCode, confirmWipe, register,
  loadActivePerson, saveActivePerson, todayStr, parseDate, dstr, getMonday,
  calRound2, buildMonthGrid, buildTrendChart
} from './core.js';
import { sharedSettings, renderTodayCard, renderGlanceBar, applySharedSettingsToInputs } from './shared.js';
import { CAL_CATEGORIES, CAL_LEGACY_FIXES, CAL_NAME_FIXES } from './data.js';


function calPopulateCategorySelect() {
  const sel = document.getElementById('foodCategory');
  sel.innerHTML = CAL_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
}

let calEntries = {};
let calGoals = { p1: { calories: 2000, protein: 120 }, p2: { calories: 2000, protein: 120 } };
// Goals in effect for a given past day, frozen at the moment the goal changes so that
// editing goals later doesn't retroactively change how already-logged days evaluate.
let calDailyGoals = {};
let calFoodBank = [];
// Body weight log, keyed by person -> date -> kg. A plain map (no arrays), so it's
// already safe under Firestore's merge:true without any extra merge-before-push logic.
let calWeightLog = { p1: {}, p2: {} };
// Total calories burned that day (e.g. from a fitness tracker's TDEE reading) — same
// shape and sync-safety as calWeightLog.
let calBurnLog = { p1: {}, p2: {} };
const CAL_DEFICIT_GOAL = 50000;
const CAL_KCAL_PER_KG = CAL_DEFICIT_GOAL / 7; // the user's own stated ratio: ~50000 kcal ≈ 7kg
let calActivePerson = loadActivePerson('calActivePerson');
let calViewedMonth = null;
let calSelectedMonthDate = null;
let calUnsub = null;
let calEntriesUnsub = null;
let calApplyingRemote = false;
let calMigratingLegacyEntries = false;

// Food log entries are the fast-growing, unbounded part of this data — everything ever
// logged, forever, at ~450 bytes/item in Firestore's format. Packed into the single
// `calories/{code}` doc alongside foodBank/settings/etc, they'd hit Firestore's 1 MiB
// per-document limit within months at normal logging pace (and once that doc is full,
// every write to it fails outright — including unrelated fields like weight/goals). So
// entries live in their own collection, one document per calendar month
// (`calorieEntries/{code}_{YYYY-MM}`), which keeps every single document small and
// bounded forever. `calories/{code}` itself keeps only foodBank/settings/dailyGoals/
// weightLog/burnLog, which all stay small on their own.
function calMonthKey(dateStr) { return dateStr.slice(0, 7); }
function calEntryDocRef(code, monthKey) { return doc(db, 'calorieEntries', code + '_' + monthKey); }
function calEntriesCollectionQuery(code) {
  // Firestore has no "list docs by collection" for a client SDK without a field to filter
  // on, but document-id range queries work — this matches every calorieEntries doc whose
  // id starts with "{code}_" without needing a separate index of which months exist.
  return query(collection(db, 'calorieEntries'), where(documentId(), '>=', code + '_'), where(documentId(), '<', code + '_'));
}
function calEntriesSliceForMonth(monthKey, sourceEntries) {
  const source = sourceEntries || calEntries;
  const slice = { p1: {}, p2: {} };
  ['p1', 'p2'].forEach(pk => {
    Object.entries(source[pk] || {}).forEach(([ds, day]) => {
      if (calMonthKey(ds) === monthKey) slice[pk][ds] = day;
    });
  });
  return slice;
}
// Same content-hash merge as calMergeFoodBank/calItemKey, generalized to operate on a
// plain entries object (a whole calEntries tree, or just one month's slice of it) instead
// of always mutating the global calEntries directly.
function calMergeEntriesInto(localEntries, remoteEntries) {
  const merged = { p1: {}, p2: {} };
  ['p1', 'p2'].forEach(pk => {
    const localDays = (localEntries || {})[pk] || {};
    const remoteDays = (remoteEntries || {})[pk] || {};
    const allDates = new Set([...Object.keys(localDays), ...Object.keys(remoteDays)]);
    allDates.forEach(ds => {
      const localItems = (localDays[ds] || {}).items || [];
      const remoteItems = (remoteDays[ds] || {}).items || [];
      const byKey = new Map();
      remoteItems.forEach(it => byKey.set(calItemKey(it), it));
      localItems.forEach(it => byKey.set(calItemKey(it), it));
      merged[pk][ds] = { items: Array.from(byKey.values()) };
    });
  });
  return merged;
}

function calGoalsForDay(dateStr) {
  return calDailyGoals[dateStr] || calGoals;
}

function calLatestWeight(person) {
  const days = Object.keys(calWeightLog[person] || {}).sort();
  if (!days.length) return null;
  const last = days[days.length - 1];
  return { date: last, value: calWeightLog[person][last] };
}

function calRenderWeightCard() {
  const dateInput = document.getElementById('weightDate');
  if (!dateInput.value) dateInput.value = todayStr();
  dateInput.max = todayStr();
  const ds = dateInput.value;
  const existing = (calWeightLog[calActivePerson] || {})[ds];
  document.getElementById('weightValue').value = existing !== undefined ? existing : '';
  const latest = calLatestWeight(calActivePerson);
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
  const loggedDays = rows.filter(ds => (calWeightLog[calActivePerson] || {})[ds] !== undefined);
  if (loggedDays.length === 0) {
    if (label) label.textContent = '';
    el.innerHTML = '';
    return;
  }
  if (label) label.textContent = `Week of ${dstr(monday)} – ${dstr(sunday)}`;
  el.innerHTML = loggedDays.map(ds => {
    const val = calWeightLog[calActivePerson][ds];
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
      delete calWeightLog[calActivePerson][btn.dataset.date];
      try { localStorage.setItem('calorie_weightLog', JSON.stringify(calWeightLog)); } catch (err) {}
      calRenderWeightCard();
      calRenderTrendChart();
      calPushToCloud();
    });
  });
}

function calSaveWeight() {
  const ds = document.getElementById('weightDate').value || todayStr();
  const val = calRound2(parseFloat(document.getElementById('weightValue').value));
  if (isNaN(val) || val <= 0) { alert('Enter a valid weight.'); return; }
  if (!calWeightLog[calActivePerson]) calWeightLog[calActivePerson] = {};
  calWeightLog[calActivePerson][ds] = val;
  try { localStorage.setItem('calorie_weightLog', JSON.stringify(calWeightLog)); } catch (err) {}
  calRenderWeightCard();
  calRenderTrendChart();
  calPushToCloud();
}

function calLatestBurn(person) {
  const days = Object.keys(calBurnLog[person] || {}).sort();
  if (!days.length) return null;
  const last = days[days.length - 1];
  return { date: last, value: calBurnLog[person][last] };
}

function calRenderBurnCard() {
  const dateInput = document.getElementById('burnDate');
  if (!dateInput.value) dateInput.value = todayStr();
  dateInput.max = todayStr();
  const ds = dateInput.value;
  const existing = (calBurnLog[calActivePerson] || {})[ds];
  document.getElementById('burnValue').value = existing !== undefined ? existing : '';
  const latest = calLatestBurn(calActivePerson);
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
  const loggedDays = rows.filter(ds => (calBurnLog[calActivePerson] || {})[ds] !== undefined);
  if (loggedDays.length === 0) {
    if (label) label.textContent = '';
    el.innerHTML = '';
    return;
  }
  if (label) label.textContent = `Week of ${dstr(monday)} – ${dstr(sunday)}`;
  el.innerHTML = loggedDays.map(ds => {
    const val = calBurnLog[calActivePerson][ds];
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
      delete calBurnLog[calActivePerson][btn.dataset.date];
      try { localStorage.setItem('calorie_burnLog', JSON.stringify(calBurnLog)); } catch (err) {}
      calRenderBurnCard();
      calPushToCloud();
    });
  });
}

function calSaveBurn() {
  const ds = document.getElementById('burnDate').value || todayStr();
  const val = Math.round(parseFloat(document.getElementById('burnValue').value));
  if (isNaN(val) || val <= 0) { alert('Enter a valid calorie amount.'); return; }
  if (!calBurnLog[calActivePerson]) calBurnLog[calActivePerson] = {};
  calBurnLog[calActivePerson][ds] = val;
  try { localStorage.setItem('calorie_burnLog', JSON.stringify(calBurnLog)); } catch (err) {}
  calRenderBurnCard();
  calPushToCloud();
}

// Deficit = calories burned (total daily expenditure) - calories eaten. Only counted for
// days that have BOTH a burn entry and logged food — without both, there's nothing
// meaningful to compute (assuming 0 eaten on an unlogged day would wildly overstate it).
function calDailyDeficit(person, ds) {
  if (calDayItems(person, ds).length === 0) return null;
  let burned = (calBurnLog[person] || {})[ds];
  if (burned === undefined) {
    // Fall back to the configured default burn so a day with food logged but a
    // forgotten burn entry doesn't silently drop out of the deficit total.
    const fallback = (calGoals[person] || {}).defaultBurn;
    if (!(fallback > 0) || ds > todayStr()) return null;
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

function calCumulativeDeficit(person) {
  const days = new Set([...Object.keys(calBurnLog[person] || {}), ...Object.keys(calEntries[person] || {})]);
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
  const allDates = [...Object.keys(calBurnLog[person] || {}), ...Object.keys(calEntries[person] || {})];
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

function calRenderDeficitCard() {
  const el = document.getElementById('calDeficitBig');
  const card = document.getElementById('calDeficitCard');
  if (!el) return;
  // The 50,000 kcal / ~7kg deficit goal (CAL_DEFICIT_GOAL above) was set as a personal
  // target, not a shared couple feature — only show it for the person it was defined for
  // rather than presenting the other person with a goal they never set.
  if (card) card.style.display = calActivePerson === 'p1' ? '' : 'none';
  if (calActivePerson !== 'p1') return;
  const total = calCumulativeDeficit(calActivePerson);
  const weekTotal = calWeekDeficit(calActivePerson, getMonday(new Date()));
  const pct = Math.max(0, Math.min(100, (total / CAL_DEFICIT_GOAL) * 100));
  const kg = total / CAL_KCAL_PER_KG;
  const coverage = calDeficitDayCoverage(calActivePerson);
  el.innerHTML = `
    <div style="text-align:center; padding:8px 0;">
      <div style="font-size:36px; font-weight:700; color:var(--${calActivePerson});">${Math.round(total).toLocaleString()}</div>
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">of ${CAL_DEFICIT_GOAL.toLocaleString()} kcal deficit &middot; &asymp; ${kg.toFixed(1)}kg lost</div>
      <div style="height:10px; background:var(--border); border-radius:100px; overflow:hidden;">
        <div style="height:100%; width:${pct}%; background:var(--${calActivePerson}); border-radius:100px;"></div>
      </div>
    </div>
    <div class="recap-row"><span class="rname">This week's deficit</span><span class="rvalue">${Math.round(weekTotal).toLocaleString()} kcal</span></div>
    <div class="recap-row" title="A day only counts if it has both a calories-burned entry and logged food"><span class="rname">Days counted</span><span class="rvalue">${coverage.counted} of ${coverage.totalDays}</span></div>
  `;
}

function monthKey(y,m) { return y + '-' + String(m+1).padStart(2,'0'); }

function calApplyLegacyFixes() {
  let bankChanged = false;
  // calMergeFoodBank unions entries by "de" — changing an entry's "de" in place is really
  // a delete-under-the-old-key + add-under-the-new-key. A normal merge-before-push can't
  // tell that apart from "a new entry was added elsewhere," so it'd leave the untouched
  // remote copy sitting under the old key as a duplicate. Track it so the push below can
  // skip the merge, the same way a bank-entry delete or rename already has to.
  let bankDeKeyChanged = false;
  const entriesChangedDates = [];
  calFoodBank.forEach(entry => {
    if (entry.category) return;
    const fix = CAL_LEGACY_FIXES[entry.de] || CAL_LEGACY_FIXES[entry.en];
    entry.category = fix ? fix.category : 'Other';
    if (fix && fix.en) entry.en = fix.en;
    if (fix && fix.de && fix.de !== entry.de) { entry.de = fix.de; bankDeKeyChanged = true; }
    bankChanged = true;
  });

  calFoodBank.forEach(entry => {
    const fix = CAL_NAME_FIXES[entry.de];
    if (!fix) return;
    if (fix.en && entry.en !== fix.en) { entry.en = fix.en; bankChanged = true; }
    if (fix.de && entry.de !== fix.de) { entry.de = fix.de; bankChanged = true; bankDeKeyChanged = true; }
  });

  // One-time dedup: an old typo ("Heidelberren") created a duplicate of the already-
  // correct "Blueberries / Heidelbeeren" entry with identical reference values. Drop the
  // misspelled duplicate outright instead of renaming it, since renaming it would collide
  // with the entry that already exists under the correct name.
  const hasCorrectBlueberries = calFoodBank.some(e => e.de === 'Heidelbeeren');
  const beforeLen = calFoodBank.length;
  calFoodBank = calFoodBank.filter(e => !(hasCorrectBlueberries && (e.de === 'Heidelberren' || e.en === 'Heidelberren')));
  const bankEntryDeleted = calFoodBank.length !== beforeLen;
  if (bankEntryDeleted) bankChanged = true;

  // Logged days from before categories existed only have a category on the food
  // bank entry, not on the individual log item — backfill those too, so past days
  // group correctly instead of dumping everything into "Other".
  ['p1', 'p2'].forEach(pk => {
    const personEntries = calEntries[pk] || {};
    Object.entries(personEntries).forEach(([ds, day]) => {
      (day.items || []).forEach(item => {
        if (item.category) return;
        const bankEntry = calFindInBank(item.name);
        const fix = CAL_LEGACY_FIXES[item.name];
        item.category = (bankEntry && bankEntry.category) || (fix && fix.category) || 'Other';
        entriesChangedDates.push(ds);
      });
    });
  });

  if (bankChanged || entriesChangedDates.length) {
    if (bankChanged) { try { localStorage.setItem('calorie_foodBank', JSON.stringify(calFoodBank)); } catch (err) {} }
    if (entriesChangedDates.length) { try { localStorage.setItem('calorie_entries', JSON.stringify(calEntries)); } catch (err) {} }
    calRenderAll();
    // A deletion (the Heidelberren dedup) or a "de" rename needs skipMerge, same reasoning
    // as calDeleteFoodBankEntry/calSaveFoodBankEdit — otherwise the pre-push merge would
    // resurrect a stale remote copy under the old key alongside the fixed one.
    if (bankChanged) calPushToCloud({ skipMerge: bankEntryDeleted || bankDeKeyChanged });
    if (entriesChangedDates.length) calPushEntriesForDates(entriesChangedDates);
  }
}

function calApplyRemoteData(data) {
  calApplyingRemote = true;
  if (data.settings) {
    sharedSettings.p1 = data.settings.p1 || sharedSettings.p1;
    sharedSettings.p2 = data.settings.p2 || sharedSettings.p2;
    calGoals = data.settings.goals || calGoals;
  }
  calDailyGoals = data.dailyGoals || {};
  calFoodBank = data.foodBank || [];
  calWeightLog = data.weightLog || { p1: {}, p2: {} };
  calBurnLog = data.burnLog || { p1: {}, p2: {} };
  applySharedSettingsToInputs();
  calPopulateGoalsInputs();
  try { localStorage.setItem('calorie_settings', JSON.stringify({ p1: sharedSettings.p1, p2: sharedSettings.p2, goals: calGoals })); } catch (err) {}
  try { localStorage.setItem('calorie_dailyGoals', JSON.stringify(calDailyGoals)); } catch (err) {}
  try { localStorage.setItem('calorie_foodBank', JSON.stringify(calFoodBank)); } catch (err) {}
  try { localStorage.setItem('calorie_weightLog', JSON.stringify(calWeightLog)); } catch (err) {}
  try { localStorage.setItem('calorie_burnLog', JSON.stringify(calBurnLog)); } catch (err) {}
  calRefreshTopFoodsCache();
  calRenderPersonTabs();
  calRenderAll();
  calRenderWeightCard();
  calRenderBurnCard();
  calApplyingRemote = false;
  calApplyLegacyFixes();
  if (data.entries) calMigrateLegacyEntriesIfNeeded(data.entries);
}

function calSubscribeToCloud(code) {
  if (calUnsub) { calUnsub(); calUnsub = null; }
  if (!code) return;
  ensureAuth().then(() => {
    const ref = doc(db, 'calories', code);
    calUnsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        calApplyRemoteData(snap.data());
      } else {
        calPushToCloud({ replace: true });
      }
      markSynced();
    }, (err) => {
      console.error(err);
      setSyncStatus('Sync error (calories): ' + err.message);
    });
  });
}

// Separate subscription for the per-month entry documents (see calMonthKey above) — these
// live in their own collection, so a doc-id range query aggregates every month for this
// sync code into one combined calEntries tree, same shape the rest of the app expects.
function calSubscribeToEntriesCloud(code) {
  if (calEntriesUnsub) { calEntriesUnsub(); calEntriesUnsub = null; }
  if (!code) return;
  ensureAuth().then(() => {
    calEntriesUnsub = onSnapshot(calEntriesCollectionQuery(code), (snap) => {
      // A legacy-entries migration owns calEntries while it runs (see
      // calMigrateLegacyEntriesIfNeeded) — applying a snapshot here mid-migration would
      // very likely be an incomplete/stale one (the migration's own writes are still in
      // flight), so skip it and let the migration's own final assignment + render win.
      if (calMigratingLegacyEntries) return;
      calApplyingRemote = true;
      const combined = { p1: {}, p2: {} };
      snap.forEach(d => {
        const data = d.data().entries || {};
        ['p1', 'p2'].forEach(pk => Object.assign(combined[pk], data[pk] || {}));
      });
      calEntries = combined;
      try { localStorage.setItem('calorie_entries', JSON.stringify(calEntries)); } catch (err) {}
      calRefreshTopFoodsCache();
      calRenderAll();
      calApplyingRemote = false;
      calApplyLegacyFixes();
      markSynced();
    }, (err) => {
      console.error(err);
      setSyncStatus('Sync error (calorie entries): ' + err.message);
    });
  });
}

// Firestore replaces array fields wholesale on every write, so two clients saving around
// the same time can silently clobber each other's food bank additions. Merge the latest
// remote copy into the local one (by "de" name) right before every push, instead of
// blindly overwriting with whatever happens to be in memory.
function calMergeFoodBank(remoteBank) {
  const byName = new Map();
  (remoteBank || []).forEach(entry => byName.set(entry.de, entry));
  calFoodBank.forEach(entry => {
    const existing = byName.get(entry.de);
    byName.set(entry.de, existing ? { ...existing, ...entry } : entry);
  });
  calFoodBank = Array.from(byName.values());
}

// Same problem for a day's logged items: two devices logging around the same time can
// otherwise wipe out each other's additions for that day. Individual food items have no
// stable id, so identity is approximated by their full content — good enough to stop
// concurrent adds from being lost, at the cost of not being able to "merge" a concurrent
// edit to the exact same item (deletes/edits skip this merge entirely, see skipMerge).
function calItemKey(it) {
  return [it.name, it.unit, it.grams, it.calories, it.protein, it.carbs, it.fat, it.category].join('|');
}

// Pushes just one month's slice of entries to its own document, merging with whatever's
// already there first (same array-clobber protection as calMergeFoodBank, just scoped to
// one month instead of the whole history — see the comment by calMonthKey above).
//
// opts.sourceEntries lets a caller (the legacy migration below) supply an explicit,
// already-merged entries tree to push from instead of reading the live calEntries global.
// This matters because calEntries is also asynchronously overwritten by the real-time
// entries-collection listener (calSubscribeToEntriesCloud) — without this, a snapshot
// landing between this function's `await`s could clobber calEntries out from under an
// in-flight push and cause it to write empty/stale data. (This is exactly how the July
// 2026 migration incident lost data: the migration merged legacy entries into calEntries,
// then awaited a push — and the entries listener's first, still-empty snapshot overwrote
// calEntries before the push read it, so an empty slice got written and the legacy copy
// was then deleted. See CLAUDE.md / commit history for the postmortem.)
async function calPushEntriesForMonth(monthKey, opts = {}) {
  if (!coupleCode || calApplyingRemote) return;
  const ref = calEntryDocRef(coupleCode, monthKey);
  const usingExplicitSource = !!opts.sourceEntries;
  try {
    await ensureAuth();
    let slice = calEntriesSliceForMonth(monthKey, opts.sourceEntries);
    if (!opts.skipMerge) {
      try {
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const remoteSlice = snap.data().entries || {};
          slice = calMergeEntriesInto(slice, remoteSlice);
          if (!usingExplicitSource) {
            ['p1', 'p2'].forEach(pk => Object.assign(calEntries[pk] || (calEntries[pk] = {}), slice[pk]));
          }
        }
      } catch (err) { console.error('Could not merge remote entries before push:', err); }
    }
    await setDoc(ref, { entries: slice }, { merge: true });
    if (!usingExplicitSource) {
      try { localStorage.setItem('calorie_entries', JSON.stringify(calEntries)); } catch (err) {}
      calRenderLogCard();
      calRenderMonth();
      calRenderTrendChart();
      calRenderDeficitCard();
    }
  } catch (err) {
    console.error(err);
    setSyncStatus('Sync error (calories): could not save');
  }
}

async function calPushEntriesForDates(dates) {
  const months = new Set(dates.map(calMonthKey));
  await Promise.all([...months].map(m => calPushEntriesForMonth(m)));
}

async function calPushToCloud(opts = {}) {
  if (!coupleCode || calApplyingRemote) return;
  try {
    await ensureAuth();
    // calMergeFoodBank unions by name, so it can't tell "removed locally" apart from
    // "never existed" — a deleted bank entry would otherwise get resurrected from the
    // stale remote copy. Skip the merge right after a delete and trust the local list.
    if (!opts.skipMerge) {
      try {
        const snap = await getDoc(doc(db, 'calories', coupleCode));
        if (snap.exists()) calMergeFoodBank(snap.data().foodBank);
      } catch (err) { console.error('Could not merge remote data before push:', err); }
    }
    const writeOpts = opts.replace ? {} : { merge: true };
    const payload = {
      settings: { p1: sharedSettings.p1, p2: sharedSettings.p2, goals: calGoals },
      dailyGoals: calDailyGoals,
      foodBank: calFoodBank,
      weightLog: calWeightLog,
      burnLog: calBurnLog
    };
    // One-time cleanup: the old schema kept every food log entry ever logged inside this
    // same document, which is what drove it toward Firestore's 1 MiB limit in the first
    // place (see calMonthKey above) — once legacy entries have been migrated out to
    // calorieEntries/*, remove the now-redundant copy still sitting in this doc.
    if (opts.migrateClearEntries) payload.entries = deleteField();
    await setDoc(doc(db, 'calories', coupleCode), payload, writeOpts);
    try { localStorage.setItem('calorie_foodBank', JSON.stringify(calFoodBank)); } catch (err) {}
    try { localStorage.setItem('calorie_weightLog', JSON.stringify(calWeightLog)); } catch (err) {}
    try { localStorage.setItem('calorie_burnLog', JSON.stringify(calBurnLog)); } catch (err) {}
    calRenderLogCard();
    calRenderMonth();
    calRenderTrendChart();
    calRenderDeficitCard();
  } catch (err) {
    console.error(err);
    setSyncStatus('Sync error (calories): could not save');
  }
}

// One-time, self-healing migration off the old schema (see calMonthKey above): if the
// main calories/{code} doc still has a legacy top-level "entries" field, fold it into
// calEntries, push it out to the new per-month documents, then delete it from the old
// location. Runs automatically the next time the app loads with real data present — no
// manual/raw write needed. Safe to run repeatedly: once the legacy field is actually gone
// from the doc, calApplyRemoteData stops calling this at all.
async function calMigrateLegacyEntriesIfNeeded(legacyEntries) {
  if (calMigratingLegacyEntries || !coupleCode) return;
  const hasData = legacyEntries && ['p1', 'p2'].some(pk => Object.keys(legacyEntries[pk] || {}).length);
  if (!hasData) return;
  calMigratingLegacyEntries = true;
  try {
    const monthKeys = new Set();
    ['p1', 'p2'].forEach(pk => Object.keys(legacyEntries[pk] || {}).forEach(ds => monthKeys.add(calMonthKey(ds))));
    // Captured once into a local const — deliberately NOT written into the global
    // calEntries here. calSubscribeToEntriesCloud's listener also skips applying its
    // snapshots while calMigratingLegacyEntries is true, but pushing from an isolated
    // local copy (instead of the shared global) is the actual fix; the listener guard is
    // just defense in depth. See the comment on calPushEntriesForMonth for why this
    // matters.
    const migratedEntries = calMergeEntriesInto(calEntries, legacyEntries);
    for (const monthKey of monthKeys) {
      await calPushEntriesForMonth(monthKey, { sourceEntries: migratedEntries });
    }
    // Migration is done and Firestore now has the real data — safe to update the shared
    // global and re-render.
    calEntries = calMergeEntriesInto(calEntries, migratedEntries);
    try { localStorage.setItem('calorie_entries', JSON.stringify(calEntries)); } catch (err) {}
    calRefreshTopFoodsCache();
    calRenderAll();
    await calPushToCloud({ migrateClearEntries: true });
  } catch (err) {
    console.error('Legacy entries migration failed:', err);
  } finally {
    calMigratingLegacyEntries = false;
  }
}

function calPopulateGoalsInputs() {
  document.getElementById('p1CalGoal').value = calGoals.p1.calories;
  document.getElementById('p1ProtGoal').value = calGoals.p1.protein;
  document.getElementById('p2CalGoal').value = calGoals.p2.calories;
  document.getElementById('p2ProtGoal').value = calGoals.p2.protein;
  document.getElementById('p1DefaultBurn').value = calGoals.p1.defaultBurn || 0;
  // These labels used to read the same generic "Calorie goal (max, kcal)" text for both
  // people with nothing to tell the two rows apart beyond position in the layout — prefix
  // with the actual name so it's unambiguous which row is whose.
  document.getElementById('p1CalLabel').textContent = sharedSettings.p1 + ' — Calorie goal (max, kcal)';
  document.getElementById('p1ProtLabel').textContent = sharedSettings.p1 + ' — Protein goal (min, g)';
  document.getElementById('p2CalLabel').textContent = sharedSettings.p2 + ' — Calorie goal (max, kcal)';
  document.getElementById('p2ProtLabel').textContent = sharedSettings.p2 + ' — Protein goal (min, g)';
  document.getElementById('p1BurnLabel').textContent = sharedSettings.p1 + ' — Default daily burn (kcal), used for deficit days with food logged but no burn entry (0 = off)';
}

async function calSaveGoals() {
  // Freeze the goal that was in effect for every already-logged past day before
  // applying the new one, so this change doesn't retroactively affect them.
  const today = todayStr();
  const loggedDates = new Set();
  ['p1','p2'].forEach(pk => Object.keys(calEntries[pk] || {}).forEach(ds => loggedDates.add(ds)));
  loggedDates.forEach(ds => {
    if (ds < today && !calDailyGoals[ds]) {
      calDailyGoals[ds] = { p1: { ...calGoals.p1 }, p2: { ...calGoals.p2 } };
    }
  });

  calGoals = {
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
  try { localStorage.setItem('calorie_settings', JSON.stringify({ p1: sharedSettings.p1, p2: sharedSettings.p2, goals: calGoals })); } catch (err) {}
  try { localStorage.setItem('calorie_dailyGoals', JSON.stringify(calDailyGoals)); } catch (err) {}
  calRenderPersonTabs();
  calRenderAll();
  calPushToCloud();
}

function calRenderPersonTabs() {
  const tabs = document.getElementById('calPersonTabs');
  tabs.innerHTML = `
    <button data-p="p1" class="${calActivePerson==='p1'?'active':''}">${sharedSettings.p1}</button>
    <button data-p="p2" class="${calActivePerson==='p2'?'active':''}">${sharedSettings.p2}</button>
  `;
  tabs.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      calActivePerson = b.dataset.p;
      saveActivePerson('calActivePerson', calActivePerson);
      calRenderPersonTabs();
      calRenderLogCard();
      calRenderWeightCard();
      calRenderBurnCard();
      calRenderTrendChart();
      calRenderDeficitCard();
      renderGlanceBar();
    });
  });
}

function calSelectedDate() { return document.getElementById('calDatePicker').value || todayStr(); }

function calDayItems(person, dateStr) {
  return ((calEntries[person] || {})[dateStr] || {}).items || [];
}

// Consecutive days with at least one food item logged, ending today — or yesterday if
// today hasn't been logged yet, so the streak doesn't look broken mid-day before there's
// been a chance to log anything.
function calCurrentStreak(person) {
  let d = new Date();
  if (calDayItems(person, dstr(d)).length === 0) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (calDayItems(person, dstr(d)).length > 0) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function calRenderStreakBadge() {
  const el = document.getElementById('calStreakBadge');
  if (!el) return;
  const streak = calCurrentStreak(calActivePerson);
  el.innerHTML = streak > 0
    ? `<span class="tr-streak-badge" title="Consecutive days with at least one food item logged">&#128293; ${streak}-day logging streak</span>`
    : '';
}

function calDayTotals(person, dateStr) {
  const items = calDayItems(person, dateStr);
  const t = items.reduce((t, it) => ({
    calories: t.calories + (it.calories||0),
    protein: t.protein + (it.protein||0),
    carbs: t.carbs + (it.carbs||0),
    fat: t.fat + (it.fat||0)
  }), { calories:0, protein:0, carbs:0, fat:0 });
  return { calories: calRound2(t.calories), protein: calRound2(t.protein), carbs: calRound2(t.carbs), fat: calRound2(t.fat) };
}

let calActiveBankEntry = null;
let calCurrentMatches = [];
let calDropdownIndex = -1;
let calEditingIndex = -1;

function calClearManualFields() {
  document.getElementById('foodSearchInput').value = '';
  document.getElementById('foodCalories').value = '';
  document.getElementById('foodProtein').value = '';
  document.getElementById('foodCarbs').value = '';
  document.getElementById('foodFat').value = '';
  document.getElementById('foodCategory').value = 'Other';
  document.getElementById('foodLocked').checked = true;
  calActiveBankEntry = null;
  calEditingIndex = -1;
  document.getElementById('addItemBtn').textContent = 'Add to log';
  document.getElementById('cancelEditBtn').style.display = 'none';
  calApplyUnit('gram');
  document.getElementById('bankStatus').textContent = '';
  calCloseDropdown();
}

function calNormName(s) { return (s || '').trim().toLowerCase(); }

// A typed name may be "English", "Deutsch", or "English / Deutsch" (as inserted when picking a dropdown suggestion).
function calNameParts(name) { return (name || '').split('/').map(s => calNormName(s)).filter(Boolean); }

function calFindInBank(name) {
  const parts = calNameParts(name);
  if (parts.length === 0) return null;
  return calFoodBank.find(f => parts.includes(calNormName(f.en)) || parts.includes(calNormName(f.de))) || null;
}

function calSearchBank(query) {
  const n = calNormName(query);
  if (!n) return [];
  return calFoodBank.filter(f => calNormName(f.en).includes(n) || calNormName(f.de).includes(n)).slice(0, 8);
}

function calUpdateAmountLabel() {
  const unit = document.getElementById('foodUnit').value;
  document.getElementById('foodAmountLabel').textContent = unit === 'piece' ? 'Quantity (pieces/servings)' : 'Grams';
}

// Sets the unit select + resets the amount field to a sensible default for that unit (1 piece / 100g).
function calApplyUnit(unit) {
  document.getElementById('foodUnit').value = unit;
  const amount = unit === 'piece' ? 1 : 100;
  document.getElementById('foodGrams').value = amount;
  calUpdateAmountLabel();
  return amount;
}

function calCloseDropdown() {
  const dd = document.getElementById('foodNameDropdown');
  dd.classList.remove('open');
  dd.innerHTML = '';
  calCurrentMatches = [];
  calDropdownIndex = -1;
}

function calUpdateDropdownHighlight() {
  const dd = document.getElementById('foodNameDropdown');
  dd.querySelectorAll('.autocomplete-item').forEach((el, i) => {
    el.classList.toggle('active', i === calDropdownIndex);
    if (i === calDropdownIndex) el.scrollIntoView({ block: 'nearest' });
  });
}

// entry.gram / entry.piece hold {calories,protein,carbs,fat} reference values
// for 100g or 1 piece respectively. Either may be missing.
function calFillFromBankEntry(entry, unit, amount) {
  const ref = entry[unit];
  const statusEl = document.getElementById('bankStatus');
  document.getElementById('foodLocked').checked = entry.locked !== false;
  if (!ref) {
    statusEl.textContent = '"' + entry.en + ' / ' + entry.de + '" has no ' + (unit === 'piece' ? 'per-piece' : 'per-gram') + ' data yet — enter values manually and it’ll be saved for next time.';
    return;
  }
  const factor = unit === 'piece' ? (amount || 0) : (amount || 0) / 100;
  document.getElementById('foodCalories').value = Math.round(ref.calories * factor);
  document.getElementById('foodProtein').value = calRound2(ref.protein * factor);
  document.getElementById('foodCarbs').value = calRound2(ref.carbs * factor);
  document.getElementById('foodFat').value = calRound2(ref.fat * factor);
  document.getElementById('foodCategory').value = entry.category || 'Other';
  statusEl.textContent = '✓ Using "' + entry.en + ' / ' + entry.de + '" — auto-filled for ' + amount + (unit === 'piece' ? ' piece(s).' : 'g.');
}

function calSelectBankEntry(entry) {
  document.getElementById('foodSearchInput').value = entry.en + ' / ' + entry.de;
  calActiveBankEntry = entry;
  const amount = calApplyUnit(entry.preferredUnit);
  calFillFromBankEntry(entry, entry.preferredUnit, amount);
  calCloseDropdown();
}

function calRenderDropdown(matches) {
  calCurrentMatches = matches;
  calDropdownIndex = -1;
  const dd = document.getElementById('foodNameDropdown');
  if (matches.length === 0) { calCloseDropdown(); return; }
  dd.innerHTML = matches.map((f, i) => `<div class="autocomplete-item" data-i="${i}">${f.en} <span class="ai-sub">/ ${f.de}</span></div>`).join('');
  dd.classList.add('open');
  dd.querySelectorAll('.autocomplete-item').forEach(el => {
    el.addEventListener('mousedown', (e) => { e.preventDefault(); calSelectBankEntry(calCurrentMatches[parseInt(el.dataset.i)]); });
  });
}

function calOnFoodSearchKeydown(e) {
  const dd = document.getElementById('foodNameDropdown');
  const isOpen = dd.classList.contains('open');
  if (e.key === 'ArrowDown') {
    if (!isOpen || calCurrentMatches.length === 0) return;
    e.preventDefault();
    calDropdownIndex = Math.min(calDropdownIndex + 1, calCurrentMatches.length - 1);
    calUpdateDropdownHighlight();
  } else if (e.key === 'ArrowUp') {
    if (!isOpen || calCurrentMatches.length === 0) return;
    e.preventDefault();
    calDropdownIndex = Math.max(calDropdownIndex - 1, 0);
    calUpdateDropdownHighlight();
  } else if (e.key === 'Enter') {
    if (isOpen && calDropdownIndex >= 0 && calCurrentMatches[calDropdownIndex]) {
      e.preventDefault();
      calSelectBankEntry(calCurrentMatches[calDropdownIndex]);
    }
  } else if (e.key === 'Escape') {
    calCloseDropdown();
  }
}

function calOnFoodNameInput() {
  const name = document.getElementById('foodSearchInput').value;
  calActiveBankEntry = null;
  const exact = calFindInBank(name);
  const statusEl = document.getElementById('bankStatus');
  if (exact) {
    calActiveBankEntry = exact;
    const amount = calApplyUnit(exact.preferredUnit);
    calFillFromBankEntry(exact, exact.preferredUnit, amount);
    calCloseDropdown();
  } else {
    statusEl.textContent = name.trim() ? 'Not in your food bank yet — enter values manually or search Google, and it’ll be saved for next time.' : '';
    calRenderDropdown(calSearchBank(name));
  }
}

// User is typing a custom amount — recompute macros but leave their typed number alone.
function calOnGramsFieldInput() {
  if (calActiveBankEntry) {
    const unit = document.getElementById('foodUnit').value;
    const amount = parseFloat(document.getElementById('foodGrams').value) || 0;
    calFillFromBankEntry(calActiveBankEntry, unit, amount);
  }
}

// User manually flipped the unit dropdown — reset the amount to a sensible default for that unit.
function calOnUnitChange() {
  const unit = document.getElementById('foodUnit').value;
  const amount = calApplyUnit(unit);
  if (calActiveBankEntry) calFillFromBankEntry(calActiveBankEntry, unit, amount);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#foodSearchInput') && !e.target.closest('#foodNameDropdown')) calCloseDropdown();
});

function calSearchOnGoogle() {
  const name = document.getElementById('foodSearchInput').value.trim().split('/')[0].trim();
  if (!name) { alert('Enter a food name first.'); return; }
  const amount = document.getElementById('foodGrams').value || '100';
  const unit = document.getElementById('foodUnit').value;
  const q = unit === 'piece' ? `${name} calories and macros per piece` : `${name} calories and macros per ${amount}g`;
  window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank');
}

function calSaveOrUpdateBank(name, unit, amount, calories, protein, carbs, fat, category) {
  if (!amount || amount <= 0) return;
  const factor = unit === 'piece' ? (1 / amount) : (100 / amount);
  const refData = {
    calories: Math.round(calories * factor),
    protein: calRound2(protein * factor),
    carbs: calRound2(carbs * factor),
    fat: calRound2(fat * factor)
  };
  let entry = calFindInBank(name);
  if (entry) {
    entry[unit] = refData;
    entry.preferredUnit = unit;
    entry.category = category;
  } else {
    const parts = name.split('/').map(s => s.trim()).filter(Boolean);
    const en = parts[0] || name;
    const de = parts[1] || parts[0] || name;
    entry = { en, de, preferredUnit: unit, gram: null, piece: null, category, locked: true };
    entry[unit] = refData;
    calFoodBank.push(entry);
  }
  try { localStorage.setItem('calorie_foodBank', JSON.stringify(calFoodBank)); } catch (err) {}
}

async function calAddItem() {
  const name = document.getElementById('foodSearchInput').value.trim();
  if (!name) {
    document.getElementById('foodSearchInput').classList.add('input-error');
    document.getElementById('foodNameError').style.display = '';
    document.getElementById('foodSearchInput').focus();
    return;
  }
  document.getElementById('foodSearchInput').classList.remove('input-error');
  document.getElementById('foodNameError').style.display = 'none';
  const nameEn = name.split('/')[0].trim();
  const unit = document.getElementById('foodUnit').value;
  const amount = parseFloat(document.getElementById('foodGrams').value) || 0;
  const calories = Math.round(parseFloat(document.getElementById('foodCalories').value) || 0);
  const protein = calRound2(parseFloat(document.getElementById('foodProtein').value) || 0);
  const carbs = calRound2(parseFloat(document.getElementById('foodCarbs').value) || 0);
  const fat = calRound2(parseFloat(document.getElementById('foodFat').value) || 0);
  const category = document.getElementById('foodCategory').value || 'Other';
  const locked = document.getElementById('foodLocked').checked;
  const ds = calSelectedDate();
  if (!calEntries[calActivePerson]) calEntries[calActivePerson] = {};
  if (!calEntries[calActivePerson][ds]) calEntries[calActivePerson][ds] = { items: [] };
  const newItem = { name: nameEn, unit, grams: amount, calories, protein, carbs, fat, category };
  const items = calEntries[calActivePerson][ds].items;
  const wasEditing = calEditingIndex >= 0 && !!items[calEditingIndex];
  if (wasEditing) {
    items[calEditingIndex] = newItem;
  } else {
    items.push(newItem);
  }
  // Locked (the default) means this is a one-off tweak — the bank's saved reference
  // values are left alone. A brand-new food (no bank entry yet) is always saved so
  // first-time logging still seeds the bank for next time, regardless of the checkbox.
  if (!calFindInBank(name) || !locked) {
    calSaveOrUpdateBank(name, unit, amount, calories, protein, carbs, fat, category);
  }
  try { localStorage.setItem('calorie_entries', JSON.stringify(calEntries)); } catch (err) {}
  calClearManualFields();
  calRenderLogCard();
  calRenderMonth();
  calRenderTrendChart();
  calRenderDeficitCard();
  // Editing replaces a specific item in place, so trust the local result rather than
  // merging (a stale remote copy could otherwise resurrect the pre-edit version).
  calPushToCloud();
  calPushEntriesForMonth(calMonthKey(ds), { skipMerge: wasEditing });
}

function calDeleteItem(index) {
  const ds = calSelectedDate();
  const items = calDayItems(calActivePerson, ds);
  const item = items[index];
  if (!item) return;
  if (!confirm(`Delete "${item.name}" from this day's log?`)) return;
  items.splice(index, 1);
  if (calEditingIndex === index) calClearManualFields();
  try { localStorage.setItem('calorie_entries', JSON.stringify(calEntries)); } catch (err) {}
  calRenderLogCard();
  calRenderMonth();
  calRenderTrendChart();
  calRenderDeficitCard();
  calPushEntriesForMonth(calMonthKey(ds), { skipMerge: true });
}

function calPopulateFormFromItem(item) {
  const bankEntry = calFindInBank(item.name);
  calActiveBankEntry = bankEntry;
  document.getElementById('foodSearchInput').value = bankEntry ? (bankEntry.en + ' / ' + bankEntry.de) : item.name;
  document.getElementById('foodUnit').value = item.unit;
  calUpdateAmountLabel();
  document.getElementById('foodGrams').value = item.grams;
  document.getElementById('foodCalories').value = Math.round(item.calories);
  document.getElementById('foodProtein').value = calRound2(item.protein);
  document.getElementById('foodCarbs').value = calRound2(item.carbs);
  document.getElementById('foodFat').value = calRound2(item.fat);
  document.getElementById('foodCategory').value = item.category || (bankEntry && bankEntry.category) || 'Other';
  document.getElementById('foodLocked').checked = !bankEntry || bankEntry.locked !== false;
  calCloseDropdown();
}

// Most-logged distinct foods for this person, ranked by how many times they've been
// logged (not recency). Computed once per page load / remote sync — see calTopFoodsCache
// — so the quick-add chips stay stable through a session instead of reshuffling after
// every add.
function calComputeTopFoods(person, limit) {
  const counts = new Map();
  Object.values(calEntries[person] || {}).forEach(day => {
    (day.items || []).forEach(it => {
      const entry = counts.get(it.name) || { count: 0, item: it };
      entry.count++;
      entry.item = it;
      counts.set(it.name, entry);
    });
  });
  return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, limit);
}

let calTopFoodsCache = { p1: [], p2: [] };

function calRefreshTopFoodsCache() {
  calTopFoodsCache = { p1: calComputeTopFoods('p1', 10), p2: calComputeTopFoods('p2', 10) };
}

function calRenderRecentChips() {
  const el = document.getElementById('calRecentChips');
  if (!el) return;
  const ranked = calTopFoodsCache[calActivePerson] || [];
  if (ranked.length === 0) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = '<div style="width:100%; font-size:11px; color:var(--text-muted); margin-bottom:2px;">Most logged</div>' +
    ranked.map((r, i) => `<button type="button" class="recent-chip" data-i="${i}">${r.item.name} <span style="color:var(--text-muted)">&times;${r.count}</span></button>`).join('');
  el.querySelectorAll('.recent-chip').forEach(btn => {
    const item = ranked[parseInt(btn.dataset.i)].item;
    btn.addEventListener('click', () => {
      calEditingIndex = -1;
      calPopulateFormFromItem(item);
      document.getElementById('addItemBtn').textContent = 'Add to log';
      document.getElementById('cancelEditBtn').style.display = 'none';
      document.getElementById('bankStatus').textContent = 'Loaded — adjust if needed, then Add.';
    });
  });
}

function calEditItem(index) {
  const ds = calSelectedDate();
  const item = calDayItems(calActivePerson, ds)[index];
  if (!item) return;
  calPopulateFormFromItem(item);
  calEditingIndex = index;
  document.getElementById('addItemBtn').textContent = 'Update log entry';
  document.getElementById('cancelEditBtn').style.display = 'block';
  document.getElementById('bankStatus').textContent = 'Editing this entry — adjust values, then Update (or Cancel).';
}

// Reuses the same good/inprogress/bad convention as the month calendar: a metric that's
// not yet met still counts as "in progress" rather than "missed" while the day is today.
function calRingStatus(ds, isMet) {
  if (isMet) return 'good';
  return ds === todayStr() ? 'inprogress' : 'bad';
}

const CAL_RING_COLORS = { good: '--green-text', inprogress: '--amber-text', bad: '--red-text' };

function calProgressRing(title, centerValue, centerLabel, fraction, status) {
  const r = 48;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, fraction));
  const offset = c * (1 - clamped);
  return `
    <div class="cal-ring-wrap">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--border)" stroke-width="11"></circle>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(${CAL_RING_COLORS[status]})" stroke-width="11"
          stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
          transform="rotate(-90 60 60)"></circle>
        <text x="60" y="57" text-anchor="middle" class="cal-ring-value">${centerValue}</text>
        <text x="60" y="75" text-anchor="middle" class="cal-ring-label">${centerLabel}</text>
      </svg>
      <div class="cal-ring-title">${title}</div>
    </div>
  `;
}

function calFoodItemRowHtml(it, i) {
  return `<div class="food-item">
        <span class="fi-name">${it.name}${it.grams ? ' <span style="color:var(--text-muted)">(' + it.grams + (it.unit === 'piece' ? ' pc)' : 'g)') + '</span>' : ''}</span>
        <span class="fi-macros">${Math.round(it.calories)} · ${Math.round(it.protein)}P · ${Math.round(it.carbs)}C · ${Math.round(it.fat)}F</span>
        <button class="fi-edit" data-i="${i}">&#9998;</button>
        <button class="fi-del" data-i="${i}">&times;</button>
      </div>`;
}

function calRenderLogCard() {
  const ds = calSelectedDate();
  const items = calDayItems(calActivePerson, ds);
  calRenderStreakBadge();
  calRenderRecentChips();
  const listEl = document.getElementById('foodItemsList');
  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty" style="color:var(--text-muted); font-size:13px; padding:8px 0;">No food logged for this day yet.</div>';
  } else {
    const groups = {};
    items.forEach((it, i) => {
      const cat = it.category || 'Other';
      (groups[cat] || (groups[cat] = [])).push({ it, i });
    });
    const orderedCats = CAL_CATEGORIES.filter(c => groups[c]);
    Object.keys(groups).forEach(c => { if (!orderedCats.includes(c)) orderedCats.push(c); });

    listEl.innerHTML = orderedCats.map(cat => `
      <div class="food-cat-title">${cat}</div>
      ${groups[cat].map(({ it, i }) => calFoodItemRowHtml(it, i)).join('')}
    `).join('');
  }
  listEl.querySelectorAll('.fi-edit').forEach(btn => {
    btn.addEventListener('click', () => calEditItem(parseInt(btn.dataset.i)));
  });
  listEl.querySelectorAll('.fi-del').forEach(btn => {
    btn.addEventListener('click', () => calDeleteItem(parseInt(btn.dataset.i)));
  });

  const totals = calDayTotals(calActivePerson, ds);
  const goal = calGoalsForDay(ds)[calActivePerson];
  const calMet = totals.calories <= goal.calories;
  const protMet = totals.protein >= goal.protein;
  const calStatus = calRingStatus(ds, calMet);
  const protStatus = calRingStatus(ds, protMet);
  const calLeft = Math.round(goal.calories - totals.calories);
  const protLeft = Math.round(goal.protein - totals.protein);

  const protLabel = protLeft > 0 ? 'g left' : protLeft === 0 ? 'goal met' : 'g extra';

  // Simple 40/30 macro split derived from the calorie goal: max 40% of calories from
  // carbs (4 kcal/g), max 30% from fat (9 kcal/g). Compared unrounded against the exact
  // summed totals; only the displayed "left/over" number is rounded.
  const carbGoal = (0.4 * goal.calories) / 4;
  const fatGoal = (0.3 * goal.calories) / 9;
  const carbLeft = carbGoal - totals.carbs;
  const fatLeft = fatGoal - totals.fat;
  const carbStatus = carbLeft >= 0 ? 'good' : 'bad';
  const fatStatus = fatLeft >= 0 ? 'good' : 'bad';

  document.getElementById('calRings').innerHTML =
    calProgressRing('Calories', Math.abs(calLeft), calLeft >= 0 ? 'kcal left' : 'kcal over', goal.calories > 0 ? totals.calories / goal.calories : 0, calStatus) +
    calProgressRing('Protein', Math.abs(protLeft), protLabel, goal.protein > 0 ? totals.protein / goal.protein : 0, protStatus) +
    calProgressRing('Carbs', Math.round(Math.abs(carbLeft)), carbLeft >= 0 ? 'g left' : 'g over', carbGoal > 0 ? totals.carbs / carbGoal : 0, carbStatus) +
    calProgressRing('Fat', Math.round(Math.abs(fatLeft)), fatLeft >= 0 ? 'g left' : 'g over', fatGoal > 0 ? totals.fat / fatGoal : 0, fatStatus);
}

// Which bank entry (keyed by its "de" name, same key calMergeFoodBank uses) is currently
// showing its inline edit form, if any. Only one at a time.
let calBankEditingKey = null;

function calFoodBankRowHtml(entry) {
  const unit = entry.preferredUnit || 'gram';
  const ref = entry[unit];
  const key = entry.de;
  const unitLabel = unit === 'piece' ? 'piece' : '100g';
  if (calBankEditingKey === key) {
    const attrSafe = s => (s || '').replace(/"/g, '&quot;');
    return `
    <div class="food-item" style="display:block;">
      <div class="manual-grid" style="grid-template-columns: 1fr 1fr; margin-bottom:6px;">
        <div><label style="font-size:11px; color:var(--text-secondary); display:block; margin-bottom:3px;">English name</label><input type="text" class="fb-edit-en" value="${attrSafe(entry.en)}"></div>
        <div><label style="font-size:11px; color:var(--text-secondary); display:block; margin-bottom:3px;">German name</label><input type="text" class="fb-edit-de" value="${attrSafe(entry.de)}"></div>
      </div>
      <select class="fb-edit-category" style="width:100%; padding:7px 8px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:13px; margin-bottom:6px;">
        ${CAL_CATEGORIES.map(c => `<option value="${c}" ${entry.category === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <div class="manual-grid macros">
        <div><label>Calories</label><input type="number" class="fb-edit-calories" min="0" value="${ref ? ref.calories : ''}"></div>
        <div><label>Protein (g)</label><input type="number" class="fb-edit-protein" min="0" value="${ref ? ref.protein : ''}"></div>
        <div><label>Carbs (g)</label><input type="number" class="fb-edit-carbs" min="0" value="${ref ? ref.carbs : ''}"></div>
        <div><label>Fat (g)</label><input type="number" class="fb-edit-fat" min="0" value="${ref ? ref.fat : ''}"></div>
      </div>
      <p class="card-sub" style="margin:4px 0 8px;">Per ${unitLabel}</p>
      <label class="core-check-inline" style="margin-bottom:8px;">
        <input type="checkbox" class="fb-edit-locked" ${entry.locked !== false ? 'checked' : ''}>
        <span>Locked (protects it from one-off log edits)</span>
      </label>
      <div style="display:flex; gap:8px;">
        <button class="primary fb-save" data-key="${key}" style="flex:1;">Save</button>
        <button type="button" class="link-btn fb-cancel">Cancel</button>
      </div>
    </div>`;
  }
  return `<div class="food-item">
    <span class="fi-name">${entry.en} / ${entry.de}${entry.locked !== false ? ' &#128274;' : ''}</span>
    <span class="fi-macros">${ref ? `${ref.calories} · ${ref.protein}P · ${ref.carbs}C · ${ref.fat}F` : 'no data'} <span style="color:var(--text-muted)">/ ${unitLabel}</span></span>
    <button class="fi-edit fb-edit" data-key="${key}" title="Edit">&#9998;</button>
    <button class="fi-del fb-del" data-key="${key}" title="Delete">&times;</button>
  </div>`;
}

function calRenderFoodBankList() {
  const el = document.getElementById('foodBankList');
  if (!el) return;
  if (calFoodBank.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:8px 0;">No foods saved yet — foods you log get saved here automatically.</div>';
    return;
  }
  const groups = {};
  calFoodBank.forEach(entry => {
    const cat = entry.category || 'Other';
    (groups[cat] || (groups[cat] = [])).push(entry);
  });
  const orderedCats = CAL_CATEGORIES.filter(c => groups[c]);
  Object.keys(groups).forEach(c => { if (!orderedCats.includes(c)) orderedCats.push(c); });
  orderedCats.forEach(c => groups[c].sort((a, b) => a.en.localeCompare(b.en)));

  el.innerHTML = orderedCats.map(cat => `
    <div class="food-cat-title">${cat}</div>
    ${groups[cat].map(calFoodBankRowHtml).join('')}
  `).join('');

  el.querySelectorAll('.fb-edit').forEach(btn => {
    btn.addEventListener('click', () => { calBankEditingKey = btn.dataset.key; calRenderFoodBankList(); });
  });
  el.querySelectorAll('.fb-cancel').forEach(btn => {
    btn.addEventListener('click', () => { calBankEditingKey = null; calRenderFoodBankList(); });
  });
  el.querySelectorAll('.fb-save').forEach(btn => {
    btn.addEventListener('click', () => calSaveFoodBankEdit(btn.dataset.key, btn.closest('.food-item')));
  });
  el.querySelectorAll('.fb-del').forEach(btn => {
    btn.addEventListener('click', () => calDeleteFoodBankEntry(btn.dataset.key));
  });
}

function calSaveFoodBankEdit(key, row) {
  const entry = calFoodBank.find(f => f.de === key);
  if (!entry || !row) return;
  const newEn = row.querySelector('.fb-edit-en').value.trim();
  const newDe = row.querySelector('.fb-edit-de').value.trim();
  if (!newEn || !newDe) { alert('Enter both an English and a German name.'); return; }
  const dupe = calFoodBank.find(f => f !== entry && (calNormName(f.en) === calNormName(newEn) || calNormName(f.de) === calNormName(newDe)));
  if (dupe) { alert(`"${dupe.en} / ${dupe.de}" already uses one of those names.`); return; }
  // Log entries store only the English name at the time they were logged (see calAddItem),
  // so renaming here doesn't relabel history — past days keep showing the old name. That's
  // a display-only side effect, not data loss, and matches how exercise renames are handled
  // in the training tab (see TR_EXERCISE_RENAMES).
  const deChanged = newDe !== entry.de;
  entry.en = newEn;
  entry.de = newDe;
  const unit = entry.preferredUnit || 'gram';
  entry.category = row.querySelector('.fb-edit-category').value;
  entry[unit] = {
    calories: Math.round(parseFloat(row.querySelector('.fb-edit-calories').value) || 0),
    protein: calRound2(parseFloat(row.querySelector('.fb-edit-protein').value) || 0),
    carbs: calRound2(parseFloat(row.querySelector('.fb-edit-carbs').value) || 0),
    fat: calRound2(parseFloat(row.querySelector('.fb-edit-fat').value) || 0)
  };
  entry.locked = row.querySelector('.fb-edit-locked').checked;
  calBankEditingKey = null;
  try { localStorage.setItem('calorie_foodBank', JSON.stringify(calFoodBank)); } catch (err) {}
  calRenderFoodBankList();
  // calMergeFoodBank unions by "de" name — if that just changed, a normal merge would
  // leave the stale remote copy sitting under the old key as a duplicate (same class of
  // bug as deleting an entry). Skip the merge so the rename fully replaces it.
  calPushToCloud({ skipMerge: deChanged });
}

function calDeleteFoodBankEntry(key) {
  const entry = calFoodBank.find(f => f.de === key);
  if (!entry) return;
  if (!confirm(`Delete "${entry.en} / ${entry.de}" from the food bank? Days you've already logged it on keep their own values — this only removes it as a saved shortcut for next time.`)) return;
  calFoodBank = calFoodBank.filter(f => f.de !== key);
  calBankEditingKey = null;
  try { localStorage.setItem('calorie_foodBank', JSON.stringify(calFoodBank)); } catch (err) {}
  calRenderFoodBankList();
  calPushToCloud({ skipMerge: true });
}

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

function calRenderMonth() {
  const year = calViewedMonth.getFullYear();
  const month = calViewedMonth.getMonth();
  document.getElementById('monthLabel').textContent = calViewedMonth.toLocaleDateString(undefined, { month:'long', year:'numeric' });

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
      const selected = calSelectedMonthDate === ds && calActivePerson === pk ? ' selected' : '';
      return `<div class="month-day ${status}${selected}" data-date="${ds}" data-person="${pk}" title="${title}"></div>`;
    }).join('');
    const hasEverLogged = Object.values(calEntries[pk] || {}).some(day => (day.items || []).length > 0);
    const emptyHint = hasEverLogged ? '' : `<div class="empty-state" style="padding:8px 0 0; text-align:left; font-size:12px;">No food logged yet — use "Log food" above to start.</div>`;
    return `<div class="month-col">
      <div class="pname" style="color:var(--${pk})">${name}</div>
      <div class="month-grid">${squares}</div>
      ${emptyHint}
    </div>`;
  }).join('');
  wrap.querySelectorAll('.month-day[data-date]').forEach(el => {
    el.addEventListener('click', () => {
      calActivePerson = el.dataset.person;
      calSelectedMonthDate = el.dataset.date;
      document.getElementById('calDatePicker').value = el.dataset.date;
      calRenderPersonTabs();
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
// since it's still in progress and would read as a misleading dip/spike on the chart.
function calTrendPoints(person, metric, days) {
  const points = [];
  const today = new Date();
  for (let i = days; i >= 1; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = dstr(d);
    let value;
    if (metric === 'weight') {
      value = (calWeightLog[person] || {})[ds];
    } else if (calDayItems(person, ds).length > 0) {
      value = calDayTotals(person, ds)[metric];
    }
    if (value !== undefined) points.push({ date: ds, value });
  }
  return points;
}

function calRenderTrendChart() {
  const el = document.getElementById('calTrendChart');
  if (!el) return;
  const metric = calTrendMetric;
  const points = calTrendPoints(calActivePerson, metric, 30);
  const personGoals = calGoals[calActivePerson] || {};
  const goal = metric === 'calories' ? personGoals.calories : metric === 'protein' ? personGoals.protein : null;
  const unit = metric === 'calories' ? '' : metric === 'protein' ? 'g' : 'kg';
  el.innerHTML = buildTrendChart(points, { color: '--' + calActivePerson, goal, unit, detailId: 'calTrendDetail' });
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

function calRenderRecap() {
  const el = document.getElementById('calRecapStats');
  if (!el) return;
  const stats = calRecapStats(calActivePerson, 7);
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

function calRenderAll() {
  calRenderLogCard();
  calRenderFoodBankList();
  calRenderMonth();
  calRenderTrendChart();
  calRenderDeficitCard();
  renderTodayCard();
}

function calLoadData() {
  try { calEntries = JSON.parse(localStorage.getItem('calorie_entries') || '{}'); } catch (err) { calEntries = {}; }
  try {
    const s = localStorage.getItem('calorie_settings');
    if (s) { const parsed = JSON.parse(s); calGoals = parsed.goals || calGoals; }
  } catch (err) {}
  try { calDailyGoals = JSON.parse(localStorage.getItem('calorie_dailyGoals') || '{}'); } catch (err) { calDailyGoals = {}; }
  try { calFoodBank = JSON.parse(localStorage.getItem('calorie_foodBank') || '[]'); } catch (err) { calFoodBank = []; }
  try {
    calWeightLog = JSON.parse(localStorage.getItem('calorie_weightLog') || '{}');
    calWeightLog.p1 = calWeightLog.p1 || {};
    calWeightLog.p2 = calWeightLog.p2 || {};
  } catch (err) { calWeightLog = { p1: {}, p2: {} }; }
  try {
    calBurnLog = JSON.parse(localStorage.getItem('calorie_burnLog') || '{}');
    calBurnLog.p1 = calBurnLog.p1 || {};
    calBurnLog.p2 = calBurnLog.p2 || {};
  } catch (err) { calBurnLog = { p1: {}, p2: {} }; }

  calPopulateCategorySelect();
  calPopulateGoalsInputs();
  document.getElementById('calDatePicker').value = todayStr();
  document.getElementById('calDatePicker').max = todayStr();
  document.getElementById('weightDate').value = todayStr();
  document.getElementById('burnDate').value = todayStr();

  const now = new Date();
  calViewedMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  calRefreshTopFoodsCache();
  calRenderPersonTabs();
  calRenderAll();
  calRenderWeightCard();
  calRenderBurnCard();
  calApplyLegacyFixes();
}

document.getElementById('weightDate').addEventListener('change', calRenderWeightCard);
document.getElementById('weightSaveBtn').addEventListener('click', calSaveWeight);
document.getElementById('burnDate').addEventListener('change', calRenderBurnCard);
document.getElementById('burnSaveBtn').addEventListener('click', calSaveBurn);

document.getElementById('foodSearchInput').addEventListener('input', calOnFoodNameInput);
document.getElementById('foodSearchInput').addEventListener('input', () => {
  document.getElementById('foodSearchInput').classList.remove('input-error');
  document.getElementById('foodNameError').style.display = 'none';
});
document.getElementById('foodSearchInput').addEventListener('keydown', calOnFoodSearchKeydown);
document.getElementById('foodGrams').addEventListener('input', calOnGramsFieldInput);
document.getElementById('foodUnit').addEventListener('change', calOnUnitChange);
document.getElementById('googleSearchBtn').addEventListener('click', calSearchOnGoogle);
document.getElementById('addItemBtn').addEventListener('click', calAddItem);
document.getElementById('cancelEditBtn').addEventListener('click', calClearManualFields);
document.getElementById('calDatePicker').addEventListener('change', calRenderLogCard);

['p1CalGoal','p1ProtGoal','p2CalGoal','p2ProtGoal','p1DefaultBurn'].forEach(id => {
  document.getElementById(id).addEventListener('change', calSaveGoals);
});

document.getElementById('prevMonthBtn').addEventListener('click', () => {
  calViewedMonth = new Date(calViewedMonth.getFullYear(), calViewedMonth.getMonth() - 1, 1);
  calRenderMonth();
});
document.getElementById('nextMonthBtn').addEventListener('click', () => {
  const now = new Date();
  const nowMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (calViewedMonth.getTime() >= nowMonthStart.getTime()) return;
  calViewedMonth = new Date(calViewedMonth.getFullYear(), calViewedMonth.getMonth() + 1, 1);
  calRenderMonth();
});

document.querySelectorAll('#calTrendTabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    calTrendMetric = btn.dataset.metric;
    document.querySelectorAll('#calTrendTabs button').forEach(b => b.classList.toggle('active', b === btn));
    calRenderTrendChart();
  });
});

function setFoodBankCollapsed(collapsed) {
  document.getElementById('foodBankBody').classList.toggle('collapsed', collapsed);
  document.getElementById('foodBankArrow').innerHTML = collapsed ? '&#9656;' : '&#9662;';
  try { localStorage.setItem('foodBankCollapsed', collapsed ? '1' : '0'); } catch (err) {}
}
document.getElementById('foodBankToggle').addEventListener('click', () => {
  setFoodBankCollapsed(!document.getElementById('foodBankBody').classList.contains('collapsed'));
});

function setCalGoalsCollapsed(collapsed) {
  document.getElementById('calGoalsBody').classList.toggle('collapsed', collapsed);
  document.getElementById('calGoalsArrow').innerHTML = collapsed ? '&#9656;' : '&#9662;';
  try { localStorage.setItem('calGoalsCollapsed', collapsed ? '1' : '0'); } catch (err) {}
}
document.getElementById('calGoalsToggle').addEventListener('click', () => {
  setCalGoalsCollapsed(!document.getElementById('calGoalsBody').classList.contains('collapsed'));
});

document.getElementById('calResetBtn').addEventListener('click', async () => {
  if (!confirmWipe('logged food')) return;
  calEntries = {};
  try { localStorage.removeItem('calorie_entries'); } catch (err) {}
  calRenderAll();
  if (!coupleCode) return;
  try {
    await ensureAuth();
    const snap = await getDocs(calEntriesCollectionQuery(coupleCode));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  } catch (err) {
    console.error(err);
    setSyncStatus('Sync error (calories): could not clear');
  }
});

register('calories', {
  loadData: calLoadData,
  subscribe: (code) => { calSubscribeToCloud(code); calSubscribeToEntriesCloud(code); },
  renderAll: calRenderAll,
  isDoneToday: (pk) => calDayItems(pk, todayStr()).length > 0,
  glanceHtml: () => {
    const pk = calActivePerson;
    const ds = todayStr();
    const goal = calGoalsForDay(ds)[pk];
    const totals = calDayTotals(pk, ds);
    const kcalLeft = (goal.calories || 0) - totals.calories;
    const protLeft = (goal.protein || 0) - totals.protein;
    let html = (kcalLeft >= 0
        ? `<b>${kcalLeft.toLocaleString()}</b> kcal left`
        : `<b>${(-kcalLeft).toLocaleString()}</b> kcal over`)
      + (protLeft > 0 ? ` &middot; <b>${calRound2(protLeft)}g</b> protein to go` : ' &middot; protein &#10003;');
    if (pk === 'p1') html += ` &middot; deficit <b>${Math.round(calCumulativeDeficit('p1')).toLocaleString()}</b>`;
    return html;
  },
  jumpToToday: (pk) => {
    calActivePerson = pk;
    saveActivePerson('calActivePerson', pk);
    document.getElementById('calDatePicker').value = todayStr();
    calSelectedMonthDate = todayStr();
    calRenderPersonTabs();
    calRenderAll();
    calRenderWeightCard();
    calRenderBurnCard();
  },
  setPerson: (pk) => {
    calActivePerson = pk;
    saveActivePerson('calActivePerson', pk);
    calRenderPersonTabs();
    calRenderAll();
    calRenderWeightCard();
    calRenderBurnCard();
  },
  onSettingsChanged: () => { calRenderPersonTabs(); calPopulateGoalsInputs(); calRenderAll(); calPushToCloud(); },
  exportData: () => ({
    goals: calGoals, dailyGoals: calDailyGoals, entries: calEntries,
    foodBank: calFoodBank, weightLog: calWeightLog, burnLog: calBurnLog
  })
});

let initialCalGoalsCollapsed = true;
try { initialCalGoalsCollapsed = localStorage.getItem('calGoalsCollapsed') !== '0'; } catch (err) {}
setCalGoalsCollapsed(initialCalGoalsCollapsed);

let initialFoodBankCollapsed = true;
try { initialFoodBankCollapsed = localStorage.getItem('foodBankCollapsed') !== '0'; } catch (err) {}
setFoodBankCollapsed(initialFoodBankCollapsed);
