import { state, ui } from './state.js';
import { coupleCode, db, doc, ensureAuth, getDoc, markSynced, onSnapshot, setDoc, setSyncStatus } from '../core.js';
import { TR_EXERCISE_RENAMES } from '../data.js';
import { applySharedSettingsToInputs, sharedSettings } from '../shared.js';

let trUnsub = null;
let trApplyingRemote = false;

export function trApplyLegacyExerciseRenames() {
  let changed = false;
  ['p1', 'p2'].forEach(pk => {
    (state.trTrainingLog[pk] || []).forEach(l => {
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
    try { localStorage.setItem('training_log', JSON.stringify(state.trTrainingLog)); } catch (err) {}
    ui.renderAll();
    trPushToCloud();
  }
}

function trApplyRemoteData(data) {
  trApplyingRemote = true;
  if (data.settings) {
    sharedSettings.p1 = data.settings.p1 || sharedSettings.p1;
    sharedSettings.p2 = data.settings.p2 || sharedSettings.p2;
  }
  state.trTrainingLog = data.trainingLog || { p1: [], p2: [] };
  state.trCoreLog = data.coreLog || { p1: [], p2: [] };
  state.trExtraLog = data.extraLog || { p1: {}, p2: {} };
  state.trStepsCheckLog = data.stepsCheckLog || { p1: [], p2: [] };
  applySharedSettingsToInputs();
  try { localStorage.setItem('training_settings', JSON.stringify({ p1: sharedSettings.p1, p2: sharedSettings.p2 })); } catch (err) {}
  try { localStorage.setItem('training_log', JSON.stringify(state.trTrainingLog)); } catch (err) {}
  try { localStorage.setItem('training_coreLog', JSON.stringify(state.trCoreLog)); } catch (err) {}
  try { localStorage.setItem('training_extraLog', JSON.stringify(state.trExtraLog)); } catch (err) {}
  try { localStorage.setItem('training_stepsCheckLog', JSON.stringify(state.trStepsCheckLog)); } catch (err) {}
  ui.renderAll();
  trApplyingRemote = false;
  trApplyLegacyExerciseRenames();
}

export function trSubscribeToCloud(code) {
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

export async function trPushToCloud(opts = {}) {
  if (!coupleCode || trApplyingRemote) return;
  try {
    await ensureAuth();
    if (!opts.skipMerge) {
      try {
        const snap = await getDoc(doc(db, 'training', coupleCode));
        if (snap.exists()) {
          const remote = snap.data();
          state.trTrainingLog.p1 = trMergeLogArray(state.trTrainingLog.p1, remote.trainingLog && remote.trainingLog.p1);
          state.trTrainingLog.p2 = trMergeLogArray(state.trTrainingLog.p2, remote.trainingLog && remote.trainingLog.p2);
          state.trCoreLog.p1 = trMergeCoreLog(state.trCoreLog.p1, remote.coreLog && remote.coreLog.p1);
          state.trCoreLog.p2 = trMergeCoreLog(state.trCoreLog.p2, remote.coreLog && remote.coreLog.p2);
          state.trExtraLog.p1 = trMergeExtraLog(state.trExtraLog.p1, remote.extraLog && remote.extraLog.p1);
          state.trExtraLog.p2 = trMergeExtraLog(state.trExtraLog.p2, remote.extraLog && remote.extraLog.p2);
          state.trStepsCheckLog.p1 = trMergeCoreLog(state.trStepsCheckLog.p1, remote.stepsCheckLog && remote.stepsCheckLog.p1);
          state.trStepsCheckLog.p2 = trMergeCoreLog(state.trStepsCheckLog.p2, remote.stepsCheckLog && remote.stepsCheckLog.p2);
        }
      } catch (err) { console.error('Could not merge remote training log before push:', err); }
    }
    const writeOpts = opts.replace ? {} : { merge: true };
    await setDoc(doc(db, 'training', coupleCode), {
      settings: { p1: sharedSettings.p1, p2: sharedSettings.p2 },
      trainingLog: state.trTrainingLog,
      coreLog: state.trCoreLog,
      extraLog: state.trExtraLog,
      stepsCheckLog: state.trStepsCheckLog
    }, writeOpts);
    try { localStorage.setItem('training_log', JSON.stringify(state.trTrainingLog)); } catch (err) {}
    try { localStorage.setItem('training_coreLog', JSON.stringify(state.trCoreLog)); } catch (err) {}
    try { localStorage.setItem('training_extraLog', JSON.stringify(state.trExtraLog)); } catch (err) {}
    try { localStorage.setItem('training_stepsCheckLog', JSON.stringify(state.trStepsCheckLog)); } catch (err) {}
    ui.renderContent();
  } catch (err) {
    console.error(err);
    setSyncStatus('Sync error (training): could not save');
  }
}
