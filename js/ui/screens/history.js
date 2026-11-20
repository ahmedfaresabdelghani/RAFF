// history.js — audit log.
import { listMovements, getLastMovement } from '../../services.js';
import { MOVEMENT_LABEL } from '../../domain.js';
import { bus } from '../../store.js';
import { undoAction, reportError } from '../../actions.js';
import { h, clear, toast, confirmDialog, fmtDayKey, fmtDate, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { movementRow } from '../sheets.js';

const TYPES = [['all', 'الكل'], ['in', 'وارد'], ['out', 'منصرف'], ['damaged', 'هالك'], ['adjust', 'تسوية']];

export function createHistoryScreen(root) {
  const f = { type: 'all', q: '', limit: 100 };
  let all = [];
  let active = false;
  let dirty = true;
  const undoBtn = h('button', { class: 'btn btn-ghost btn-lg', type: 'button', onclick: undo }, icon('undo', 20), 'تراجع عن آخر حركة');
  const input = h('input', { class: 'field', type: 'search', placeholder: 'بحث باسم الصنف أو الموظف', autocomplete: 'off', 'aria-label': 'بحث في السجل' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'نوع الحركة' });
  const list = h('div');
  root.append(undoBtn, h('div', { class: 'search' }, icon('search', 20), input), chips, list);
  input.addEventListener('input', debounce(() => { f.q = input.value.trim().toLowerCase(); f.limit = 100; render(); }, 120));

  async function undo() {
    let m;
    try { m = await getLastMovement(); } catch (e) { toast(reportError(e), { kind: 'error' }); return; }
    if (!m) { toast('مفيش حركات للتراجع عنها'); return; }
    const ok = await confirmDialog({ title: 'تراجع عن آخر حركة', message: `${MOVEMENT_LABEL[m.type]} ${Math.abs(m.delta)} كرتونة من "${m.productName}". هتتلغى والرصيد هيرجع زي ما كان.`, okLabel: 'تراجع', danger: true });
    if (ok) await undoAction(m.id);
  }

  async function load() {
    dirty = false;
    try { all = await listMovements({ limit: 1500 }); } catch (e) { toast(reportError(e), { kind: 'error' }); }
    render();
  }

  function render() {
    clear(chips); clear(list);
    for (const [k, label] of TYPES) chips.append(h('button', { class: 'chip', type: 'button', text: label, 'aria-pressed': String(f.type === k), onclick: () => { f.type = k; f.limit = 100; render(); } }));
    const rows = all.filter((m) => (f.type === 'all' || m.type === f.type) && (!f.q || m.productName.toLowerCase().includes(f.q) || (m.user || '').toLowerCase().includes(f.q)));
    undoBtn.disabled = !all.some((m) => !m.undone);
    if (!rows.length) { list.append(h('div', { class: 'empty' }, h('h3', { text: all.length ? 'مفيش حركات بالفلتر ده' : 'مفيش حركات لسه' }), h('p', { text: 'كل وارد ومنصرف وهالك هيتسجل هنا بالوقت واسم الموظف.' }))); return; }
    let day = '';
    const today = fmtDayKey(new Date().toISOString());
    for (const m of rows.slice(0, f.limit)) {
      const key = fmtDayKey(m.ts);
      if (key !== day) { day = key; list.append(h('div', { class: 'day-head', text: key === today ? 'النهاردة' : fmtDate(key) })); }
      list.append(h('div', { class: 'list' }, movementRow(m, { showName: true })));
    }
    if (rows.length > f.limit) list.append(h('button', { class: 'btn btn-ghost more-btn', type: 'button', text: 'عرض المزيد', onclick: () => { f.limit += 100; render(); } }));
  }

  bus.addEventListener('changed', () => { if (active) load(); else dirty = true; });
  return { onShow() { active = true; if (dirty || !all.length) load(); else render(); }, onHide() { active = false; } };
}
