// stock.js — Dashboard + inventory list.
import { store, bus, categories } from '../../store.js';
import { h, clear, debounce, fmtNum } from '../dom.js';
import { icon } from '../icons.js';
import { openProductDetail, openProductForm, openMovementSheet, statusPill } from '../sheets.js';
import { toAsciiDigits } from '../../domain.js';

const PAGE = 100;
const FILTERS = [['all', 'الكل'], ['low', 'النواقص'], ['expiring', 'قرب الانتهاء'], ['expired', 'منتهي'], ['out', 'نافد']];

export function createStockScreen(root) {
  const f = { q: '', cat: 'all', flt: 'all', limit: PAGE };
  const stats = h('div', { class: 'stats' });
  const input = h('input', { class: 'field', type: 'search', placeholder: 'ابحث بالاسم أو الباركود', autocomplete: 'off', 'aria-label': 'بحث في المخزون' });
  const fltChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'فلتر الحالة' });
  const catChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'فلتر التصنيف' });
  const list = h('div', { class: 'list' });
  const fab = h('button', { class: 'fab', type: 'button', 'aria-label': 'صنف جديد', onclick: () => openProductForm({ onSaved: (p) => openMovementSheet({ product: p, mode: 'in' }) }) }, icon('plus', 30));
  root.append(stats, h('div', { class: 'search' }, icon('search', 20), input), fltChips, catChips, list, fab);
  input.addEventListener('input', debounce(() => { f.q = toAsciiDigits(input.value).trim().toLowerCase(); f.limit = PAGE; renderList(); }, 120));

  const match = (it) => {
    if (f.cat !== 'all' && it.product.category !== f.cat) return false;
    if (f.q && !(it.product.name.toLowerCase().includes(f.q) || it.product.barcodes.some((c) => c.includes(f.q)))) return false;
    switch (f.flt) {
      case 'low': return it.low;
      case 'expiring': return ['expired', 'critical', 'soon'].includes(it.expiry.status);
      case 'expired': return it.expiry.status === 'expired';
      case 'out': return it.out;
      default: return true;
    }
  };
  const severity = (it) => (it.expiry.status === 'expired' ? 0 : it.low ? 1 : it.expiry.status === 'critical' ? 2 : it.expiry.status === 'soon' ? 3 : 4);

  function renderStats() {
    const s = store.summary;
    clear(stats);
    const card = (value, label, cls, onclick, pressed) => h('button', { class: `stat ${cls}`, type: 'button', 'aria-pressed': String(!!pressed), onclick }, h('b', { class: 'num', text: fmtNum(value) }), h('span', { text: label }));
    stats.append(
      card(s.cartons, 'إجمالي الكراتين', '', () => setFilter('all'), false),
      card(s.products, 'عدد الأصناف', '', () => setFilter('all'), false),
      card(s.low, 'نواقص (تحت حد الطلب)', s.low ? 'alert' : '', () => setFilter('low'), f.flt === 'low'),
      card(s.expiring, 'صلاحية قريبة / منتهية', s.expired ? 'alert' : s.expiring ? 'warn' : '', () => setFilter('expiring'), f.flt === 'expiring'));
  }
  function setFilter(v) { f.flt = v; f.limit = PAGE; renderAll(); }

  function renderChips() {
    clear(fltChips); clear(catChips);
    for (const [k, label] of FILTERS) fltChips.append(h('button', { class: 'chip', type: 'button', text: label, 'aria-pressed': String(f.flt === k), onclick: () => setFilter(k) }));
    const present = new Set(store.items.map((i) => i.product.category));
    const cats = categories().filter((c) => present.has(c));
    if (cats.length > 1) {
      catChips.append(h('button', { class: 'chip', type: 'button', text: 'كل التصنيفات', 'aria-pressed': String(f.cat === 'all'), onclick: () => { f.cat = 'all'; f.limit = PAGE; renderAll(); } }));
      for (const c of cats) catChips.append(h('button', { class: 'chip', type: 'button', text: c, 'aria-pressed': String(f.cat === c), onclick: () => { f.cat = c; f.limit = PAGE; renderAll(); } }));
    }
  }

  function renderList() {
    clear(list);
    if (!store.loaded) { list.append(h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })); return; }
    const items = store.items.filter(match).sort((a, b) => severity(a) - severity(b) || a.product.name.localeCompare(b.product.name, 'ar'));
    if (!items.length) {
      list.append(store.items.length
        ? h('div', { class: 'empty' }, h('h3', { text: 'مفيش أصناف بالفلتر ده' }), h('p', { text: 'غيّر الفلتر أو امسح البحث.' }))
        : h('div', { class: 'empty' }, h('h3', { text: 'المخزن فاضي' }), h('p', { text: 'امسح أول باركود أو دوس + لإضافة صنف.' })));
      return;
    }
    for (const it of items.slice(0, f.limit)) {
      const cls = it.expiry.status === 'expired' ? 'l-expired' : it.low ? 'l-low' : it.expiry.status === 'critical' ? 'l-critical' : it.expiry.status === 'soon' ? 'l-soon' : '';
      list.append(h('button', { class: `row ${cls}`, type: 'button', onclick: () => openProductDetail(it.product.id) },
        h('div', { class: 'r-main' },
          h('div', { class: 'r-name', text: it.product.name }),
          h('div', { class: 'r-sub' }, h('span', { text: it.product.category }), h('span', { class: 'ltr', text: it.product.barcode }),
            it.low ? h('span', { class: 'pill low', text: `ناقص (الحد ${fmtNum(it.product.minStock)})` }) : null,
            it.out && !it.low ? h('span', { class: 'pill out', text: 'نافد' }) : null,
            statusPill(it.expiry.status, it.expiry.daysLeft))),
        h('div', { class: `r-qty ${it.low || it.out ? 'low' : ''}` }, h('span', { class: 'num', text: fmtNum(it.stock) }), h('small', { text: 'كرتونة' }))));
    }
    if (items.length > f.limit) list.append(h('button', { class: 'btn btn-ghost more-btn', type: 'button', text: `عرض المزيد (${fmtNum(items.length - f.limit)})`, onclick: () => { f.limit += PAGE; renderList(); } }));
  }

  function renderAll() { renderStats(); renderChips(); renderList(); }
  bus.addEventListener('changed', renderAll);
  renderAll();

  return {
    onShow(opts = {}) { if (opts.filter) { f.flt = opts.filter; f.limit = PAGE; } renderAll(); },
    onHide() {},
  };
}
