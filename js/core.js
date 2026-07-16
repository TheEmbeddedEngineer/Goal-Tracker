import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc, onSnapshot, collection, query, where, documentId, deleteField } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBlts7uMhKzrBpGl-yK6hyn6TzP-Yb3zYE",
  authDomain: "goal-tracker-f1a70.firebaseapp.com",
  projectId: "goal-tracker-f1a70",
  storageBucket: "goal-tracker-f1a70.firebasestorage.app",
  messagingSenderId: "957910892671",
  appId: "1:957910892671:web:05ce0cd27216d98e30ff4a"
};
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);


export let coupleCode = '';
export function setCoupleCode(c) { coupleCode = c; }
export function resetSyncReady() { syncReadySources.clear(); }

/* Feature registry: weekly/calories/training register a small API here so the
   shared UI (tabs, Today card, glance bar, backup) can reach them without the
   shared layer importing feature modules — all imports point one way. */
const featureRegistry = {};
export function register(name, api) { featureRegistry[name] = api; }
export function feature(name) { return featureRegistry[name]; }
export function featureList() { return Object.values(featureRegistry); }
let authReadyPromise = null;
const syncReadySources = new Set();

export function ensureAuth() {
  if (!authReadyPromise) {
    authReadyPromise = signInAnonymously(auth).catch(err => {
      console.error(err);
      setSyncStatus('Sync error: could not connect');
      // Don't cache the failure — the next sync attempt should retry the sign-in
      // (e.g. the app was opened offline and connectivity came back later).
      authReadyPromise = null;
    });
  }
  return authReadyPromise;
}

export function setSyncStatus(text) {
  const el = document.getElementById('syncStatus');
  if (el) el.textContent = text;
  // Mirror the state onto the always-visible dots (Setup header + phone app bar),
  // since the status text itself is hidden whenever the card is collapsed.
  let state = '';
  if (/^Synced/.test(text)) state = 'on';
  else if (/error/i.test(text)) state = 'error';
  else if (/^Connecting/.test(text)) state = 'connecting';
  ['syncDot', 'appBarDot'].forEach(id => {
    const dot = document.getElementById(id);
    if (!dot) return;
    dot.className = 'sync-dot' + (state ? ' ' + state : '');
    dot.title = text;
  });
}

// Shared guard for the two "Clear all …" links: wiping syncs to the other person's
// device too, so a lone confirm() is too easy to click through.
export function confirmWipe(what) {
  if (!confirm(`Clear all ${what} for both people? This syncs to your partner's device too and cannot be undone.`)) return false;
  const typed = prompt('Type "delete" to confirm:');
  return typed !== null && typed.trim().toLowerCase() === 'delete';
}

// Each subscription reports its own name — counting distinct sources (not raw
// snapshot events) so one chatty listener can't flip the dot green while another
// collection never connected.
export function markSynced(source) {
  syncReadySources.add(source);
  if (syncReadySources.size >= 4) setSyncStatus('Synced as "' + coupleCode + '"');
}

export function loadDevicePerson() {
  try { const v = localStorage.getItem('devicePerson'); return (v === 'p1' || v === 'p2') ? v : ''; } catch (err) { return ''; }
}
export function loadActivePerson(key) {
  // A device owner ("this phone belongs to …") wins on every fresh load, so each
  // phone always starts on its own person; switching mid-session still works and
  // only lasts until the next load.
  const dev = loadDevicePerson();
  if (dev) return dev;
  try { const v = localStorage.getItem(key); return (v === 'p1' || v === 'p2') ? v : 'p1'; } catch (err) { return 'p1'; }
}
export function saveActivePerson(key, value) {
  try { localStorage.setItem(key, value); } catch (err) {}
}


// For user-entered text (food names, bank entries) injected into innerHTML or
// attribute values — a name like `Käse <3` or one containing quotes must render
// as text, not break the markup.
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
export function parseDate(s) { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
export function dstr(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

export function getMonday(dateObj) {
  const d = new Date(dateObj);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

// Binary floating point can't represent most decimals exactly, so repeated addition of
// values like 0.1 drifts (e.g. 181.10000000003) — round to 2 decimals everywhere a macro
// value is computed or stored, not just where it's displayed.
export function calRound2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Shared by the calorie and training monthly calendars.
export function buildMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const cells = [];
  for (let i=0;i<startOffset;i++) cells.push(null);
  for (let d=1; d<=daysInMonth; d++) cells.push(d);
  return cells;
}

// Minimal hand-rolled SVG line chart — single series (no legend needed), thin 2px line
// in the active person's existing theme color, optional dashed goal reference line,
// recessive axis labels, tap-to-reveal exact values instead of hover (mobile-first).
export function buildTrendChart(points, opts) {
  if (points.length === 0) {
    return '<div class="empty-state" style="padding:1rem 0;">Not enough data yet.</div>';
  }
  // A single point can't show a trend line — an axis stretched around one dot reads as
  // broken rather than "just getting started," so say that explicitly instead.
  if (points.length === 1) {
    return `<div class="empty-state" style="padding:1rem 0;">First value logged: ${points[0].value}${opts.unit || ''} on ${points[0].date}. Log one more to see a trend.</div>`;
  }
  const width = 320, height = 130, padL = 38, padR = 10, padT = 12, padB = 20;
  const plotW = width - padL - padR, plotH = height - padT - padB;

  const values = points.map(p => p.value);
  let lo = Math.min(...values, opts.goal != null ? opts.goal : Infinity);
  let hi = Math.max(...values, opts.goal != null ? opts.goal : -Infinity);
  if (lo === hi) { lo -= 1; hi += 1; }
  // "Nice" axis: snap the bounds to a 1/2/5×10^k step so the scale reads as standard
  // round numbers with even gridlines, instead of arbitrary data-hugging values that
  // make every chart look differently (and randomly) scaled.
  const rawStep = (hi - lo) / 4;
  const stepPow = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 5, 10].map(m => m * stepPow).find(s => s >= rawStep);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const tickDecimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const fmtTick = v => v.toFixed(tickDecimals) + (opts.unit || '');

  const x = i => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = v => padT + plotH - ((v - min) / (max - min)) * plotH;

  const linePoints = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" fill="var(${opts.color})" data-i="${i}" class="trend-dot"></circle>`).join('');
  const goalY = opts.goal != null ? y(opts.goal) : null;
  const goalLine = opts.goal != null
    ? `<line x1="${padL}" y1="${goalY.toFixed(1)}" x2="${width - padR}" y2="${goalY.toFixed(1)}" stroke="var(--text-secondary)" stroke-width="1.5" stroke-dasharray="5,3"></line>
       <text x="${width - padR}" y="${(goalY - 4).toFixed(1)}" font-size="9" fill="var(--text-secondary)" text-anchor="end">Goal: ${opts.goal}${opts.unit || ''}</text>`
    : '';

  const tickCount = Math.round((max - min) / step);
  const gridLines = Array.from({ length: tickCount + 1 }, (_, i) => {
    const v = min + i * step;
    const yy = y(v);
    return `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${width - padR}" y2="${yy.toFixed(1)}" stroke="var(--border)" stroke-width="${i === 0 ? 1 : 0.5}"></line>
      <text x="${padL - 4}" y="${(yy + 3).toFixed(1)}" font-size="9" fill="var(--text-muted)" text-anchor="end">${fmtTick(v)}</text>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="trend-chart">
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="var(--border)" stroke-width="1"></line>
      ${gridLines}
      ${goalLine}
      <polyline points="${linePoints}" fill="none" stroke="var(${opts.color})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
      ${dots}
      <text x="${padL}" y="${height - 4}" font-size="9" fill="var(--text-muted)">${points[0].date.slice(5)}</text>
      <text x="${width - padR}" y="${height - 4}" font-size="9" fill="var(--text-muted)" text-anchor="end">${points[points.length - 1].date.slice(5)}</text>
    </svg>
    <div class="trend-detail" id="${opts.detailId}">Tap a point to see the exact value.</div>
  `;
}

export { db, auth };
export { doc, setDoc, getDoc, getDocs, deleteDoc, onSnapshot, collection, query, where, documentId, deleteField };
