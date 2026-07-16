import { CATS, state, ui } from './state.js';
import { coupleCode, db, doc, ensureAuth, markSynced, onSnapshot, setDoc, setSyncStatus } from '../core.js';
import { WK_FROZEN_FIXES } from '../data.js';
import { applyRemoteNames, applySharedSettingsToInputs, sharedSettings, syncableNames } from '../shared.js';

let wkUnsub = null;
let wkApplyingRemote = false;

// See WK_FROZEN_FIXES in data.js — replaces a known-bad frozen week value with the
// correct one and pushes; a no-op once (and wherever) the bad value is gone.
export function wkApplyFrozenFixes() {
  let changed = false;
  WK_FROZEN_FIXES.forEach(([weekKey, bad, good]) => {
    const cur = state.wkWeeklyThresholds[weekKey];
    if (cur && CATS.every(([k]) => cur[k] === bad[k])) {
      state.wkWeeklyThresholds[weekKey] = { ...good };
      changed = true;
    }
  });
  if (changed) {
    try { localStorage.setItem('weeklyThresholds', JSON.stringify(state.wkWeeklyThresholds)); } catch (err) {}
    ui.renderAll();
    wkPushToCloud();
  }
}

function wkCountDays(entries) {
  return ['p1', 'p2'].reduce((n, pk) => n + Object.keys((entries || {})[pk] || {}).length, 0);
}

function wkApplyRemoteData(data) {
  wkApplyingRemote = true;
  // Anti-wipe guard (2026-07-15): a device running the original app version replaces
  // this doc wholesale (its setDoc had no merge) with ITS empty entries every time it
  // opens — this wiped all weekly data twice. An empty remote entries map while local
  // has real days is therefore treated as that wipe and pushed back, NOT adopted.
  // A deliberate "Clear all weekly data" is distinguished by the entriesWiped marker
  // its replace writes (see wkPushToCloud) — guards stand down for it.
  const remoteEntries = data.entries || {};
  let antiWipeRestore = false;
  if (wkCountDays(remoteEntries) === 0 && wkCountDays(state.wkEntries) > 0 && !data.entriesWiped) {
    antiWipeRestore = true; // keep local entries; push them back below
  } else {
    state.wkEntries = remoteEntries;
  }
  if (data.settings) {
    applyRemoteNames(data.settings);
    state.wkThresholds = data.settings.thresholds || state.wkThresholds;
  }
  state.wkWeeklyThresholds = data.weeklyThresholds || {};
  applySharedSettingsToInputs();
  document.getElementById('thNutrition').value = state.wkThresholds.nutrition;
  document.getElementById('thScreen').value = state.wkThresholds.screen;
  document.getElementById('thSport').value = state.wkThresholds.sport;
  try { localStorage.setItem('entries', JSON.stringify(state.wkEntries)); } catch (err) {}
  try { localStorage.setItem('settings', JSON.stringify({ p1: sharedSettings.p1, p2: sharedSettings.p2, thresholds: state.wkThresholds })); } catch (err) {}
  try { localStorage.setItem('weeklyThresholds', JSON.stringify(state.wkWeeklyThresholds)); } catch (err) {}
  ui.renderPersonTabs();
  ui.loadCheckboxesForDate();
  ui.renderAll();
  wkApplyingRemote = false;
  wkApplyFrozenFixes();
  ui.refreshAutoChecks();
  if (antiWipeRestore) {
    console.warn('Weekly: remote entries empty but local has data — restoring (anti-wipe guard)');
    wkPushToCloud();
  }
}

export function wkSubscribeToCloud(code) {
  if (wkUnsub) { wkUnsub(); wkUnsub = null; }
  if (!code) return;
  ensureAuth().then(() => {
    const ref = doc(db, 'trackers', code);
    wkUnsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        wkApplyRemoteData(snap.data());
      } else {
        // Plain merge push: identical to replace when the doc truly doesn't exist
        // (it creates it), but if this branch ever fires wrongly it can no longer
        // wipe an existing doc. Replace stays reserved for the explicit,
        // confirmWipe-guarded reset button.
        wkPushToCloud();
      }
      markSynced('weekly');
    }, (err) => {
      console.error(err);
      setSyncStatus('Sync error (weekly): ' + err.message);
    });
  });
}

export async function wkPushToCloud(opts = {}) {
  if (!coupleCode || wkApplyingRemote) return;
  // Capture the payload SYNCHRONOUSLY, before any await: a remote snapshot arriving
  // while this push is in flight reassigns the state objects, and a payload built
  // after the awaits would silently drop whatever was just saved (the July-12 lesson:
  // never re-read mutable shared state after an await).
  const payload = {
    entries: state.wkEntries,
    settings: { ...syncableNames(), thresholds: state.wkThresholds },
    weeklyThresholds: state.wkWeeklyThresholds
  };
  // Deliberate wipe (reset button): mark it so other devices' anti-wipe guard
  // accepts the empty entries instead of restoring them.
  if (opts.wipeMarker) payload.entriesWiped = Date.now();
  try {
    await ensureAuth();
    const writeOpts = opts.replace ? {} : { merge: true };
    await setDoc(doc(db, 'trackers', coupleCode), payload, writeOpts);
  } catch (err) {
    console.error(err);
    setSyncStatus('Sync error (weekly): could not save');
  }
}
