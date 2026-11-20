// scan.js — Quick Scan screen (main action).
import { MOVEMENT_LABEL, normalizeBarcode } from '../../domain.js';
import { findProductByBarcode } from '../../services.js';
import { getSettings, saveSettings } from '../../settings.js';
import { store, bus, alertCounts } from '../../store.js';
import { commitMovement, undoAction, reportError } from '../../actions.js';
import { h, clear, toast, hasOpenSheet, fmtNum, fmtTime } from '../dom.js';
import { icon } from '../icons.js';
import { Scanner, scannerSupported, cameraErrorMessage } from '../scanner.js';
import { qtyStepper, openMovementSheet, openProductForm, openSearchSheet } from '../sheets.js';
import * as fb from '../feedback.js';

const MODES = ['in', 'out', 'damaged'];
const CAM_KEY = 'raff.cam';

export function createScanScreen(root, ctx) {
  let mode = 'in';
  let scanner = null;
  let busy = false;
  let last = null;

  const camMsg = h('p', { text: 'وجّه الكاميرا ناحية الباركود. الصوت والاهتزاز هيأكدوا القراءة.' });
  const startBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => startCamera(true) }, icon('camera', 22), 'تشغيل الكاميرا');
  const idle = h('div', { class: 'cam-idle' }, camMsg, startBtn);
  const tag = h('span', { class: 'cam-mode-tag' });
  const torchBtn = h('button', { class: 'icon-btn hidden', type: 'button', 'aria-label': 'كشاف', onclick: toggleTorch }, icon('flash', 24));
  const zoomIn = h('input', { type: 'range', 'aria-label': 'تقريب', min: '1', max: '4', step: '0.1', value: '1' });
  const zoomWrap = h('div', { class: 'zoom-wrap hidden' }, icon('zoom', 20), zoomIn);
  const manualBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: openManual }, icon('keyboard', 20), 'يدوي');
  const stopBtn = h('button', { class: 'icon-btn hidden', type: 'button', 'aria-label': 'إيقاف الكاميرا', onclick: () => stopCamera() }, icon('x', 22));
  const tools = h('div', { class: 'cam-tools' }, torchBtn, zoomWrap, h('span', { class: 'head-spacer' }), manualBtn, stopBtn);
  const cam = h('div', { class: 'cam' }, h('div', { id: 'reader' }), h('div', { class: 'scanline' }), tag, idle, tools);

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'نوع الحركة' },
    MODES.map((m) => h('button', { class: `m-${m}`, type: 'button', text: MOVEMENT_LABEL[m], 'aria-pressed': String(m === mode), onclick: () => setMode(m) })));

  const qty = qtyStepper(1);
  const chips = h('div', { class: 'quick-qty' }, [6, 12, 24, 50].map((n) => h('button', { class: 'chip', type: 'button', text: `${n}`, onclick: () => qty.set(n) })));
  const instant = h('input', { type: 'checkbox', 'aria-label': 'تسجيل فوري' });
  instant.checked = getSettings().instant;
  instant.addEventListener('change', () => saveSettings({ instant: instant.checked }));
  const instantRow = h('label', { class: 'toggle-row' },
    h('span', {}, 'تسجيل فوري', h('small', { text: 'يسجل بمجرد المسح بدون شاشة تأكيد (الكمية ترجع 1 بعدها)' })),
    h('span', { class: 'switch' }, instant, h('span')));
  const lastBox = h('div', { class: 'card last-scan hidden' });
  const alertBox = h('div', { class: 'alert-strip hidden' });
  const welcome = h('div', { class: 'card welcome hidden' });

  root.classList.add('scan-view');
  root.append(alertBox, seg, cam, h('label', { class: 'sr', text: 'عدد الكراتين' }), qty.el, chips, instantRow, lastBox, welcome);
  setMode('in');

  /* ---- mode */
  function setMode(m) {
    mode = m;
    [...seg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(MODES[i] === m)));
    root.classList.remove('mode-in', 'mode-out', 'mode-damaged');
    root.classList.add(`mode-${m}`);
    tag.textContent = MOVEMENT_LABEL[m];
  }

  /* ---- camera */
  async function startCamera(userTap) {
    fb.unlockAudio();
    if (scanner && (scanner.running || scanner.starting)) return;
    if (!scannerSupported()) { camMsg.textContent = cameraErrorMessage({ name: 'unsupported' }); return; }
    startBtn.disabled = true;
    scanner = new Scanner('reader', onCode);
    try {
      await scanner.start();
      try { localStorage.setItem(CAM_KEY, '1'); } catch { /* ignore */ }
      idle.classList.add('hidden'); cam.classList.add('live'); stopBtn.classList.remove('hidden');
      torchBtn.classList.toggle('hidden', !scanner.torchSupported);
      if (scanner.zoomSupported) {
        const z = scanner.caps.zoom; zoomIn.min = String(z.min); zoomIn.max = String(Math.min(z.max, 5)); zoomIn.step = String(z.step); zoomIn.value = String(z.min);
        zoomWrap.classList.remove('hidden');
      }
    } catch (e) {
      scanner = null;
      camMsg.textContent = cameraErrorMessage(e);
      if (userTap) toast(cameraErrorMessage(e), { kind: 'error' });
    } finally { startBtn.disabled = false; }
  }
  async function stopCamera() {
    if (scanner) { await scanner.stop(); scanner = null; }
    cam.classList.remove('live'); idle.classList.remove('hidden');
    torchBtn.classList.add('hidden'); torchBtn.classList.remove('on'); zoomWrap.classList.add('hidden'); stopBtn.classList.add('hidden');
    camMsg.textContent = 'الكاميرا واقفة لتوفير البطارية.';
  }
  async function toggleTorch() {
    if (!scanner) return;
    try { const on = await scanner.setTorch(!scanner.torchOn); torchBtn.classList.toggle('on', on); } catch { toast('الكشاف غير متاح على الجهاز ده', { kind: 'warn' }); }
  }
  zoomIn.addEventListener('input', () => { if (scanner) scanner.setZoom(Number(zoomIn.value)).catch(() => {}); });

  /* ---- scan handling */
  async function onCode(raw) {
    if (busy || hasOpenSheet()) return;
    busy = true;
    try { await handleCode(raw); } finally { busy = false; }
  }

  async function handleCode(raw) {
    let code;
    try { code = normalizeBarcode(raw); } catch { fb.error(); return; }
    let product;
    try { product = await findProductByBarcode(code); } catch (e) { fb.error(); toast(reportError(e), { kind: 'error' }); return; }
    if (!product) {
      fb.unknown();
      openProductForm({
        barcode: code,
        onSaved: (p) => openMovementSheet({ product: p, mode: 'in', qty: qty.get(), onDone: afterDone }),
      });
      return;
    }
    fb.ok();
    await actOn(product);
  }

  async function actOn(product) {
    const q = Math.max(1, qty.get());
    if (instant.checked) {
      const res = await commitMovement({ productId: product.id, type: mode, qty: q });
      if (res) afterDone(res);
      return;
    }
    openMovementSheet({ product, mode, qty: q, onDone: afterDone });
  }

  function afterDone(res) {
    last = res.movement;
    qty.set(1);
    renderLast(); renderAlerts();
  }

  function openManual() {
    openSearchSheet({
      title: 'بحث يدوي',
      onPick: (p, sheet) => { sheet.close(); actOn(p); },
      onNewBarcode: (code, sheet) => { sheet.close(); openProductForm({ barcode: code, onSaved: (p) => openMovementSheet({ product: p, mode: 'in', qty: qty.get(), onDone: afterDone }) }); },
    });
  }

  /* ---- renderers */
  function renderLast() {
    if (!last) { lastBox.classList.add('hidden'); return; }
    clear(lastBox); lastBox.classList.remove('hidden');
    const pos = last.delta > 0;
    lastBox.append(
      h('div', { class: 'ls-main' }, h('div', { class: 'ls-name', text: last.productName }),
        h('div', { class: 'muted', text: `${MOVEMENT_LABEL[last.type]} · ${fmtTime(last.ts)} · الرصيد ${fmtNum(last.balanceAfter)}` })),
      h('b', { class: `mv-q num ${pos ? 'pos' : 'neg'}`, text: `${pos ? '+' : '−'}${fmtNum(last.qty)}` }),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { if (await undoAction(last.id)) { last = null; renderLast(); } } }, icon('undo', 18), 'تراجع'));
  }

  function renderAlerts() {
    clear(alertBox);
    const a = alertCounts();
    alertBox.classList.toggle('hidden', !(a.low || a.expiryAll));
    if (a.low) alertBox.append(h('button', { class: 'a-low', type: 'button', onclick: () => ctx.go('stock', { filter: 'low' }) }, icon('alert', 18), `${fmtNum(a.low)} ناقص`));
    if (a.expiryAll) alertBox.append(h('button', { class: 'a-exp', type: 'button', onclick: () => ctx.go('expiry') }, icon('clock', 18), `${fmtNum(a.expiryAll)} صلاحية`));
  }

  function renderWelcome() {
    clear(welcome);
    const empty = store.loaded && store.items.length === 0;
    welcome.classList.toggle('hidden', !empty);
    if (!empty) return;
    welcome.append(h('h2', { text: 'أهلًا بيك في رفّ 👋' }),
      h('div', { class: 'steps' },
        h('div', {}, h('b', { text: '1' }), 'اختار نوع الحركة (وارد / منصرف / هالك)'),
        h('div', {}, h('b', { text: '2' }), 'امسح باركود الكرتونة — أول مرة هيطلب بيانات الصنف'),
        h('div', {}, h('b', { text: '3' }), 'اكتب العدد لو أكتر من كرتونة وأكّد')),
      h('button', { class: 'btn btn-ghost btn-lg', type: 'button', onclick: () => ctx.loadDemo() }, 'جرّب ببيانات تجريبية'));
  }

  bus.addEventListener('changed', () => { renderAlerts(); renderWelcome(); });
  renderAlerts(); renderWelcome();

  return {
    onShow() {
      let remembered = false;
      try { remembered = localStorage.getItem(CAM_KEY) === '1'; } catch { /* ignore */ }
      if (remembered && !hasOpenSheet()) startCamera(false);
    },
    onHide() { stopCamera(); },
    pause() { return stopCamera(); },
    resume() { return startCamera(false); },
    isRunning: () => !!(scanner && scanner.running),
    setMode,
  };
}
