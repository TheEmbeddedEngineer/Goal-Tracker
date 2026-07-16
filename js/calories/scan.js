import { calApplyScannedProduct } from './log.js';

/* Barcode scanning for food logging: live camera preview + the browser's native
   BarcodeDetector, then an Open Food Facts lookup prefills the log form with the
   product's per-100g values. The scan button only appears when the browser supports
   both the camera and BarcodeDetector (iOS Safari 17+, Chrome); everything else in
   the app works without it. Open Food Facts is a free, CORS-enabled public API —
   no key, nothing to keep secret. */

let scanStream = null;
let scanTimer = null;

function scanStop() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
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

async function scanStart() {
  const overlay = document.getElementById('scanOverlay');
  const video = document.getElementById('scanVideo');
  const hint = document.getElementById('scanHint');
  overlay.classList.add('open');
  hint.textContent = 'Point the camera at a barcode';
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (err) {
    hint.textContent = 'Camera access was denied — allow it in the browser settings to scan.';
    return;
  }
  video.srcObject = scanStream;
  try { await video.play(); } catch (err) {}
  let detector;
  try {
    detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
  } catch (err) {
    scanStop();
    document.getElementById('bankStatus').textContent = 'Barcode detection isn’t supported in this browser.';
    return;
  }
  scanTimer = setInterval(async () => {
    if (!scanStream) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length > 0 && codes[0].rawValue) {
        const code = codes[0].rawValue;
        scanStop();
        await scanLookup(code);
      }
    } catch (err) { /* frames early in the stream can throw — keep polling */ }
  }, 350);
}

const scanBtn = document.getElementById('scanBarcodeBtn');
if ('BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  scanBtn.style.display = '';
  scanBtn.addEventListener('click', scanStart);
}
document.getElementById('scanCancelBtn').addEventListener('click', scanStop);
