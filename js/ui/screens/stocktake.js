// stocktake.js — physical count mode. Scan (or type) what you actually find on the shelf;
// RAFF shows shortage/surplus vs. the system and books the difference as "adjust" movements.
import { normalizeBarcode, toAsciiDigits, LIMITS } from '../../domain.js';
import { findProductByBarcode, applyStocktake, loadStocktake, saveStocktake, clearStocktake } from '../../services.js';
import { getSettings } from '../../settings.js';
import { store, refresh, itemById } from '../../store.js';
import { reportError } from '../../actions.js';
import { h, clear, toast, confirmDialog, openSheet, hasOpenSheet, fmtNum } from '../dom.js';
import { icon } from '../icons.js';
import { Scanner, scannerSupported, cameraErrorMessage } from '../scanner.js';
import { openProductForm, openSearchSheet } from '../sheets.js';
import * as fb from '../feedback.js';

export async function openStocktake(ctx) {
  await ctx.scan.pause();
  let session = (await loadStocktake().catch(() => null)) || { startedAt: new Date().toISOString(), items: [] };
  let scanner = null;
  let busy = false;
  let lastId = null;

  const camMsg = h('p', { text: 'امسح كل كرتونة تلاقيها على الرف. كل مسحة = +1.' });
  const startBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: startCam }, icon('camera', 20), 'تشغيل الكاميرا');
  const idle = h('div', { class: 'cam-idle' }, camMsg, startBtn);
  const torchBtn = h('button', { class: 'icon-btn hidden', type: 'button', 'aria-label': 'كشاف', onclick: async () => { try { torchBtn.classList.toggle('on', await scanner.setTorch(!scanner.torchOn)); } catch { /* unsupported */ } } }, icon('flash', 24));
  const manualBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: manualAdd }, icon('keyboard', 20), 'يدوي');
  const cam = h('div', { class: 'cam' }, h('div', { id: 'st-reader' }), h('div', { class: 'scanline' }), idle, h('div', { class: 'cam-tools' }, torchBtn, h('span', { class: 'head-spacer' }), manualBtn));
  const banner = h('div', { class: 'card last-scan hidden' });
  const list = h('div', { class: 'list' });
  const sum = h('span', { class: 'muted' });
  const finish = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: review }, icon('check', 22), 'إنهاء ومراجعة الفروقات');
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'خروج', onclick: () => leave() }, icon('x', 22));
  const view = h('div', { class: 'st-view', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'الجرد الفعلي' },
    h('div', { class: 'st-head' }, closeBtn, h('div', {}, h('b', { text: 'الجرد الفعلي' }), h('div', {}, sum))),
    h('div', { class: 'st-body' }, cam, banner, list),
    h('div', { class: 'st-foot' }, finish));
  document.body.append(view);

  const persist = () => saveStocktake(session).catch(() => {});
  const counted = (id) => (session.items.find((x) => x.productId === id) || {}).counted;

  async function startCam() {
    fb.unlockAudio();
    if (!scannerSupported()) { camMsg.textContent = cameraErrorMessage({ name: 'unsupported' }); return; }
    scanner = new Scanner('st-reader', onCode);
    startBtn.disabled = true;
    try { await scanner.start(); idle.classList.add('hidden'); cam.classList.add('live'); torchBtn.classList.toggle('hidden', !scanner.torchSupported); }
    catch (e) { scanner = null; camMsg.textContent = cameraErrorMessage(e); }
    finally { startBtn.disabled = false; }
  }

  async function onCode(raw) {
    if (busy || hasOpenSheet()) return;
    busy = true;
    try {
      let code;
      try { code = normalizeBarcode(raw); } catch { fb.error(); return; }
      const product = await findProductByBarcode(code);
      if (!product) {
        fb.unknown();
        openProductForm({ barcode: code, onSaved: (p) => { bump(p.id, 1); } });
        return;
      }
      fb.ok();
      bump(product.id, 1);
    } catch (e) { fb.error(); toast(reportError(e), { kind: 'error' }); } finally { busy = false; }
  }

  function bump(productId, by) {
    const row = session.items.find((x) => x.productId === productId);
    if (row) row.counted = Math.max(0, Math.min(LIMITS.qtyMax, row.counted + by));
    else session.items.push({ productId, counted: Math.max(0, by) });
    lastId = productId; persist(); render();
  }
  function setCount(productId, n) {
    const row = session.items.find((x) => x.productId === productId);
    if (row) row.counted = Math.max(0, Math.min(LIMITS.qtyMax, n)); persist(); render();
  }

  function manualAdd() {
    openSearchSheet({
      title: 'أضف صنف للجرد',
      onPick: (p, sheet) => { sheet.close(); bump(p.id, 1); },
      onNewBarcode: (code, sheet) => { sheet.close(); openProductForm({ barcode: code, onSaved: (p) => bump(p.id, 1) }); },
    });
  }

  function render() {
    clear(list); clear(banner);
    const rows = [...session.items].reverse();
    sum.textContent = `${fmtNum(rows.length)} صنف · ${fmtNum(rows.reduce((n, r) => n + r.counted, 0))} كرتونة معدودة`;
    finish.disabled = rows.length === 0;
    const lastItem = lastId && itemById(lastId);
    banner.classList.toggle('hidden', !lastItem);
    if (lastItem) banner.append(h('div', { class: 'ls-main' }, h('div', { class: 'ls-name', text: lastItem.product.name }), h('div', { class: 'muted', text: `الرصيد في السيستم ${fmtNum(lastItem.stock)}` })), h('b', { class: 'mv-q num pos', text: fmtNum(counted(lastId)) }));
    if (!rows.length) { list.append(h('div', { class: 'empty' }, h('h3', { text: 'ابدأ العد' }), h('p', { text: 'امسح الكراتين أو أضف الصنف يدويًا واكتب العدد.' }))); return; }
    for (const r of rows) {
      const it = itemById(r.productId);
      if (!it) continue;
      const diff = r.counted - it.stock;
      const input = h('input', { class: 'field num-in', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: String(r.counted), 'aria-label': `العدد الفعلي — ${it.product.name}` });
      input.addEventListener('input', () => { const v = toAsciiDigits(input.value).replace(/\D/g, '').slice(0, 6); if (v !== input.value) input.value = v; });
      input.addEventListener('change', () => setCount(r.productId, parseInt(input.value || '0', 10)));
      input.addEventListener('focus', () => input.select());
      list.append(h('div', { class: `row ${r.productId === lastId ? 'l-soon' : ''}` },
        h('div', { class: 'r-main' }, h('div', { class: 'r-name', text: it.product.name }),
          h('div', { class: 'r-sub' }, h('span', { text: `السيستم: ${fmtNum(it.stock)}` }), h('span', { class: `diff ${diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'zero'}`, text: diff === 0 ? 'مطابق ✓' : diff > 0 ? `زيادة ${fmtNum(diff)}` : `عجز ${fmtNum(-diff)}` }))),
        h('div', { class: 'stepper st-step' },
          h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'نقص', onclick: () => bump(r.productId, -1) }, icon('minus', 20)), input,
          h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'زيادة', onclick: () => bump(r.productId, 1) }, icon('plus', 20)))));
    }
  }

  async function review() {
    const rows = session.items.filter((r) => itemById(r.productId));
    const diffs = rows.map((r) => ({ ...r, system: itemById(r.productId).stock, product: itemById(r.productId).product })).map((r) => ({ ...r, diff: r.counted - r.system }));
    const counts = new Set(rows.map((r) => r.productId));
    const uncounted = store.items.filter((i) => !counts.has(i.product.id) && i.stock > 0);
    openSheet({
      title: 'مراجعة الجرد', full: true,
      build(body, api) {
        const short = diffs.filter((d) => d.diff < 0), over = diffs.filter((d) => d.diff > 0);
        const zeroUncounted = h('input', { type: 'checkbox', 'aria-label': 'اعتبر غير المعدود صفر' });
        body.append(h('div', { class: 'stats' },
          h('div', { class: `stat ${short.length ? 'alert' : ''}` }, h('b', { class: 'num', text: fmtNum(short.reduce((n, d) => n - d.diff, 0)) }), h('span', { text: `عجز (${fmtNum(short.length)} صنف)` })),
          h('div', { class: 'stat' }, h('b', { class: 'num', text: fmtNum(over.reduce((n, d) => n + d.diff, 0)) }), h('span', { text: `زيادة (${fmtNum(over.length)} صنف)` }))));
        const l = h('div', { class: 'list' });
        for (const d of [...short, ...over]) l.append(h('div', { class: 'row' }, h('div', { class: 'r-main' }, h('div', { class: 'r-name', text: d.product.name }), h('div', { class: 'r-sub', text: `السيستم ${fmtNum(d.system)} ← الفعلي ${fmtNum(d.counted)}` })), h('b', { class: `mv-q num ${d.diff > 0 ? 'pos' : 'neg'}`, text: `${d.diff > 0 ? '+' : '−'}${fmtNum(Math.abs(d.diff))}` })));
        if (!short.length && !over.length) l.append(h('div', { class: 'empty' }, h('h3', { text: 'كل الأصناف المعدودة مطابقة ✓' })));
        body.append(l);
        if (uncounted.length) body.append(h('label', { class: 'toggle-row' }, h('span', {}, `${fmtNum(uncounted.length)} صنف لم يتم عدّه`, h('small', { text: 'فعّلها لو المخزن كله اتجرد وأي صنف ماتعدّش يعتبر رصيده صفر (خطير — هيسجل عجز)' })), h('span', { class: 'switch' }, zeroUncounted, h('span'))));
        body.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary btn-lg', type: 'button', text: 'اعتماد وتسوية الرصيد', onclick: async () => {
          const list2 = rows.map((r) => ({ productId: r.productId, counted: r.counted }));
          if (zeroUncounted.checked) {
            const ok2 = await confirmDialog({ title: 'تأكيد تصفير غير المعدود', message: `${fmtNum(uncounted.length)} صنف هيتسجل عليه عجز بكامل رصيده. متأكد؟`, okLabel: 'أيوه، صفّرها', danger: true });
            if (!ok2) return;
            for (const u of uncounted) list2.push({ productId: u.product.id, counted: 0 });
          }
          try {
            const res = await applyStocktake(list2, { user: getSettings().employee });
            await clearStocktake(); await refresh(); fb.ok();
            api.close(); closeView();
            toast(`تمت التسوية — عجز ${fmtNum(res.shortage)} · زيادة ${fmtNum(res.surplus)} · مطابق ${fmtNum(res.matched)} صنف`, { kind: 'ok', ms: 8000 });
          } catch (e) { fb.error(); toast(reportError(e), { kind: 'error' }); }
        } })));
      },
    });
  }

  async function closeView() {
    if (scanner) { await scanner.stop(); scanner = null; }
    view.remove();
    ctx.scan.onShow();
  }
  async function leave() {
    if (session.items.length) {
      const ok = await confirmDialog({ title: 'الخروج من الجرد', message: 'العد اتحفظ تلقائي وتقدر تكمله بعدين. تخرج دلوقتي؟', okLabel: 'اخرج' });
      if (!ok) return;
      return closeView();
    }
    await clearStocktake().catch(() => {});
    return closeView();
  }

  if (session.items.length) toast('تم استرجاع جلسة جرد غير مكتملة', { kind: 'warn' });
  render();
}
