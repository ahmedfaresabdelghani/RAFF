// expiry.js — what must leave the warehouse first. Groups every batch by urgency.
import { store, bus, expiryList } from '../../store.js';
import { thresholds } from '../../settings.js';
import { expiryText } from '../../csv.js';
import { todayStr } from '../../domain.js';
import { h, clear, fmtNum, fmtDate, daysLabel, toast } from '../dom.js';
import { icon } from '../icons.js';
import { openMovementSheet, statusPill } from '../sheets.js';

const GROUPS = [
  ['expired', 'منتهي الصلاحية — اسحبه فورًا', 'bad'],
  ['critical', 'ينتهي خلال أيام قليلة', 'warn'],
  ['soon', 'صلاحية قريبة', 'warn'],
];

export function createExpiryScreen(root) {
  const head = h('div');
  const body = h('div');
  root.append(head, body);

  function shareText(text) {
    if (!text) return;
    if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  function render() {
    clear(head); clear(body);
    const t = thresholds();
    const rows = expiryList();
    const urgent = rows.filter((r) => r.status !== 'ok');
    head.append(h('div', { class: 'card' },
      h('h2', { text: 'متابعة الصلاحية' }),
      h('p', { class: 'muted', text: `تنبيه قبل ${t.warnDays} يوم، وحرج قبل ${t.critDays} أيام (تتغير من الإعدادات). الصرف بيمشي بنظام الأقدم أولًا.` }),
      urgent.length ? h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => shareText(expiryText(store.items, todayStr(), t)) }, icon('send', 18), 'إرسال واتساب')) : null));

    if (!urgent.length) {
      body.append(h('div', { class: 'empty' }, h('h3', { text: rows.length ? 'كله سليم ✓' : 'مفيش أصناف عليها تاريخ صلاحية' }),
        h('p', { text: rows.length ? `مفيش دفعة هتنتهي خلال ${t.warnDays} يوم.` : 'لما تسجل وارد بتاريخ صلاحية هيظهر هنا.' })));
    }
    for (const [status, title, tone] of GROUPS) {
      const g = urgent.filter((r) => r.status === status);
      if (!g.length) continue;
      const totalQty = g.reduce((n, r) => n + r.batch.qty, 0);
      body.append(h('div', { class: 'section-title' }, icon(status === 'expired' ? 'alert' : 'clock', 20), title, h('span', { class: `pill ${status}`, text: `${fmtNum(totalQty)} كرتونة` })));
      const list = h('div', { class: 'list' });
      for (const r of g) {
        list.append(h('div', { class: `row l-${status}` },
          h('div', { class: 'r-main' },
            h('div', { class: 'r-name', text: r.product.name }),
            h('div', { class: 'r-sub' }, h('span', { text: `تنتهي ${fmtDate(r.batch.expiry)}` }), statusPill(r.status, r.daysLeft) || h('span', { text: daysLabel(r.daysLeft) }), h('span', { text: `دخلت ${fmtDate(r.batch.receivedAt)}` }))),
          h('div', { class: 'r-qty' }, h('span', { class: 'num', text: fmtNum(r.batch.qty) }), h('small', { text: 'كرتونة' })),
          h('div', { class: 'btn-row' },
            status === 'expired' ? null : h('button', { class: 'btn btn-out btn-sm', type: 'button', text: 'للصالة', onclick: () => openMovementSheet({ product: r.product, mode: 'out', batch: r.batch, qty: r.batch.qty }) }),
            h('button', { class: 'btn btn-damaged btn-sm', type: 'button', text: 'هالك', onclick: () => openMovementSheet({ product: r.product, mode: 'damaged', batch: r.batch, qty: r.batch.qty }) }))));
      }
      body.append(list);
    }
    const okRows = rows.filter((r) => r.status === 'ok');
    if (okRows.length) {
      body.append(h('div', { class: 'section-title' }, icon('check', 20), `سليمة (${fmtNum(okRows.length)} دفعة)`));
      const list = h('div', { class: 'list' });
      for (const r of okRows.slice(0, 30)) {
        list.append(h('div', { class: 'row' }, h('div', { class: 'r-main' }, h('div', { class: 'r-name', text: r.product.name }), h('div', { class: 'r-sub', text: `تنتهي ${fmtDate(r.batch.expiry)} · ${daysLabel(r.daysLeft)}` })),
          h('div', { class: 'r-qty' }, h('span', { class: 'num', text: fmtNum(r.batch.qty) }), h('small', { text: 'كرتونة' }))));
      }
      body.append(list);
    }
  }
  bus.addEventListener('changed', render);
  render();
  return { onShow: render, onHide() {} };
}
