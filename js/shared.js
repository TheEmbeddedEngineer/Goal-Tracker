import {
  coupleCode, setCoupleCode, resetSyncReady, setSyncStatus,
  feature, featureList, todayStr, parseDate, dstr, loadDevicePerson
} from './core.js';

export let sharedSettings = { p1: 'You', p2: 'Partner' };

function downloadBackup() {
  const data = {
    exportedAt: new Date().toISOString(),
    syncCode: coupleCode,
    sharedSettings,
    weekly: feature('weekly').exportData(),
    calories: feature('calories').exportData(),
    training: feature('training').exportData()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'couple-tracker-backup-' + todayStr() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
document.getElementById('exportBtn').addEventListener('click', downloadBackup);

export function applySharedSettingsToInputs() {
  document.getElementById('p1Name').value = sharedSettings.p1;
  document.getElementById('p2Name').value = sharedSettings.p2;
  updateDevicePersonOptions();
}

function updateDevicePersonOptions() {
  const o1 = document.getElementById('devicePersonP1');
  const o2 = document.getElementById('devicePersonP2');
  if (o1 && o1.textContent !== sharedSettings.p1) o1.textContent = sharedSettings.p1;
  if (o2 && o2.textContent !== sharedSettings.p2) o2.textContent = sharedSettings.p2;
}

document.getElementById('devicePerson').addEventListener('change', () => {
  const v = document.getElementById('devicePerson').value;
  try {
    if (v) localStorage.setItem('devicePerson', v); else localStorage.removeItem('devicePerson');
  } catch (err) {}
  if (v !== 'p1' && v !== 'p2') return;
  // Switch all three tabs to the owner right away, same renders as the person tabs use.
  featureList().forEach(f => f.setPerson(v));
});

function saveSharedSettings() {
  sharedSettings.p1 = document.getElementById('p1Name').value || 'You';
  sharedSettings.p2 = document.getElementById('p2Name').value || 'Partner';
  try { localStorage.setItem('sharedSettings', JSON.stringify(sharedSettings)); } catch (err) {}
  featureList().forEach(f => f.onSettingsChanged());
}

function onSyncCodeChange() {
  const code = document.getElementById('syncCode').value.trim();
  setCoupleCode(code);
  try { localStorage.setItem('coupleCode', code); } catch (err) {}
  resetSyncReady();
  setSyncStatus(code ? 'Connecting…' : 'Not syncing — enter a sync code above to share data across devices.');
  featureList().forEach(f => f.subscribe(code));
}

document.getElementById('p1Name').addEventListener('change', saveSharedSettings);
document.getElementById('p2Name').addEventListener('change', saveSharedSettings);
document.getElementById('syncCode').addEventListener('change', onSyncCodeChange);

function setSetupCollapsed(collapsed) {
  document.getElementById('setupBody').classList.toggle('collapsed', collapsed);
  document.getElementById('setupArrow').innerHTML = collapsed ? '&#9656;' : '&#9662;';
  try { localStorage.setItem('setupCollapsed', collapsed ? '1' : '0'); } catch (err) {}
}
document.getElementById('setupToggle').addEventListener('click', () => {
  setSetupCollapsed(!document.getElementById('setupBody').classList.contains('collapsed'));
});

// On phones the Setup card is hidden behind the app-bar gear (it's a rare-touch card);
// the gear reveals it expanded at the top of the page.
document.getElementById('appBarGear').addEventListener('click', () => {
  const show = !document.body.classList.contains('show-setup');
  document.body.classList.toggle('show-setup', show);
  if (show) {
    setSetupCollapsed(false);
    window.scrollTo({ top: 0 });
  }
});


const SECTION_IDS = { weekly: 'section-weekly', calories: 'section-calories', training: 'section-training' };
let currentTab = 'weekly';
export function showTab(tab) {
  if (!SECTION_IDS[tab]) tab = 'weekly';
  currentTab = tab;
  Object.entries(SECTION_IDS).forEach(([key, id]) => {
    document.getElementById(id).style.display = key === tab ? '' : 'none';
  });
  document.querySelectorAll('.main-tabs button, .bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  try { localStorage.setItem('activeTab', tab); } catch (err) {}
  renderGlanceBar();
}
document.querySelectorAll('.main-tabs button').forEach(b => {
  b.addEventListener('click', () => showTab(b.dataset.tab));
});
// Bottom-nav taps also jump back to the top: on a phone you're usually deep down a
// long page when switching, and landing mid-scroll in another tab is disorienting.
document.querySelectorAll('.bottom-nav button').forEach(b => {
  b.addEventListener('click', () => { showTab(b.dataset.tab); window.scrollTo({ top: 0 }); });
});

// Phone app bar's one-line summary of the active tab for its active person — the key
// numbers stay visible while scrolled anywhere in the page. Re-rendered from
// renderTodayCard (which every tab's renderAll already calls) and on tab switches.
export function renderGlanceBar() {
  const el = document.getElementById('glanceBar');
  if (!el) return;
  const f = feature(currentTab);
  let html = '';
  try { html = f ? f.glanceHtml() : ''; } catch (err) { html = ''; }
  el.innerHTML = html;
}

// At-a-glance "did I/we do everything today" strip shown above the tabs regardless of
// which one is active — without it you'd have to visit all 3 tabs to know your own full
// status, let alone your partner's.
export function renderTodayCard() {
  const el = document.getElementById('todayGrid');
  if (!el) return;
  const rows = [['Weekly', 'weekly'], ['Calories', 'calories'], ['Training', 'training']]
    .map(([label, tab]) => [label, tab, pk => { const f = feature(tab); return f ? f.isDoneToday(pk) : false; }]);
  const pill = (tab, pk, done) => `<button type="button" class="today-pill ${done ? 'done' : 'pending'}" data-tab="${tab}" data-p="${pk}" title="Go to ${tab} for ${pk === 'p1' ? sharedSettings.p1 : sharedSettings.p2}">${done ? '✓' : '—'}</button>`;
  el.innerHTML = `
    <div class="today-grid-inner">
      <span></span>
      <span class="today-person" style="color:var(--p1)">${sharedSettings.p1}</span>
      <span class="today-person" style="color:var(--p2)">${sharedSettings.p2}</span>
      ${rows.map(([label, tab, fn]) => `
        <span class="today-label">${label}</span>
        ${pill(tab, 'p1', fn('p1'))}
        ${pill(tab, 'p2', fn('p2'))}
      `).join('')}
    </div>
  `;
  el.querySelectorAll('.today-pill').forEach(btn => {
    btn.addEventListener('click', () => jumpToToday(btn.dataset.tab, btn.dataset.p));
  });
  renderGlanceBar();
  updateDevicePersonOptions();
  scanDatePickers();
}

// Jumps from the Today card straight to the relevant tab, with that person selected and
// today's date preset — so seeing a "—" is one tap away from actually logging it, instead
// of requiring a manual tab switch + person switch + date pick.
function jumpToToday(tab, pk) {
  showTab(tab);
  const f = feature(tab);
  if (f) f.jumpToToday(pk);
  document.getElementById(SECTION_IDS[tab]).scrollIntoView({ behavior: 'smooth', block: 'start' });
}


function loadSharedSettings() {
  try {
    const s = localStorage.getItem('sharedSettings');
    if (s) { sharedSettings = JSON.parse(s); return; }
  } catch (err) {}
  // First run on the combined page: migrate names from whichever standalone page was used before.
  for (const key of ['settings', 'calorie_settings', 'training_settings']) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.p1) sharedSettings.p1 = parsed.p1;
        if (parsed.p2) sharedSettings.p2 = parsed.p2;
        break;
      }
    } catch (err) {}
  }
}

function loadCoupleCode() {
  try {
    const c = localStorage.getItem('coupleCode');
    if (c) { setCoupleCode(c); return; }
  } catch (err) {}
  // First run on the combined page: migrate the sync code from whichever standalone page was used before.
  for (const key of ['calorie_coupleCode', 'training_coupleCode']) {
    try {
      const c = localStorage.getItem(key);
      if (c) { setCoupleCode(c); break; }
    } catch (err) {}
  }
}

export function initShared() {
  loadSharedSettings();
  loadCoupleCode();
  applySharedSettingsToInputs();
  document.getElementById('syncCode').value = coupleCode;
  document.getElementById('devicePerson').value = loadDevicePerson();
  let initialSetupCollapsed = true;
  try { initialSetupCollapsed = localStorage.getItem('setupCollapsed') !== '0'; } catch (err) {}
  // First run (or sync code removed): keep Setup open so the "not syncing" hint is
  // actually visible — collapsed, a new user never learns they're running local-only.
  // On phones the whole card is additionally hidden behind the app-bar gear, so also
  // force it visible until a sync code exists.
  if (!coupleCode) {
    initialSetupCollapsed = false;
    document.body.classList.add('show-setup');
  }
  setSetupCollapsed(initialSetupCollapsed);
  scanDatePickers();
}


/* ===== Date-picker UX: every date input shows "Today"/"Yesterday" instead of the
   raw date, with a one-tap Today button when it's set to anything else. The native
   input stays on top as an invisible overlay so tapping still opens the OS picker.
   Training re-renders its pickers wholesale, so a periodic scan (re)upgrades any
   input[type=date] that appears and refreshes labels set programmatically. ===== */
const dpRegistry = [];

function dpLabel(v) {
  if (!v) return 'Pick date';
  if (v === todayStr()) return 'Today';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (v === dstr(y)) return 'Yesterday';
  return parseDate(v).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function dpRefresh(entry) {
  const label = dpLabel(entry.input.value);
  if (label !== entry.last) {
    entry.disp.textContent = label;
    entry.last = label;
  }
  // Outside the label guard: min/max can change without the value changing
  // (e.g. the midnight-rollover bump below), and the arrows must follow.
  const v = entry.input.value;
  entry.nextBtn.disabled = !!(entry.input.max && v && v >= entry.input.max);
  entry.prevBtn.disabled = !!(entry.input.min && v && v <= entry.input.min);
}

function dpShift(input, days) {
  const d = parseDate(input.value || todayStr());
  d.setDate(d.getDate() + days);
  let v = dstr(d);
  if (input.max && v > input.max) v = input.max;
  if (input.min && v < input.min) v = input.min;
  if (v === input.value) return;
  input.value = v;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function upgradeDatePicker(input) {
  if (input.dataset.dpUpgraded) return;
  input.dataset.dpUpgraded = '1';
  const wrap = document.createElement('span');
  wrap.className = 'dp-wrap';
  input.parentNode.insertBefore(wrap, input);
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'dp-step';
  prevBtn.innerHTML = '&lsaquo;';
  prevBtn.title = 'Previous day';
  wrap.parentNode.insertBefore(prevBtn, wrap);
  const disp = document.createElement('span');
  disp.className = 'dp-display';
  wrap.appendChild(disp);
  wrap.appendChild(input);
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'dp-step';
  nextBtn.innerHTML = '&rsaquo;';
  nextBtn.title = 'Next day';
  wrap.parentNode.insertBefore(nextBtn, wrap.nextSibling);
  prevBtn.addEventListener('click', () => dpShift(input, -1));
  nextBtn.addEventListener('click', () => dpShift(input, 1));
  const entry = { input, disp, prevBtn, nextBtn, last: null };
  dpRegistry.push(entry);
  input.addEventListener('change', () => dpRefresh(entry));
  input.addEventListener('input', () => dpRefresh(entry));
  dpRefresh(entry);
}

let dpToday = todayStr();

export function scanDatePickers() {
  // Day rollover while the app stayed open (an installed PWA resumed the next
  // morning): every picker in this app caps at "today", but most only set max at
  // load — without this bump the › arrow stays disabled and the actual today is
  // unreachable until a full reload.
  const t = todayStr();
  if (t !== dpToday) {
    document.querySelectorAll('input[type=date]').forEach(inp => {
      if (inp.max === dpToday) inp.max = t;
    });
    dpToday = t;
  }
  document.querySelectorAll('input[type=date]:not([data-dp-upgraded])').forEach(upgradeDatePicker);
  for (let i = dpRegistry.length - 1; i >= 0; i--) {
    if (!document.body.contains(dpRegistry[i].input)) dpRegistry.splice(i, 1);
    else dpRefresh(dpRegistry[i]);
  }
}
setInterval(() => { if (!document.hidden) scanDatePickers(); }, 700);
