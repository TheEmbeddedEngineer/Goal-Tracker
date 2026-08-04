import { CATS, state, ui } from './state.js';
import { coupleCode, db, doc, ensureAuth, markSynced, onSnapshot, setDoc, setSyncStatus, todayStr } from '../core.js';
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
  // Collect PAST days where this client holds screen:true but the incoming snapshot says
  // false — the stale-device fingerprint (see the guard below). Today is excluded: a
  // legitimate same-day untick is normal and must not be fought.
  const screenRestore = [];
  if (!data.entriesWiped) {
    const today = todayStr();
    ['p1', 'p2'].forEach(pk => {
      const localDays = (state.wkEntries || {})[pk] || {};
      const remoteDays = remoteEntries[pk] || {};
      Object.keys(localDays).forEach(ds => {
        if (ds < today && localDays[ds] && localDays[ds].screen === true
            && remoteDays[ds] && remoteDays[ds].screen === false) {
          screenRestore.push([pk, ds]);
        }
      });
    });
  }
  // One flipped day is an ordinary edit from the other device — only a bulk flip is the
  // fingerprint. Below that threshold, adopt the remote value as usual.
  if (screenRestore.length < 2) screenRestore.length = 0;
  if (wkCountDays(remoteEntries) === 0 && wkCountDays(state.wkEntries) > 0 && !data.entriesWiped) {
    antiWipeRestore = true; // keep local entries; push them back below
  } else {
    state.wkEntries = remoteEntries;
    // Keep the local truth for the days the guard is about to repair, so the UI doesn't
    // flash the clobbered values and the restore push has something to send.
    screenRestore.forEach(([pk, ds]) => {
      if (state.wkEntries[pk] && state.wkEntries[pk][ds]) state.wkEntries[pk][ds].screen = true;
    });
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
    wkPushToCloud({ includeEntries: true });
  }
  if (screenRestore.length) {
    // Screen-clobber guard (2026-08-04): a client running a stale/cached older version
    // pushes its whole entries tree on boot, silently flipping manual `screen` ticks to
    // false in bulk. Through the UI a person can only untick ONE day per action (one tap
    // = one field = one day = one leaf push), so 2+ past days losing `screen` in a single
    // snapshot is never a real user action — treat it as the stale-device fingerprint,
    // keep the local truth and push it straight back.
    console.warn('Weekly: remote cleared screen on ' + screenRestore.length + ' past days — restoring (screen-clobber guard)', screenRestore);
    const patch = { p1: {}, p2: {} };
    screenRestore.forEach(([pk, ds]) => { patch[pk][ds] = { screen: true }; });
    wkPushAutoChecks(patch);
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
        // confirmWipe-guarded reset button. Seeding a brand-new doc is one of the only
        // three places allowed to send the whole entries tree (see wkPushToCloud).
        wkPushToCloud({ includeEntries: true });
      }
      markSynced('weekly');
    }, (err) => {
      console.error(err);
      setSyncStatus('Sync error (weekly): ' + err.message);
    });
  });
}

// Background writers (auto-check, threshold-freeze) must NEVER push the whole entries
// tree: booted from localStorage before the cloud snapshot lands, that tree can carry a
// stale `screen` value (the one field the user sets by hand and auto-check has no say
// over), and a full merge push would overwrite a good remote screen check with the
// stale one. This lost real screen-time checks — the iPhone Health shortcut opens the
// app daily and fires the boot-time auto-check on stale local state. So auto-check
// writes ONLY the sport/nutrition leaves it actually changed: a nested merge write of
// just those leaves leaves `screen` (and every untouched day) alone on the server.
export async function wkPushAutoChecks(patch) {
  if (!coupleCode || wkApplyingRemote) return;
  const entries = {};
  ['p1', 'p2'].forEach(pk => { if (Object.keys(patch[pk] || {}).length) entries[pk] = patch[pk]; });
  if (Object.keys(entries).length === 0) return;
  try {
    await ensureAuth();
    await setDoc(doc(db, 'trackers', coupleCode), { entries }, { merge: true });
  } catch (err) {
    console.error(err);
    setSyncStatus('Sync error (weekly): could not save');
  }
}

// A manual toggle writes ONLY the leaf field(s) the user actually changed for one day
// — never the whole `entries` tree, and never sibling fields. This is the manual analog
// of wkPushAutoChecks and closes the last screen-clobber path: previously a row click
// saved all three checkboxes together, so toggling Sport/Nutrition re-wrote `screen`
// from a checkbox a mid-interaction cloud snapshot had reverted to a stale value. Unlike
// the auto-check, an explicit user action may set a field false too.
export async function wkPushEntryLeaves(pk, ds, fields) {
  if (!coupleCode || wkApplyingRemote) return;
  try {
    await ensureAuth();
    await setDoc(doc(db, 'trackers', coupleCode), { entries: { [pk]: { [ds]: fields } } }, { merge: true });
  } catch (err) {
    console.error(err);
    setSyncStatus('Sync error (weekly): could not save');
  }
}

// The threshold-freeze (see wkThresholdsForWeek) only ever changes weeklyThresholds, so
// it writes only that field — same reason as wkPushAutoChecks: a render-path push of the
// full entries tree could clobber a manual screen check with a stale one.
export async function wkPushWeeklyThresholds() {
  if (!coupleCode || wkApplyingRemote) return;
  try {
    await ensureAuth();
    await setDoc(doc(db, 'trackers', coupleCode), { weeklyThresholds: state.wkWeeklyThresholds }, { merge: true });
  } catch (err) {
    console.error(err);
    setSyncStatus('Sync error (weekly): could not save');
  }
}

export async function wkPushToCloud(opts = {}) {
  if (!coupleCode || wkApplyingRemote) return;
  // Capture the payload SYNCHRONOUSLY, before any await: a remote snapshot arriving
  // while this push is in flight reassigns the state objects, and a payload built
  // after the awaits would silently drop whatever was just saved (the July-12 lesson:
  // never re-read mutable shared state after an await).
  const payload = {
    settings: { ...syncableNames(), thresholds: state.wkThresholds },
    weeklyThresholds: state.wkWeeklyThresholds
  };
  // `entries` is OPT-IN, never part of an ordinary push. Every legitimate entries write
  // goes through a leaf-scoped writer (wkPushEntryLeaves for manual toggles,
  // wkPushAutoChecks for derived checks). Shipping the whole tree by default is what
  // repeatedly destroyed manual Screen ticks: a settings/threshold save — or any client
  // booted with stale localStorage — would write every day from stale local state. It
  // only ever SHOWED as screen damage because sport/nutrition are re-derived from
  // training/calories by the auto-check (so they get rewritten to the same values),
  // while `screen` is manual-only and nothing can regenerate it.
  // Only doc-creation, the anti-wipe restore, and the deliberate reset send the tree.
  if (opts.includeEntries || opts.replace) payload.entries = state.wkEntries;
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
