import { calItemKey, calMonthKey, calRefreshTopFoodsCache, monthKey, state, ui } from './state.js';
import { collection, coupleCode, db, deleteField, doc, documentId, ensureAuth, feature, getDoc, markSynced, onSnapshot, query, setDoc, setSyncStatus, where } from '../core.js';
import { applyRemoteNames, applySharedSettingsToInputs, sharedSettings, syncableNames } from '../shared.js';

let calUnsub = null;
let calEntriesUnsub = null;
let calApplyingRemote = false;
let calMigratingLegacyEntries = false;
function calEntryDocRef(code, monthKey) { return doc(db, 'calorieEntries', code + '_' + monthKey); }
export function calEntriesCollectionQuery(code) {
  // Firestore has no "list docs by collection" for a client SDK without a field to filter
  // on, but document-id range queries work — this matches every calorieEntries doc whose
  // id starts with "{code}_" without needing a separate index of which months exist.
  // The upper bound is "everything that starts with `{code}_`": \uf8ff sorts after any
  // other character. (This used to be a literal invisible U+F8FF in the source, which
  // looked byte-identical to the lower bound — keep it as an explicit escape.)
  return query(collection(db, 'calorieEntries'), where(documentId(), '>=', code + '_'), where(documentId(), '<', code + '_\uf8ff'));
}
function calEntriesSliceForMonth(monthKey, sourceEntries) {
  const source = sourceEntries || state.calEntries;
  const slice = { p1: {}, p2: {} };
  ['p1', 'p2'].forEach(pk => {
    Object.entries(source[pk] || {}).forEach(([ds, day]) => {
      if (calMonthKey(ds) === monthKey) slice[pk][ds] = day;
    });
  });
  return slice;
}
// Same content-hash merge as calMergeFoodBank/calItemKey, generalized to operate on a
// plain entries object (a whole state.calEntries tree, or just one month's slice of it) instead
// of always mutating the global state.calEntries directly.
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

function calApplyRemoteData(data) {
  calApplyingRemote = true;
  if (data.settings) {
    applyRemoteNames(data.settings);
    state.calGoals = data.settings.goals || state.calGoals;
  }
  state.calDailyGoals = data.dailyGoals || {};
  state.calFoodBank = data.foodBank || [];
  state.calWeightLog = data.weightLog || { p1: {}, p2: {} };
  state.calBurnLog = data.burnLog || { p1: {}, p2: {} };
  applySharedSettingsToInputs();
  ui.populateGoalsInputs();
  try { localStorage.setItem('calorie_settings', JSON.stringify({ p1: sharedSettings.p1, p2: sharedSettings.p2, goals: state.calGoals })); } catch (err) {}
  try { localStorage.setItem('calorie_dailyGoals', JSON.stringify(state.calDailyGoals)); } catch (err) {}
  try { localStorage.setItem('calorie_foodBank', JSON.stringify(state.calFoodBank)); } catch (err) {}
  try { localStorage.setItem('calorie_weightLog', JSON.stringify(state.calWeightLog)); } catch (err) {}
  try { localStorage.setItem('calorie_burnLog', JSON.stringify(state.calBurnLog)); } catch (err) {}
  calRefreshTopFoodsCache();
  ui.renderPersonTabs();
  ui.renderAll();
  ui.renderWeightCard();
  ui.renderBurnCard();
  calApplyingRemote = false;
  if (data.entries) calMigrateLegacyEntriesIfNeeded(data.entries);
}

export function calSubscribeToCloud(code) {
  if (calUnsub) { calUnsub(); calUnsub = null; }
  if (!code) return;
  ensureAuth().then(() => {
    const ref = doc(db, 'calories', code);
    calUnsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        calApplyRemoteData(snap.data());
      } else {
        // Merge, not replace — creates a genuinely-new doc identically, but can
        // never wipe an existing one if this branch fires wrongly (see weekly/sync.js).
        calPushToCloud();
      }
      markSynced('calories');
    }, (err) => {
      console.error(err);
      setSyncStatus('Sync error (calories): ' + err.message);
    });
  });
}

// Separate subscription for the per-month entry documents (see calMonthKey above) — these
// live in their own collection, so a doc-id range query aggregates every month for this
// sync code into one combined state.calEntries tree, same shape the rest of the app expects.
export function calSubscribeToEntriesCloud(code) {
  if (calEntriesUnsub) { calEntriesUnsub(); calEntriesUnsub = null; }
  if (!code) return;
  ensureAuth().then(() => {
    calEntriesUnsub = onSnapshot(calEntriesCollectionQuery(code), (snap) => {
      // A legacy-entries migration owns state.calEntries while it runs (see
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
      state.calEntries = combined;
      try { localStorage.setItem('calorie_entries', JSON.stringify(state.calEntries)); } catch (err) {}
      calRefreshTopFoodsCache();
      ui.renderAll();
      calApplyingRemote = false;
      feature('weekly').refreshAutoChecks();
      markSynced('calorieEntries');
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
  state.calFoodBank.forEach(entry => {
    const existing = byName.get(entry.de);
    byName.set(entry.de, existing ? { ...existing, ...entry } : entry);
  });
  state.calFoodBank = Array.from(byName.values());
}

// Pushes just one month's slice of entries to its own document, merging with whatever's
// already there first (same array-clobber protection as calMergeFoodBank, just scoped to
// one month instead of the whole history — see the comment by calMonthKey above).
//
// opts.sourceEntries lets a caller (the legacy migration below) supply an explicit,
// already-merged entries tree to push from instead of reading the live state.calEntries global.
// This matters because state.calEntries is also asynchronously overwritten by the real-time
// entries-collection listener (calSubscribeToEntriesCloud) — without this, a snapshot
// landing between this function's `await`s could clobber state.calEntries out from under an
// in-flight push and cause it to write empty/stale data. (This is exactly how the July
// 2026 migration incident lost data: the migration merged legacy entries into state.calEntries,
// then awaited a push — and the entries listener's first, still-empty snapshot overwrote
// state.calEntries before the push read it, so an empty slice got written and the legacy copy
// was then deleted. See CLAUDE.md / commit history for the postmortem.)
export async function calPushEntriesForMonth(monthKey, opts = {}) {
  if (!coupleCode || calApplyingRemote) return;
  const ref = calEntryDocRef(coupleCode, monthKey);
  const usingExplicitSource = !!opts.sourceEntries;
  // Slice captured SYNCHRONOUSLY before any await — the entries listener reassigns
  // state.calEntries wholesale, and a slice taken after the awaits would drop an
  // item that was just added (same in-flight race as calPushToCloud above).
  let slice = calEntriesSliceForMonth(monthKey, opts.sourceEntries);
  try {
    await ensureAuth();
    if (!opts.skipMerge) {
      try {
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const remoteSlice = snap.data().entries || {};
          slice = calMergeEntriesInto(slice, remoteSlice);
          if (!usingExplicitSource) {
            ['p1', 'p2'].forEach(pk => Object.assign(state.calEntries[pk] || (state.calEntries[pk] = {}), slice[pk]));
          }
        }
      } catch (err) { console.error('Could not merge remote entries before push:', err); }
    }
    await setDoc(ref, { entries: slice }, { merge: true });
    if (!usingExplicitSource) {
      try { localStorage.setItem('calorie_entries', JSON.stringify(state.calEntries)); } catch (err) {}
      ui.renderLogCard();
      ui.renderMonth();
      ui.renderTrendChart();
      ui.renderDeficitCard();
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

export async function calPushToCloud(opts = {}) {
  if (!coupleCode || calApplyingRemote) return;
  // Capture the payload SYNCHRONOUSLY, before any await: a remote snapshot arriving
  // while this push is in flight reassigns state.calWeightLog/calBurnLog/etc., and a
  // payload built after the awaits would silently drop the value that was just saved
  // (this bit the Health ingest, which always races the boot-time first snapshot).
  // The captured references keep pointing at the pre-snapshot objects, so the saved
  // value reaches Firestore and the echo snapshot brings it back into live state.
  const payload = {
    settings: { ...syncableNames(), goals: state.calGoals },
    dailyGoals: state.calDailyGoals,
    foodBank: state.calFoodBank,
    weightLog: state.calWeightLog,
    burnLog: state.calBurnLog
  };
  try {
    await ensureAuth();
    // calMergeFoodBank unions by name, so it can't tell "removed locally" apart from
    // "never existed" — a deleted bank entry would otherwise get resurrected from the
    // stale remote copy. Skip the merge right after a delete and trust the local list.
    if (!opts.skipMerge) {
      try {
        const snap = await getDoc(doc(db, 'calories', coupleCode));
        if (snap.exists()) {
          calMergeFoodBank(snap.data().foodBank);
          payload.foodBank = state.calFoodBank;
        }
      } catch (err) { console.error('Could not merge remote data before push:', err); }
    }
    const writeOpts = opts.replace ? {} : { merge: true };
    // One-time cleanup: the old schema kept every food log entry ever logged inside this
    // same document, which is what drove it toward Firestore's 1 MiB limit in the first
    // place (see calMonthKey above) — once legacy entries have been migrated out to
    // calorieEntries/*, remove the now-redundant copy still sitting in this doc.
    if (opts.migrateClearEntries) payload.entries = deleteField();
    // Firestore's merge NEVER deletes map keys: pushing weightLog/burnLog without a
    // date is a no-op for that date remotely, so a deleted entry would resurrect on
    // the next load. Deletions must be explicit deleteField() tombstones.
    if (opts.deleteKeys && !opts.replace) {
      for (const [field, pk, ds] of opts.deleteKeys) {
        payload[field] = { p1: { ...(payload[field].p1 || {}) }, p2: { ...(payload[field].p2 || {}) } };
        payload[field][pk][ds] = deleteField();
      }
    }
    await setDoc(doc(db, 'calories', coupleCode), payload, writeOpts);
    try { localStorage.setItem('calorie_foodBank', JSON.stringify(state.calFoodBank)); } catch (err) {}
    try { localStorage.setItem('calorie_weightLog', JSON.stringify(state.calWeightLog)); } catch (err) {}
    try { localStorage.setItem('calorie_burnLog', JSON.stringify(state.calBurnLog)); } catch (err) {}
    ui.renderLogCard();
    ui.renderMonth();
    ui.renderTrendChart();
    ui.renderDeficitCard();
  } catch (err) {
    console.error(err);
    setSyncStatus('Sync error (calories): could not save');
  }
}

// One-time, self-healing migration off the old schema (see calMonthKey above): if the
// main calories/{code} doc still has a legacy top-level "entries" field, fold it into
// state.calEntries, push it out to the new per-month documents, then delete it from the old
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
    // state.calEntries here. calSubscribeToEntriesCloud's listener also skips applying its
    // snapshots while calMigratingLegacyEntries is true, but pushing from an isolated
    // local copy (instead of the shared global) is the actual fix; the listener guard is
    // just defense in depth. See the comment on calPushEntriesForMonth for why this
    // matters.
    const migratedEntries = calMergeEntriesInto(state.calEntries, legacyEntries);
    for (const monthKey of monthKeys) {
      await calPushEntriesForMonth(monthKey, { sourceEntries: migratedEntries });
    }
    // Migration is done and Firestore now has the real data — safe to update the shared
    // global and re-render.
    state.calEntries = calMergeEntriesInto(state.calEntries, migratedEntries);
    try { localStorage.setItem('calorie_entries', JSON.stringify(state.calEntries)); } catch (err) {}
    calRefreshTopFoodsCache();
    ui.renderAll();
    await calPushToCloud({ migrateClearEntries: true });
  } catch (err) {
    console.error('Legacy entries migration failed:', err);
  } finally {
    calMigratingLegacyEntries = false;
  }
}
