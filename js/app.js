// Boot order: core/shared/features have already run their top-level setup by the
// time this executes (import order below). This file only sequences startup.
import { feature, coupleCode, loadDevicePerson, setSyncStatus, todayStr } from './core.js';
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

// Health ingest: an iOS Shortcut reads Apple Health (active energy, steps, latest
// weight) and opens the app as ?burn=2650&steps=12040&weight=91.8[&date=YYYY-MM-DD].
// Values are logged for the DEVICE OWNER through the same feature code as the manual
// save buttons (all sync/merge safety applies). The ingest params are stripped from
// the URL immediately so a reload can never double-ingest.
(function ingestHealthParams() {
  let params;
  try { params = new URLSearchParams(window.location.search); } catch (err) { return; }
  const burn = Math.round(parseFloat(params.get('burn')));
  const steps = Math.round(parseFloat(params.get('steps')));
  const weight = Math.round(parseFloat(params.get('weight')) * 100) / 100;
  if (!(burn > 0) && !(steps > 0) && !(weight > 0)) return;
  const pk = loadDevicePerson() || 'p1';
  let ds = params.get('date') || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds) || ds > todayStr()) ds = todayStr();
  const done = [];
  if (burn > 0) { feature('calories').logBurn(pk, ds, burn); done.push(burn.toLocaleString() + ' kcal burned'); }
  if (weight > 0) { feature('calories').logWeight(pk, ds, weight); done.push(weight + ' kg'); }
  if (steps > 0) {
    if (pk === 'p1') {
      const met = feature('training').logStepsIfGoalMet(pk, ds, steps);
      done.push(steps.toLocaleString() + ' steps' + (met ? ' ✓' : ' (below goal, not checked)'));
    } else {
      done.push(steps.toLocaleString() + ' steps (steps tracking is p1-only)');
    }
  }
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
