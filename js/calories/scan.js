import { calApplyScannedProduct } from './log.js';

/* Barcode scanning for food logging: live camera preview → decode → Open Food Facts
   lookup prefills the log form with per-100g values. iOS Safari ships NO native
   BarcodeDetector (verified 2026-07: disabled in all versions), so the decoder falls
   back to the vendored ZXing library (js/vendor/zxing.min.js, @zxing/library 0.21.3,
   Apache-2.0, self-hosted and precached — lazily loaded the first time Scan is
   tapped). Chrome/Android use the native BarcodeDetector. The button shows whenever
   a camera API exists. Open Food Facts is a free, CORS-enabled public API. */

let scanStream = null;   // native path owns the camera stream
let scanTimer = null;    // native path polling timer
let zxingReader = null;  // fallback path: ZXing owns its own stream

function scanActive() { return !!(scanTimer || scanStream || zxingReader); }

function scanStop() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  if (zxingReader) { try { zxingReader.reset(); } catch (err) {} zxingReader = null; }
  const video = document.getElementById('scanVideo');
  if (video) video.srcObject = null;
  document.getElementById('scanOverlay').classList.remove('open');
}

async function scanLookup(code) {
  const statusEl = document.getElementById('bankStatus');
  statusEl.textContent = 'Looking up barcode ' + code + '…';
  try {
    const r = await fetch('https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code)
      + '.json?fields=product_name,product_name_de,nutriments');
    const data = await r.json();
    if (!data || data.status !== 1 || !data.product) {
      statusEl.textContent = 'Barcode ' + code + ' isn’t in Open Food Facts — enter the values manually.';
      return;
    }
    calApplyScannedProduct(data.product);
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Barcode lookup failed (offline?) — enter the values manually.';
  }
}

function onScanHit(code) {
  if (!scanActive()) return; // a late double-fire after stop must be a no-op
  scanStop();
  scanLookup(code);
}

function loadZXing() {
  return new Promise((resolve, reject) => {
    if (window.ZXing) return resolve();
    const s = document.createElement('script');
    s.src = 'js/vendor/zxing.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('could not load decoder'));
    document.head.appendChild(s);
  });
}

async function scanStartNative(video, hint) {
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (err) {
    hint.textContent = 'Camera access was denied — allow it in the browser settings to scan.';
    return;
  }
  video.srcObject = scanStream;
  try { await video.play(); } catch (err) {}
  const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
  scanTimer = setInterval(async () => {
    if (!scanStream) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length > 0 && codes[0].rawValue) onScanHit(codes[0].rawValue);
    } catch (err) { /* frames early in the stream can throw — keep polling */ }
  }, 350);
}

async function scanStartZXing(video, hint) {
  try {
    await loadZXing();
  } catch (err) {
    hint.textContent = 'Could not load the barcode decoder — check the connection and try again.';
    return;
  }
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E
  ]);
  zxingReader = new ZXing.BrowserMultiFormatReader(hints);
  try {
    await zxingReader.decodeFromConstraints(
      { video: { facingMode: 'environment' } },
      video,
      (result) => { if (result) onScanHit(result.getText()); }
    );
  } catch (err) {
    console.error(err);
    hint.textContent = 'Camera access was denied — allow it in the browser settings to scan.';
  }
}

function scanStart() {
  const overlay = document.getElementById('scanOverlay');
  const video = document.getElementById('scanVideo');
  const hint = document.getElementById('scanHint');
  overlay.classList.add('open');
  hint.textContent = 'Point the camera at a barcode';
  if ('BarcodeDetector' in window) scanStartNative(video, hint);
  else scanStartZXing(video, hint);
}

const scanBtn = document.getElementById('scanBarcodeBtn');
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  scanBtn.style.display = '';
  scanBtn.addEventListener('click', scanStart);
}
document.getElementById('scanCancelBtn').addEventListener('click', scanStop);
