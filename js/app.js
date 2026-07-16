// Boot order: core/shared/features have already run their top-level setup by the
// time this executes (import order below). This file only sequences startup.
import { dstr, feature, coupleCode, loadDevicePerson, setSyncStatus, todayStr } from './core.js';
import { initShared, sharedSettings, showTab } from './shared.js';
import './weekly/index.js';
import './calories/index.js';
import './training/index.js';

initShared();

feature('weekly').loadData();
feature('calories').loadData();
feature('training').loadData();

setSyncStatus(coupleCode ? 'Connecting…' : 'Not syncing — enter a sync code above to share data across devices.');
feature('weekly').subscribe(coupleCode);
feature('calories').subscribe(coupleCode);
feature('training').subscribe(coupleCode);

let initialTab = 'weekly';
try {
  const params = new URLSearchParams(window.location.search);
  initialTab = params.get('tab') || localStorage.getItem('activeTab') || 'weekly';
} catch (err) {}
showTab(initialTab);

// Health ingest: an iOS Shortcut reads Apple Health and opens the app with values in
// the URL. Two families of params, all optional and combinable:
//   Today-dated (or &date=YYYY-MM-DD): ?burn=2650&steps=12040&weight=91.8
//   Yesterday-dated (the app computes yesterday itself): ?yburn=3100&ysteps=8540
// The daily automation sends yburn (resting+active energy of the completed day),
// ysteps and steps — so yesterday's deficit is exact and both days' step goals get
// their checkmark. Values are logged for the DEVICE OWNER through the same feature
// code as the manual save buttons (all sync/merge safety applies). The ingest params
// are stripped from the URL immediately so a reload can never double-ingest.
(function ingestHealthParams() {
  let params;
  try { params = new URLSearchParams(window.location.search); } catch (err) { return; }
  const num = (name, decimals) => {
    const v = parseFloat(params.get(name));
    return decimals ? Math.round(v * 100) / 100 : Math.round(v);
  };
  const burn = num('burn'), steps = num('steps'), weight = num('weight', true);
  const yburn = num('yburn'), ysteps = num('ysteps');
  if (![burn, steps, weight, yburn, ysteps].some(v => v > 0)) return;
  const pk = loadDevicePerson() || 'p1';
  let ds = params.get('date') || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds) || ds > todayStr()) ds = todayStr();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yds = dstr(y);
  const done = [];
  const logSteps = (d, n) => {
    const label = d === todayStr() ? 'today' : d;
    if (pk !== 'p1') { done.push(n.toLocaleString() + ' steps (steps tracking is p1-only)'); return; }
    const met = feature('training').logStepsIfGoalMet(pk, d, n);
    done.push(n.toLocaleString() + ' steps ' + label + (met ? ' ✓' : ' (below goal, not checked)'));
  };
  if (yburn > 0) { feature('calories').logBurn(pk, yds, yburn); done.push(yburn.toLocaleString() + ' kcal burned (' + yds + ')'); }
  if (burn > 0) { feature('calories').logBurn(pk, ds, burn); done.push(burn.toLocaleString() + ' kcal burned'); }
  if (weight > 0) { feature('calories').logWeight(pk, ds, weight); done.push(weight + ' kg'); }
  if (ysteps > 0) logSteps(yds, ysteps);
  if (steps > 0) logSteps(ds, steps);
  try {
    const keep = params.get('tab') ? '?tab=' + encodeURIComponent(params.get('tab')) : '';
    history.replaceState(null, '', window.location.pathname + keep);
  } catch (err) {}
  showTab(burn > 0 || weight > 0 ? 'calories' : 'training');
  const toast = document.getElementById('healthToast');
  if (toast) {
    const name = pk === 'p1' ? sharedSettings.p1 : sharedSettings.p2;
    toast.querySelector('span').textContent = 'From Health for ' + name + ' (' + ds + '): ' + done.join(' · ');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 8000);
  }
})();
document.getElementById('healthToastClose').addEventListener('click', () => {
  document.getElementById('healthToast').classList.remove('show');
});

if ('serviceWorker' in navigator) {
  // This module is loaded via dynamic import (see index.html's boot script), so the
  // window 'load' event may already have fired by the time this runs — register
  // directly in that case or the SW would never be installed.
  const registerSW = () => navigator.serviceWorker.register('sw.js').catch(err => console.error('SW registration failed:', err));
  if (document.readyState === 'complete') registerSW();
  else window.addEventListener('load', registerSW);
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data === 'update-available') document.getElementById('updateToast').classList.add('show');
  });
}
document.getElementById('updateReloadBtn').addEventListener('click', () => location.reload());
document.getElementById('updateDismissBtn').addEventListener('click', () => {
  document.getElementById('updateToast').classList.remove('show');
});
