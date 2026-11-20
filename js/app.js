// app.js — bootstrap: theme, tabs, service worker, install prompt, badges.
import { getSettings } from './settings.js';
import { store, bus, refresh, alertCounts } from './store.js';
import { loadDemoData } from './demo.js';
import { reportError } from './actions.js';
import { h, $, clear, toast, confirmDialog, fmtNum, setIconFactory } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { unlockAudio } from './ui/feedback.js';
import { createScanScreen } from './ui/screens/scan.js';
import { createStockScreen } from './ui/screens/stock.js';
import { createExpiryScreen } from './ui/screens/expiry.js';
import { createHistoryScreen } from './ui/screens/history.js';
import { createMoreScreen } from './ui/screens/more.js';

const TABS = [
  { id: 'scan', label: 'مسح', icon: 'scan', make: createScanScreen },
  { id: 'stock', label: 'المخزون', icon: 'box', make: createStockScreen },
  { id: 'expiry', label: 'الصلاحية', icon: 'clock', make: createExpiryScreen },
  { id: 'history', label: 'السجل', icon: 'list', make: createHistoryScreen },
  { id: 'more', label: 'المزيد', icon: 'menu', make: createMoreScreen },
];

const ctx = {
  installPrompt: null,
  applyTheme,
  go,
  async install() {
    if (!ctx.installPrompt) return;
    ctx.installPrompt.prompt();
    await ctx.installPrompt.userChoice.catch(() => {});
    ctx.installPrompt = null;
    screens.more.onShow();
  },
  async loadDemo() {
    if (store.items.length) {
      const ok = await confirmDialog({ title: 'بيانات تجريبية', message: 'هتتضاف أصناف تجريبية فوق بياناتك الحالية. الأفضل تجربها على جهاز فاضي. تكمل؟', okLabel: 'أضف' });
      if (!ok) return;
    }
    try {
      const n = await loadDemoData(getSettings().employee || 'عرض تجريبي');
      await refresh();
      toast(`تمت إضافة ${fmtNum(n)} صنف تجريبي`, { kind: 'ok' });
    } catch (e) { toast(reportError(e), { kind: 'error' }); }
  },
};

const screens = {};
const viewEls = {};
const navBtns = {};
let current = null;

function applyTheme() {
  const t = getSettings().theme;
  document.documentElement.setAttribute('data-theme', t);
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#FFFFFF' : '#121A2B');
}

function go(id, opts = {}) {
  if (!TABS.some((t) => t.id === id)) return;
  if (current && current !== id) screens[current].onHide();
  current = id;
  for (const t of TABS) {
    viewEls[t.id].classList.toggle('active', t.id === id);
    navBtns[t.id].setAttribute('aria-selected', String(t.id === id));
  }
  screens[id].onShow(opts);
}

function renderBadges() {
  const a = alertCounts();
  const set = (id, n) => {
    const b = navBtns[id].querySelector('.badge');
    if (b) b.remove();
    if (n > 0) navBtns[id].append(h('span', { class: 'badge', text: n > 99 ? '99+' : fmtNum(n) }));
  };
  set('stock', a.low);
  set('expiry', a.expiryUrgent);
}

function buildShell() {
  const views = $('#views');
  const nav = $('#nav');
  for (const t of TABS) {
    const el = h('section', { class: 'view', id: `view-${t.id}`, role: 'tabpanel', 'aria-label': t.label });
    views.append(el);
    viewEls[t.id] = el;
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'aria-controls': `view-${t.id}`, onclick: () => go(t.id) }, icon(t.icon, 24), h('span', { text: t.label }));
    nav.append(b);
    navBtns[t.id] = b;
  }
  for (const t of TABS) screens[t.id] = t.make(viewEls[t.id], ctx);
  ctx.scan = screens.scan;
}

function netPill() {
  const pill = $('#net');
  const update = () => {
    const on = navigator.onLine;
    pill.classList.toggle('off', !on);
    clear(pill);
    pill.append(h('i'), on ? 'متصل' : 'بدون إنترنت — الشغل شغال عادي');
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function iosHint() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem('raff.iosHint') === '1'; } catch { /* ignore */ }
  if (!ios || standalone || dismissed) return;
  const hint = h('div', { class: 'ios-hint' }, icon('download', 22),
    h('span', { text: 'على iPhone: دوس زر المشاركة ثم "إضافة إلى الشاشة الرئيسية" عشان التطبيق يشتغل أسرع وبياناتك تتحفظ بشكل دائم.' }),
    h('button', { class: 'btn btn-sm', type: 'button', text: 'تمام', onclick: () => { hint.remove(); try { localStorage.setItem('raff.iosHint', '1'); } catch { /* ignore */ } } }));
  $('#view-scan').append(hint);
}

async function boot() {
  applyTheme();
  setIconFactory(() => icon('x'));
  buildShell();
  netPill();
  document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  bus.addEventListener('changed', renderBadges);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ctx.installPrompt = e; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && current === 'scan') screens.scan.onShow(); });

  go('scan');
  try { await refresh(); } catch (e) {
    console.error(e);
    $('#view-scan').prepend(h('div', { class: 'card', role: 'alert' }, h('h3', { text: 'تعذر فتح قاعدة البيانات' }), h('p', { text: reportError(e) })));
  }
  renderBadges();
  iosHint();

  // Ask the browser not to evict our data under storage pressure (important on iOS/Android).
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* ignore */ }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker unavailable', e));
  }
}

boot();
