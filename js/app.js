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
// Shortcuts renders numbers with the device's locale formatting (German: "3.100,5")
// and health values can carry units ("512 kcal") — parse defensively instead of
// trusting parseFloat, which would read "3.100,5" as 3.1.
function parseHealthNumber(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim().replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // both present: the later one is the decimal separator
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // lone comma: German decimal ("91,5") unless it reads like a thousands group
    const frac = s.length - lastComma - 1;
    s = (frac === 3 && s.length > 4) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot >= 0) {
    // lone dot with a 3-digit tail: likely a German thousands separator ("12.040") —
    // but fall back to decimal if that reading is implausibly huge
    const frac = s.length - lastDot - 1;
    if (frac === 3 && s.length > 4) {
      const asThousands = parseFloat(s.replace(/\./g, ''));
      if (asThousands <= 150000) return asThousands;
    }
  }
  return parseFloat(s);
}

// A date in whatever format the device locale stringifies Shortcuts dates to:
// ISO "2026-07-16", numeric German "16.07.2026[, 09:41]", US "7/16/2026", or textual
// German/English ("16. Juli 2026 um 09:41", "Mittwoch, 16. Juli 2026", "Jul 16, 2026")
// — normalized to ISO. Weekday prefixes and trailing times are ignored.
const HEALTH_MONTHS = {
  januar: 1, februar: 2, 'märz': 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7,
  august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  jan: 1, feb: 2, 'mär': 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  okt: 10, nov: 11, dez: 12,
  january: 1, february: 2, march: 3, may: 5, june: 6, july: 7, october: 10,
  december: 12, mar: 3, oct: 10, dec: 12
};
function parseHealthDate(raw) {
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  // "16. Juli 2026", with or without weekday prefix / trailing time (not anchored)
  m = s.match(/(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]+)\.?\s+(\d{4})/);
  if (m) {
    const mon = HEALTH_MONTHS[m[2].toLowerCase().replace(/\./g, '')];
    if (mon) return m[3] + '-' + String(mon).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
  }
  // "Jul 16, 2026" (month-first English)
  m = s.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mon = HEALTH_MONTHS[m[1].toLowerCase().replace(/\./g, '')];
    if (mon) return m[3] + '-' + String(mon).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
  }
  return null;
}

// Two parallel ';'-joined lists (dates and values) from the loop-free Shortcut:
// Get Details of Health Samples applied to the whole grouped-by-day list yields the
// bucket dates and values in the same order — zip them into {isoDate: value}.
// Values may carry units and locale formatting ("8.250 Schritte") — parsed defensively.
function parseZippedSeries(datesRaw, valsRaw) {
  const out = {};
  if (!datesRaw || !valsRaw) return out;
  const dates = String(datesRaw).split(';');
  const vals = String(valsRaw).split(';');
  const n = Math.min(dates.length, vals.length);
  for (let i = 0; i < n; i++) {
    const ds = parseHealthDate(dates[i]);
    const v = parseHealthNumber(vals[i]);
    if (ds && !isNaN(v) && v >= 0) out[ds] = (out[ds] || 0) + v;
  }
  return out;
}

// A day series from the Shortcut's repeat loop: "2026-07-15,8250;2026-07-16,12040"
// (ISO dates via Shortcuts' ISO-8601 formatting — locale-proof; values rounded).
function parseHealthSeries(raw) {
  const out = {};
  if (!raw) return out;
  String(raw).split(';').forEach(pair => {
    const parts = pair.split(',');
    if (parts.length < 2) return;
    const ds = parts[0].trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
    const v = parseHealthNumber(parts.slice(1).join(','));
    if (!isNaN(v) && v >= 0) out[ds] = v;
  });
  return out;
}

(function ingestHealthParams() {
  let params;
  try { params = new URLSearchParams(window.location.search); } catch (err) { return; }
  const unreadable = [];
  const num = (name, decimals) => {
    if (params.get(name) == null) return NaN;
    const v = parseHealthNumber(params.get(name));
    if (isNaN(v)) { unreadable.push(name + '="' + params.get(name) + '"'); return NaN; }
    return decimals ? Math.round(v * 100) / 100 : Math.round(v);
  };
  const series = (name) => {
    const raw = params.get(name);
    if (raw == null) return {};
    const s = parseHealthSeries(raw);
    if (Object.keys(s).length === 0) unreadable.push(name + '="' + raw + '"');
    return s;
  };
  const zip = (dName, vName, label) => {
    const dr = params.get(dName), vr = params.get(vName);
    if (dr == null && vr == null) return {};
    const s = parseZippedSeries(dr, vr);
    if (Object.keys(s).length === 0) unreadable.push(label + '="' + (dr || '') + '" / "' + (vr || '') + '"');
    return s;
  };
  const burn = num('burn'), steps = num('steps'), weight = num('weight', true);
  const yburn = num('yburn'), ysteps = num('ysteps');
  const activeSeries = { ...series('bactive'), ...zip('adates', 'avals', 'active') };
  const restingSeries = { ...series('bresting'), ...zip('rdates', 'rvals', 'resting') };
  const stepsSeries = { ...series('hsteps'), ...zip('sdates', 'svals', 'steps') };
  const anySeries = [activeSeries, restingSeries, stepsSeries].some(s => Object.keys(s).length > 0);
  if (![burn, steps, weight, yburn, ysteps].some(v => v > 0) && !anySeries && unreadable.length === 0) return;
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
  // Day series: burned = resting + active per COMPLETED day (today is still accruing);
  // last-write-wins per day, same as a manual save.
  const burnByDate = {};
  Object.keys(activeSeries).sort().forEach(d => {
    if (d < todayStr() && restingSeries[d] != null) {
      const total = Math.round(activeSeries[d] + restingSeries[d]);
      if (total > 0) burnByDate[d] = total;
    }
  });
  const burnDays = Object.keys(burnByDate).sort();
  if (burnDays.length > 0) {
    feature('calories').logBurnMany(pk, burnByDate);
    const latest = burnDays[burnDays.length - 1];
    done.push('burned kcal for ' + burnDays.length + ' day' + (burnDays.length === 1 ? '' : 's')
      + ', latest ' + latest + ': ' + burnByDate[latest].toLocaleString());
  }
  if (Object.keys(stepsSeries).length > 0) {
    if (pk === 'p1') {
      const res = feature('training').logStepsFromCounts(pk, stepsSeries);
      done.push(res.checked.length > 0
        ? 'steps goal ✓ ' + res.checked.join(', ')
        : 'steps: no day at 10,000+ yet');
    } else {
      done.push('steps (steps tracking is p1-only)');
    }
  }
  if (yburn > 0) { feature('calories').logBurn(pk, yds, yburn); done.push(yburn.toLocaleString() + ' kcal burned (' + yds + ')'); }
  if (burn > 0) { feature('calories').logBurn(pk, ds, burn); done.push(burn.toLocaleString() + ' kcal burned'); }
  if (weight > 0) { feature('calories').logWeight(pk, ds, weight); done.push(weight + ' kg'); }
  if (ysteps > 0) logSteps(yds, ysteps);
  if (steps > 0) logSteps(ds, steps);
  // Never fail silently: a param that arrived but couldn't be parsed gets shown
  // verbatim, so a Shortcut problem is visible on screen instead of "nothing happened".
  if (unreadable.length > 0) done.push('could not read: ' + unreadable.join(', '));
  try {
    const keep = params.get('tab') ? '?tab=' + encodeURIComponent(params.get('tab')) : '';
    history.replaceState(null, '', window.location.pathname + keep);
  } catch (err) {}
  showTab(burn > 0 || weight > 0 || yburn > 0 || burnDays.length > 0 ? 'calories' : 'training');
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
