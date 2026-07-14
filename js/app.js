// Boot order: core/shared/features have already run their top-level setup by the
// time this executes (import order below). This file only sequences startup.
import { feature, coupleCode, setSyncStatus } from './core.js';
import { initShared, showTab } from './shared.js';
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
