// sheets.js — bottom sheets: movement (qty + expiry), product form, product detail, search.
import {
  MOVEMENT_LABEL, LIMITS, toAsciiDigits, todayStr, isValidDateStr, computeExpiry,
  validateShelfLife, classifyExpiry, allocateFefo,
} from '../domain.js';
import {
  createProduct, updateProduct, addBarcode, removeBarcode, deleteProduct, getProductBatches, listMovements,
} from '../services.js';
import { getSettings, thresholds } from '../settings.js';
import { store, refresh, categories, itemById } from '../store.js';
import { commitMovement, reportError } from '../actions.js';
import { h, append, clear, openSheet, confirmDialog, toast, fmtNum, fmtDate, fmtTime, daysLabel, debounce } from './dom.js';
import { icon } from './icons.js';
import * as fb from './feedback.js';

const MODES = ['in', 'out', 'damaged'];
const UNIT_LABEL = { d: 'يوم', m: 'شهر', y: 'سنة' };
const SHELF_CHIPS = [['شهر', 1, 'm'], ['3 شهور', 3, 'm'], ['6 شهور', 6, 'm'], ['سنة', 1, 'y'], ['سنتين', 2, 'y']];
const QTY_CHIPS = [6, 12, 24, 50, 100];

export const statusPill = (status, daysLeft) =>
  status === 'none' || status === 'ok' ? null : h('span', { class: `pill ${status}`, text: daysLabel(daysLeft) });

const digitsOnly = (input, max = 6) => input.addEventListener('input', () => {
  const v = toAsciiDigits(input.value).replace(/\D/g, '').slice(0, max);
  if (v !== input.value) input.value = v;
});

/* ----------------------------------------------------- qty stepper */

export function qtyStepper(initial = 1, onChange = () => {}) {
  const input = h('input', { class: 'field num-in', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', 'aria-label': 'الكمية', value: String(initial) });
  digitsOnly(input);
  const get = () => { const n = parseInt(toAsciiDigits(input.value), 10); return Number.isFinite(n) ? n : 0; };
  const set = (n) => { input.value = String(Math.max(1, Math.min(LIMITS.qtyMax, n))); onChange(get()); };
  const plus = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'زيادة', onclick: () => set(get() + 1) }, icon('plus', 28));
  const minus = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'نقص', onclick: () => set(get() - 1) }, icon('minus', 28));
  input.addEventListener('input', () => onChange(get()));
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', () => { if (get() < 1) set(1); });
  return { el: h('div', { class: 'stepper' }, plus, input, minus), input, get, set };
}

/* --------------------------------------------------- movement sheet */

export async function openMovementSheet({ product, mode = 'in', qty = 1, batch = null, onDone }) {
  const settings = getSettings();
  let batches = [];
  try { batches = await getProductBatches(product.id); } catch (e) { toast(reportError(e), { kind: 'error' }); return null; }
  const stock = batches.reduce((n, b) => n + b.qty, 0);
  const st = { mode, manualDate: null };
  let armed = false; let armTimer = null; let busy = false;

  return openSheet({
    title: product.name, tone: `tone-${mode}`,
    build(body, api) {
      const stepper = qtyStepper(Math.max(1, qty), () => { disarm(); renderDynamic(); });
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'نوع الحركة' });
      const dyn = h('div');
      const err = h('p', { class: 'hint bad hidden', role: 'alert' });
      const confirmBtn = h('button', { class: 'btn btn-lg big-confirm', type: 'button', onclick: () => confirm() });

      const next = batches.find((b) => b.expiry);
      const nextInfo = next ? classifyExpiry(next.expiry, todayStr(), thresholds()) : null;
      const info = h('div', { class: 'pinfo' },
        h('div', { class: 'r-main' },
          h('p', { class: 'muted', text: product.category }),
          h('div', { class: 'r-sub' },
            h('span', { class: 'ltr', text: product.barcode }),
            nextInfo ? statusPill(nextInfo.status, nextInfo.daysLeft) : null,
            nextInfo && (nextInfo.status === 'ok') ? h('span', { text: `أقرب صلاحية ${fmtDate(next.expiry)}` }) : null)),
        h('div', { class: 'p-stock' }, h('b', { class: 'num', text: fmtNum(stock) }), h('small', { text: 'الرصيد' })));

      for (const m of MODES) {
        seg.append(h('button', { class: `m-${m}`, type: 'button', 'aria-pressed': String(m === st.mode), text: MOVEMENT_LABEL[m], onclick: () => setMode(m) }));
      }
      const chips = h('div', { class: 'chips' }, QTY_CHIPS.map((n) => h('button', { class: 'chip', type: 'button', text: `${n}`, onclick: () => stepper.set(n) })));

      append(body, [info, seg, h('label', { class: 'lbl', text: 'عدد الكراتين' }), stepper.el, chips, dyn, err,
        h('div', { class: 'btn-row' }, confirmBtn)]);
      stepper.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });

      function setMode(m) {
        st.mode = m; disarm();
        api.el.classList.remove(...MODES.map((x) => `tone-${x}`)); api.el.classList.add(`tone-${m}`);
        [...seg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(MODES[i] === m)));
        renderDynamic();
      }
      function disarm() {
        armed = false; clearTimeout(armTimer); confirmBtn.classList.remove('armed'); updateLabel();
      }
      function updateLabel() {
        const q = stepper.get();
        confirmBtn.className = `btn btn-lg big-confirm btn-${st.mode}${armed ? ' armed' : ''}`;
        confirmBtn.textContent = armed ? `اضغط تاني للتأكيد — ${fmtNum(q)} كرتونة` : `تأكيد ${MOVEMENT_LABEL[st.mode]} · ${fmtNum(Math.max(q, 0))}`;
      }

      // ---- expiry editor (only for stock-in)
      let expiryEl = null;
      function buildExpiry() {
        const e = { on: !!product.shelfLife };
        const received = h('input', { class: 'field', type: 'date', value: todayStr(), max: todayStr(), 'aria-label': 'تاريخ الدخول' });
        const dur = h('input', { class: 'field num-in', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', placeholder: 'المدة', value: product.shelfLife ? String(product.shelfLife.value) : '', 'aria-label': 'مدة الصلاحية' });
        digitsOnly(dur, 4);
        const unit = h('select', { class: 'field', 'aria-label': 'وحدة المدة' }, Object.entries(UNIT_LABEL).map(([k, v]) => h('option', { value: k, text: v })));
        unit.value = product.shelfLife ? product.shelfLife.unit : 'm';
        const expIn = h('input', { class: 'field', type: 'date', 'aria-label': 'تاريخ الانتهاء', min: todayStr() });
        const hint = h('p', { class: 'hint' });
        const autoBtn = h('button', { class: 'btn btn-ghost btn-sm hidden', type: 'button', text: 'احسبه تلقائي من المدة', onclick: () => { st.manualDate = null; dur.focus(); recompute(); } });
        const toggle = h('button', { class: 'btn btn-ghost btn-lg', type: 'button', onclick: () => { e.on = !e.on; sync(); } });
        const fields = h('div', {},
          h('label', { class: 'lbl', text: 'تاريخ دخول الصنف' }), received,
          h('label', { class: 'lbl', text: 'مدة الصلاحية' }),
          h('div', { class: 'dur-row' }, dur, unit),
          h('div', { class: 'chips' }, SHELF_CHIPS.map(([label, v, u]) => h('button', { class: 'chip', type: 'button', text: label, onclick: () => { dur.value = String(v); unit.value = u; st.manualDate = null; recompute(); } }))),
          h('label', { class: 'lbl', text: 'تاريخ الانتهاء (يتحسب لوحده — أو اكتبه بإيدك)' }), expIn, hint, autoBtn);

        const currentShelf = () => {
          const n = parseInt(toAsciiDigits(dur.value), 10);
          if (!(n > 0)) return null;
          try { return validateShelfLife({ value: n, unit: unit.value }); } catch { return null; }
        };
        function recompute() {
          const sh = currentShelf();
          const rec = isValidDateStr(received.value) ? received.value : todayStr();
          if (!st.manualDate && sh) expIn.value = computeExpiry(rec, sh);
          if (!st.manualDate && !sh) expIn.value = '';
          const date = st.manualDate || expIn.value || null;
          autoBtn.classList.toggle('hidden', !(st.manualDate && sh));
          if (!date) { hint.className = 'hint'; hint.textContent = 'اختياري — سيبه فاضي لو الصنف مالوش صلاحية.'; return; }
          const c = classifyExpiry(date, todayStr(), thresholds());
          hint.className = `hint ${c.status === 'expired' || c.status === 'critical' ? 'bad' : c.status === 'ok' ? 'good' : ''}`;
          hint.textContent = `ينتهي ${fmtDate(date)} — ${daysLabel(c.daysLeft)}${st.manualDate ? ' (مكتوب يدويًا)' : ''}`;
        }
        function sync() {
          fields.classList.toggle('hidden', !e.on);
          toggle.classList.toggle('hidden', e.on);
          toggle.textContent = '+ إضافة تاريخ صلاحية';
          if (e.on) recompute();
        }
        received.addEventListener('change', recompute);
        dur.addEventListener('input', () => { st.manualDate = null; recompute(); });
        unit.addEventListener('change', () => { st.manualDate = null; recompute(); });
        expIn.addEventListener('change', () => { st.manualDate = isValidDateStr(expIn.value) ? expIn.value : null; recompute(); });
        sync();
        const box = h('div', { class: 'expiry-box' }, h('h4', {}, icon('clock', 20), 'الصلاحية'), toggle, fields);
        box.collect = () => {
          if (!e.on) return {};
          const out = { receivedAt: isValidDateStr(received.value) ? received.value : todayStr() };
          if (st.manualDate) out.expiryDate = st.manualDate;
          else { const sh = currentShelf(); if (sh) out.shelfLife = sh; }
          return out;
        };
        return box;
      }

      function renderDynamic() {
        clear(dyn);
        updateLabel();
        const q = stepper.get();
        if (st.mode === 'in') {
          if (!expiryEl) expiryEl = buildExpiry();
          dyn.append(expiryEl);
          return;
        }
        let lines = [];
        const pool = batch ? batches.filter((b) => b.id === batch.id) : batches;
        const avail = pool.reduce((n, b) => n + b.qty, 0);
        if (q > avail) {
          dyn.append(h('p', { class: 'hint bad', text: `الرصيد المتاح ${fmtNum(avail)} فقط${batch ? ' في هذه الدفعة' : ''}` }));
          return;
        }
        if (batch) lines = [`من الدفعة المحددة (${batch.expiry ? 'تنتهي ' + fmtDate(batch.expiry) : 'بدون صلاحية'})`];
        else {
          const { allocs } = allocateFefo(batches, q);
          lines = allocs.map((a) => `${fmtNum(a.qty)} من دفعة ${a.expiry ? 'تنتهي ' + fmtDate(a.expiry) : 'بدون صلاحية'}`);
        }
        if (lines.length) dyn.append(h('div', { class: 'plan' }, h('b', { text: st.mode === 'out' ? 'الأقدم الأول (FEFO): ' : 'هيتخصم من: ' }), lines.join(' ← ')));
      }

      async function confirm() {
        if (busy) return;
        err.classList.add('hidden');
        const q = stepper.get();
        if (q < 1) { err.textContent = 'اكتب كمية صحيحة'; err.classList.remove('hidden'); fb.error(); return; }
        if (q >= settings.bigQty && !armed) {
          armed = true; updateLabel(); fb.unknown();
          armTimer = setTimeout(disarm, 4000);
          return;
        }
        busy = true; confirmBtn.disabled = true;
        const payload = { productId: product.id, type: st.mode, qty: q };
        if (st.mode === 'in' && expiryEl) Object.assign(payload, expiryEl.collect());
        if (st.mode !== 'in' && batch) payload.batchId = batch.id;
        const res = await commitMovement(payload);
        busy = false; confirmBtn.disabled = false;
        if (res) { api.close(); if (onDone) onDone(res); }
      }

      setMode(st.mode);
    },
    onClose: () => clearTimeout(armTimer),
  });
}

/* --------------------------------------------------- product form */

export function openProductForm({ product = null, barcode = '', onSaved }) {
  const editing = !!product;
  return openSheet({
    title: editing ? 'تعديل الصنف' : 'صنف جديد', full: true,
    build(body, api) {
      let category = product ? product.category : '';
      const code = h('input', { class: 'field ltr', type: 'text', inputmode: 'text', autocomplete: 'off', value: product ? product.barcode : barcode, readonly: editing ? true : null, 'aria-label': 'الباركود' });
      const name = h('input', { class: 'field', type: 'text', maxlength: String(LIMITS.nameMax), autocomplete: 'off', placeholder: 'مثال: شيبسي كبير 24 كيس', value: product ? product.name : '', 'aria-label': 'اسم الصنف' });
      const catWrap = h('div', { class: 'chips wrap' });
      const custom = h('input', { class: 'field', type: 'text', maxlength: String(LIMITS.categoryMax), placeholder: 'أو اكتب تصنيف جديد', 'aria-label': 'تصنيف جديد' });
      const minIn = h('input', { class: 'field num-in', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: String(product ? product.minStock : 5), 'aria-label': 'حد الطلب' });
      digitsOnly(minIn);
      const dur = h('input', { class: 'field num-in', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', placeholder: 'المدة', value: product?.shelfLife ? String(product.shelfLife.value) : '', 'aria-label': 'مدة الصلاحية الافتراضية' });
      digitsOnly(dur, 4);
      const unit = h('select', { class: 'field', 'aria-label': 'الوحدة' }, Object.entries(UNIT_LABEL).map(([k, v]) => h('option', { value: k, text: v })));
      unit.value = product?.shelfLife ? product.shelfLife.unit : 'm';
      const err = h('p', { class: 'hint bad hidden', role: 'alert' });
      const save = h('button', { class: 'btn btn-primary btn-lg', type: 'button', text: editing ? 'حفظ التعديلات' : 'حفظ الصنف ومتابعة', onclick: () => submit() });

      const renderCats = () => {
        clear(catWrap);
        for (const c of categories()) {
          catWrap.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(c === category && !custom.value.trim()), text: c, onclick: () => { category = c; custom.value = ''; renderCats(); } }));
        }
      };
      custom.addEventListener('input', renderCats);
      renderCats();

      if (!editing) {
        body.append(h('p', { class: 'hint', text: 'الباركود ده جديد على التطبيق. سجّله مرة واحدة بس.' }));
        body.append(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => linkExisting() }, icon('link', 18), 'ده باركود جديد لصنف موجود'));
      }
      append(body, [
        h('label', { class: 'lbl', text: 'الباركود' }), code,
        h('label', { class: 'lbl', text: 'اسم الصنف' }), name,
        h('label', { class: 'lbl', text: 'التصنيف' }), catWrap, custom,
        h('label', { class: 'lbl', text: 'حد الطلب (نبّهني لما الرصيد يوصل له)' }), minIn,
        h('label', { class: 'lbl', text: 'مدة الصلاحية الافتراضية (اختياري)' }), h('div', { class: 'dur-row' }, dur, unit),
        h('p', { class: 'hint', text: 'لو حطيتها، تاريخ الانتهاء بيتحسب لوحده عند كل وارد.' }),
        err,
      ]);

      if (editing) {
        const bcBox = h('div');
        const addIn = h('input', { class: 'field ltr', type: 'text', placeholder: 'باركود إضافي (لو الشركة غيّرت الكرتونة)', 'aria-label': 'باركود إضافي' });
        const renderBarcodes = () => {
          clear(bcBox);
          for (const c of product.barcodes) {
            bcBox.append(h('div', { class: 'batch-row' }, h('span', { class: 'ltr', text: c }),
              product.barcodes.length > 1 ? h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'حذف الباركود', onclick: async () => {
                try { product = await removeBarcode(product.id, c); await refresh(); renderBarcodes(); } catch (e) { toast(reportError(e), { kind: 'error' }); }
              } }, icon('x', 18)) : null));
          }
        };
        renderBarcodes();
        append(body, [
          h('div', { class: 'section-title', text: 'الباركودات المرتبطة' }), bcBox,
          h('div', { class: 'btn-row' }, addIn, h('button', { class: 'btn', type: 'button', text: 'ربط', onclick: async () => {
            try { product = await addBarcode(product.id, addIn.value); addIn.value = ''; await refresh(); renderBarcodes(); fb.ok(); } catch (e) { fb.error(); toast(reportError(e), { kind: 'error' }); }
          } })),
        ]);
      }

      body.append(h('div', { class: 'btn-row' }, save));
      if (editing) {
        body.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
          const ok = await confirmDialog({ title: 'حذف الصنف', message: `هتحذف "${product.name}" نهائيًا من القائمة (سجل الحركات هيفضل موجود). متأكد؟`, okLabel: 'احذف', danger: true });
          if (!ok) return;
          try { await deleteProduct(product.id); await refresh(); api.close(); toast('تم حذف الصنف', { kind: 'ok' }); } catch (e) { toast(reportError(e), { kind: 'error' }); }
        } }, icon('trash', 20), 'حذف الصنف')));
      }

      function linkExisting() {
        openSearchSheet({
          title: 'اربط الباركود بصنف موجود', hideCreate: true,
          async onPick(p, sheet) {
            try {
              const updated = await addBarcode(p.id, code.value);
              await refresh(); fb.ok(); sheet.close(); api.close();
              toast(`تم ربط الباركود بـ ${p.name}`, { kind: 'ok' });
              if (onSaved) onSaved(updated, { linked: true });
            } catch (e) { fb.error(); toast(reportError(e), { kind: 'error' }); }
          },
        });
      }

      async function submit() {
        err.classList.add('hidden');
        save.disabled = true;
        try {
          const n = parseInt(toAsciiDigits(dur.value), 10);
          const input = {
            barcode: code.value, name: name.value, category: custom.value.trim() || category || 'أخرى',
            minStock: minIn.value || 0, shelfLife: n > 0 ? { value: n, unit: unit.value } : null,
          };
          const saved = editing ? await updateProduct(product.id, input) : await createProduct(input);
          await refresh(); fb.ok(); api.close();
          if (onSaved) onSaved(saved, { linked: false });
        } catch (e) {
          fb.error(); err.textContent = reportError(e); err.classList.remove('hidden');
        } finally { save.disabled = false; }
      }
      if (!editing) setTimeout(() => name.focus(), 260);
    },
  });
}

/* ------------------------------------------------------- search */

export function openSearchSheet({ title = 'بحث يدوي', onPick, onNewBarcode, hideCreate = false }) {
  return openSheet({
    title, full: true,
    build(body, api) {
      const input = h('input', { class: 'field', type: 'search', autocomplete: 'off', inputmode: 'search', placeholder: 'اكتب اسم الصنف أو أرقام الباركود', 'aria-label': 'بحث', enterkeyhint: 'search' });
      const results = h('div', { class: 'list' });
      body.append(h('div', { class: 'search' }, icon('search', 20), input), results);
      const render = () => {
        clear(results);
        const q = toAsciiDigits(input.value).trim().toLowerCase();
        const hits = (q ? store.items.filter((i) => i.product.name.toLowerCase().includes(q) || i.product.barcodes.some((c) => c.includes(q))) : store.items).slice(0, 40);
        for (const it of hits) {
          results.append(h('button', { class: 'row', type: 'button', onclick: () => onPick(it.product, api) },
            h('div', { class: 'r-main' }, h('div', { class: 'r-name', text: it.product.name }), h('div', { class: 'r-sub' }, h('span', { text: it.product.category }), h('span', { class: 'ltr', text: it.product.barcode }))),
            h('div', { class: `r-qty ${it.low ? 'low' : ''}` }, h('span', { class: 'num', text: fmtNum(it.stock) }), h('small', { text: 'كرتونة' }))));
        }
        if (!hits.length) results.append(h('div', { class: 'empty' }, h('h3', { text: 'مفيش نتائج' }), h('p', { text: 'جرّب كلمة تانية أو أرقام الباركود.' })));
        if (!hideCreate && onNewBarcode && /^[\x21-\x7E]{6,32}$/.test(q)) {
          results.prepend(h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => onNewBarcode(q, api) }, icon('plus', 22), `صنف جديد بالباركود ${q}`));
        }
      };
      input.addEventListener('input', debounce(render, 120));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); render(); input.blur(); } });
      render();
      setTimeout(() => input.focus(), 260);
    },
  });
}

/* ------------------------------------------------ product detail */

export function openProductDetail(productId) {
  const item = itemById(productId);
  if (!item) return null;
  const p = item.product;
  return openSheet({
    title: p.name, full: true,
    build(body, api) {
      const go = (mode, batch = null) => { api.close(); openMovementSheet({ product: p, mode, batch, qty: batch ? batch.qty : 1 }); };
      append(body, [
        h('div', { class: 'pinfo' },
          h('div', { class: 'r-main' },
            h('p', { class: 'muted', text: p.category }),
            h('div', { class: 'r-sub' },
              p.barcodes.map((c) => h('span', { class: 'ltr', text: c })),
              item.low ? h('span', { class: 'pill low', text: 'ناقص' }) : null,
              item.out ? h('span', { class: 'pill out', text: 'نافد' }) : null,
              statusPill(item.expiry.status, item.expiry.daysLeft)),
            h('p', { class: 'hint', text: `حد الطلب: ${fmtNum(p.minStock)}${p.shelfLife ? ` · الصلاحية الافتراضية: ${p.shelfLife.value} ${UNIT_LABEL[p.shelfLife.unit]}` : ''}` })),
          h('div', { class: 'p-stock' }, h('b', { class: `num ${item.low ? 'diff neg' : ''}`, text: fmtNum(item.stock) }), h('small', { text: 'كرتونة' }))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-in', type: 'button', text: 'وارد', onclick: () => go('in') }),
          h('button', { class: 'btn btn-out', type: 'button', text: 'منصرف', onclick: () => go('out') }),
          h('button', { class: 'btn btn-damaged', type: 'button', text: 'هالك', onclick: () => go('damaged') })),
        h('div', { class: 'section-title' }, icon('box', 20), 'الدفعات (الأقدم صلاحية أولًا)'),
      ]);
      if (!item.batches.length) body.append(h('p', { class: 'hint', text: 'مفيش رصيد حاليًا.' }));
      for (const b of item.batches) {
        const c = classifyExpiry(b.expiry, todayStr(), thresholds());
        body.append(h('div', { class: 'batch-row' },
          h('div', {}, h('b', { class: 'num', text: `${fmtNum(b.qty)} كرتونة` }),
            h('div', { class: 'r-sub' }, h('span', { text: `دخلت ${fmtDate(b.receivedAt)}` }), h('span', { text: b.expiry ? `تنتهي ${fmtDate(b.expiry)}` : 'بدون صلاحية' }), statusPill(c.status, c.daysLeft))),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-out btn-sm', type: 'button', text: 'صرف', onclick: () => go('out', b) }),
            h('button', { class: 'btn btn-damaged btn-sm', type: 'button', text: 'هالك', onclick: () => go('damaged', b) }))));
      }
      const log = h('div', { class: 'list' });
      append(body, [h('div', { class: 'section-title' }, icon('list', 20), 'آخر الحركات'), log,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { api.close(); openProductForm({ product: p }); } }, icon('edit', 20), 'تعديل الصنف'))]);
      listMovements({ productId: p.id, limit: 6 }).then((ms) => {
        if (!ms.length) log.append(h('p', { class: 'hint', text: 'لسه مفيش حركات.' }));
        for (const m of ms) log.append(movementRow(m));
      }).catch(() => {});
    },
  });
}

export function movementRow(m, { showName = false } = {}) {
  const pos = m.delta > 0;
  return h('div', { class: `mv ${m.undone ? 'undone' : ''}` },
    h('div', { class: 'mv-main' },
      h('div', { class: 'mv-name', text: showName ? m.productName : MOVEMENT_LABEL[m.type] }),
      h('div', { class: 'mv-sub' },
        h('span', { class: `pill ${m.type === 'out' ? 'mout' : m.type}`, text: MOVEMENT_LABEL[m.type] }),
        h('span', { text: fmtTime(m.ts) }), h('span', { text: `الرصيد ${fmtNum(m.balanceAfter)}` }),
        m.user ? h('span', { text: m.user }) : null, m.undone ? h('span', { class: 'pill', text: 'ملغاة' }) : null)),
    h('div', { class: `mv-q num ${pos ? 'pos' : 'neg'}`, text: `${pos ? '+' : '−'}${fmtNum(Math.abs(m.delta))}` }));
}
