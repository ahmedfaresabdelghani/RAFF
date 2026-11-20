// dom.js — tiny DOM toolkit. The whole UI is built with createElement/textContent:
// there is NO innerHTML / insertAdjacentHTML / document.write anywhere (checked by tests/security-lint.mjs).

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.append(c);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ------------------------------------------------------------- format */

const pad = (n) => String(n).padStart(2, '0');
export const fmtNum = (n) => (n == null ? '' : new Intl.NumberFormat('en-US').format(n));
export function fmtDate(s) { // 'YYYY-MM-DD' -> 'DD/MM/YYYY'
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
export function fmtTime(iso) {
  const d = new Date(iso);
  let hh = d.getHours();
  const ap = hh >= 12 ? 'م' : 'ص';
  hh = hh % 12 || 12;
  return `${hh}:${pad(d.getMinutes())} ${ap}`;
}
export function fmtDayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function daysLabel(daysLeft) {
  if (daysLeft == null) return '';
  if (daysLeft < 0) return `منتهي من ${fmtNum(-daysLeft)} يوم`;
  if (daysLeft === 0) return 'ينتهي اليوم';
  if (daysLeft === 1) return 'ينتهي بكرة';
  return `باقي ${fmtNum(daysLeft)} يوم`;
}

/* -------------------------------------------------------------- sheets */

const sheetStack = [];
let sentinel = false;
let ignorePop = false;

function syncHistory() {
  if (sheetStack.length && !sentinel) {
    history.pushState({ raffSheet: true }, '');
    sentinel = true;
  } else if (!sheetStack.length && sentinel) {
    // deferred: a new sheet may open right after this one closes
    setTimeout(() => {
      if (!sheetStack.length && sentinel) { sentinel = false; ignorePop = true; history.back(); }
    }, 0);
  }
}

window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  if (sheetStack.length) {
    sentinel = false;
    sheetStack[sheetStack.length - 1].close({ fromPop: true });
    if (sheetStack.length) { history.pushState({ raffSheet: true }, ''); sentinel = true; }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetStack.length) sheetStack[sheetStack.length - 1].close();
});

export const hasOpenSheet = () => sheetStack.length > 0;

export function openSheet({ title, build, tone = '', full = false, onClose }) {
  const root = document.getElementById('sheets');
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const body = h('div', { class: 'sheet-body' });
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إغلاق' });
  const sheet = h('section', {
    class: `sheet ${tone} ${full ? 'full' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
  }, h('header', { class: 'sheet-head' }, h('h2', { text: title }), closeBtn), body);
  let closed = false;
  const api = {
    el: sheet, body,
    close(opts = {}) {
      if (closed) return;
      closed = true;
      const i = sheetStack.indexOf(api);
      if (i >= 0) sheetStack.splice(i, 1);
      sheet.classList.add('leaving'); backdrop.classList.add('leaving');
      setTimeout(() => { sheet.remove(); backdrop.remove(); }, 180);
      if (!opts.fromPop) syncHistory();
      if (onClose) onClose();
    },
  };
  closeBtn.addEventListener('click', () => api.close());
  backdrop.addEventListener('click', () => api.close());
  closeBtn.append(iconNode('x'));
  root.append(backdrop, sheet);
  sheetStack.push(api);
  syncHistory();
  build(body, api);
  requestAnimationFrame(() => sheet.classList.add('open'));
  return api;
}

let iconNode = () => document.createTextNode('×');
export function setIconFactory(fn) { iconNode = fn; }

export function confirmDialog({ title, message, okLabel = 'تأكيد', danger = false, typed = null }) {
  return new Promise((resolve) => {
    let decided = false;
    const done = (v, api) => { if (decided) return; decided = true; resolve(v); api.close(); };
    openSheet({
      title, tone: danger ? 'danger' : '',
      onClose: () => { if (!decided) { decided = true; resolve(false); } },
      build(body, api) {
        const input = typed ? h('input', { class: 'field', inputmode: 'text', autocomplete: 'off', placeholder: `اكتب: ${typed}`, 'aria-label': 'تأكيد بالكتابة' }) : null;
        const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'} btn-lg`, type: 'button', text: okLabel, disabled: typed ? true : null, onclick: () => done(true, api) });
        if (input) input.addEventListener('input', () => { ok.disabled = input.value.trim() !== typed; });
        append(body, [
          h('p', { class: 'sheet-msg', text: message }), input,
          h('div', { class: 'btn-row' }, ok, h('button', { class: 'btn btn-ghost btn-lg', type: 'button', text: 'إلغاء', onclick: () => done(false, api) })),
        ]);
      },
    });
  });
}

/* --------------------------------------------------------------- toast */

let toastTimer = null;
export function toast(message, { kind = 'info', action = null, ms = 5000 } = {}) {
  const host = document.getElementById('toast');
  clear(host);
  clearTimeout(toastTimer);
  const box = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, h('span', { class: 'toast-msg', text: message }));
  if (action) {
    box.append(h('button', {
      class: 'toast-action', type: 'button', text: action.label,
      onclick: () => { clear(host); clearTimeout(toastTimer); action.fn(); },
    }));
  }
  box.addEventListener('click', (e) => { if (!e.target.closest('.toast-action')) { clear(host); clearTimeout(toastTimer); } });
  host.append(box);
  requestAnimationFrame(() => box.classList.add('show'));
  toastTimer = setTimeout(() => { box.classList.remove('show'); setTimeout(() => { if (box.parentNode === host) clear(host); }, 200); }, kind === 'error' ? Math.max(ms, 6000) : ms);
}
