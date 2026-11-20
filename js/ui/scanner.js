// scanner.js — thin wrapper over html5-qrcode (vendored, loaded by index.html).
// Handles: rear camera, formats, torch, zoom, duplicate-read debounce, screen wake lock,
// and stopping the camera when the tab/app goes to the background.

const FORMAT_NAMES = ['EAN_13', 'ITF', 'UPC_A', 'CODE_128', 'EAN_8', 'UPC_E', 'CODE_39'];

export function scannerSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.Html5Qrcode);
}

export class Scanner {
  constructor(containerId, onCode) {
    this.containerId = containerId;
    this.onCode = onCode;
    this.engine = null;
    this.running = false;
    this.starting = false;
    this.torchOn = false;
    this.lastCode = '';
    this.lastAt = 0;
    this.wake = null;
    this.caps = { torch: null, zoom: null };
    this._vis = () => { if (document.hidden && this.running) this.stop(); };
  }

  async start() {
    if (this.running || this.starting) return;
    if (!scannerSupported()) throw new Error('unsupported');
    this.starting = true;
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = window;
      this.engine = new Html5Qrcode(this.containerId, {
        formatsToSupport: FORMAT_NAMES.map((n) => F[n]).filter((v) => v !== undefined),
        useBarCodeDetectorIfSupported: true,
        verbose: false,
      });
      await this.engine.start(
        { facingMode: 'environment' },
        {
          fps: 12,
          disableFlip: true,
          qrbox: (w, hgt) => ({ width: Math.max(120, Math.floor(w * 0.88)), height: Math.max(80, Math.floor(Math.min(hgt * 0.55, w * 0.5))) }),
          videoConstraints: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 }, height: { ideal: 720 },
          },
        },
        (text) => this._handle(text),
        () => { /* per-frame "no code found" — ignored */ },
      );
      this.running = true;
      this._readCaps();
      this._lockScreen();
      document.addEventListener('visibilitychange', this._vis);
    } catch (err) {
      this.engine = null;
      throw err;
    } finally {
      this.starting = false;
    }
  }

  _handle(text) {
    const now = Date.now();
    if (now - this.lastAt < 500) return;                       // burst of frames
    if (text === this.lastCode && now - this.lastAt < 2500) { this.lastAt = now; return; } // same carton still in view
    this.lastCode = text; this.lastAt = now;
    this.onCode(text);
  }

  // Allow the same barcode again immediately (e.g. after the operator cancelled a sheet).
  resetDebounce() { this.lastCode = ''; this.lastAt = 0; }

  _readCaps() {
    this.caps = { torch: null, zoom: null };
    try {
      const c = this.engine.getRunningTrackCameraCapabilities();
      const torch = c.torchFeature();
      if (torch.isSupported()) this.caps.torch = torch;
      const zoom = c.zoomFeature();
      if (zoom.isSupported()) this.caps.zoom = { feature: zoom, min: zoom.min(), max: zoom.max(), step: zoom.step() || 0.1 };
    } catch { /* capabilities API unavailable (iOS Safari) */ }
  }

  get torchSupported() { return !!this.caps.torch; }
  get zoomSupported() { return !!this.caps.zoom; }

  async setTorch(on) {
    if (!this.caps.torch) return false;
    await this.caps.torch.apply(!!on);
    this.torchOn = !!on;
    return this.torchOn;
  }
  async setZoom(v) { if (this.caps.zoom) await this.caps.zoom.feature.apply(v); }

  async _lockScreen() {
    try { if ('wakeLock' in navigator) this.wake = await navigator.wakeLock.request('screen'); } catch { /* not allowed */ }
  }

  async stop() {
    document.removeEventListener('visibilitychange', this._vis);
    try { if (this.wake) await this.wake.release(); } catch { /* ignore */ }
    this.wake = null;
    const eng = this.engine;
    this.engine = null;
    this.running = false;
    this.torchOn = false;
    this.caps = { torch: null, zoom: null };
    if (eng) {
      try { await eng.stop(); } catch { /* already stopped */ }
      try { eng.clear(); } catch { /* ignore */ }
    }
  }
}

export function cameraErrorMessage(err) {
  const n = err && (err.name || String(err));
  if (/NotAllowed|Permission/i.test(n)) return 'الكاميرا مقفولة. اسمح للتطبيق باستخدام الكاميرا من إعدادات المتصفح ثم أعد المحاولة.';
  if (/NotFound|Devices/i.test(n)) return 'مفيش كاميرا متاحة على الجهاز ده. استخدم البحث اليدوي.';
  if (/NotReadable|TrackStart|Overconstrained/i.test(n)) return 'الكاميرا مشغولة بتطبيق تاني. اقفله وجرّب تاني.';
  if (/unsupported/i.test(n)) return 'المتصفح لا يدعم الكاميرا. استخدم Chrome أو Safari حديث، وتأكد إن الرابط HTTPS.';
  return 'تعذر تشغيل الكاميرا. استخدم البحث اليدوي مؤقتًا.';
}
