// more.js — stocktake, exports, backup, settings, demo data, storage, about.
import { getInventory, listMovements } from '../../services.js';
import { todayStr } from '../../domain.js';
import { getSettings, saveSettings, thresholds } from '../../settings.js';
import { buildBackup, restoreFromText, MAX_BACKUP_BYTES } from '../../backup.js';
import { clearAll } from '../../db.js';
import { inventoryCsv, movementsCsv, batchesCsv, shortagesText } from '../../csv.js';
import { saveFile, stamp } from '../../files.js';
import { store, refresh } from '../../store.js';
import { reportError } from '../../actions.js';
import { h, clear, toast, openSheet, confirmDialog, fmtNum } from '../dom.js';
import { icon } from '../icons.js';
import { openStocktake } from './stocktake.js';
import * as fb from '../feedback.js';

export const APP_VERSION = '1.0.0';

export function createMoreScreen(root, ctx) {
  const box = h('div');
  root.append(box);

  const item = (ico, title, sub, onclick, cls = '') => h('button', { class: `more-item ${cls}`, type: 'button', onclick },
    h('span', { class: 'mi-ico' }, icon(ico, 22)), h('span', {}, h('b', { text: title }), h('small', { text: sub })));

  async function exportCsv(kind) {
    try {
      const now = new Date();
      const items = await getInventory({ now, thresholds: thresholds() });
      let text; let name;
      if (kind === 'inventory') { text = inventoryCsv(items); name = `raff-inventory-${stamp(now)}.csv`; }
      else if (kind === 'batches') { text = batchesCsv(items, todayStr(now), thresholds()); name = `raff-expiry-batches-${stamp(now)}.csv`; }
      else { text = movementsCsv((await listMovements({ limit: 1000000 })).reverse()); name = `raff-movements-${stamp(now)}.csv`; }
      const r = await saveFile(name, text);
      if (r !== 'cancelled') { fb.ok(); toast(r === 'shared' ? 'تم تجهيز الملف للمشاركة' : `تم تحميل ${name}`, { kind: 'ok' }); }
    } catch (e) { fb.error(); toast(reportError(e), { kind: 'error' }); }
  }

  async function exportBackup() {
    try {
      const b = await buildBackup();
      const r = await saveFile(`raff-backup-${stamp()}.json`, JSON.stringify(b), 'application/json');
      if (r !== 'cancelled') { fb.ok(); toast('تم حفظ النسخة الاحتياطية', { kind: 'ok' }); }
    } catch (e) { fb.error(); toast(reportError(e), { kind: 'error' }); }
  }

  function importBackup() {
    const input = h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden' });
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      if (file.size > MAX_BACKUP_BYTES) { toast('الملف كبير جدًا', { kind: 'error' }); return; }
      const ok = await confirmDialog({ title: 'استرجاع نسخة احتياطية', message: 'هيتم استبدال كل البيانات الحالية بمحتوى الملف. لو محتاج، خد نسخة احتياطية من الحالي الأول. متأكد؟', okLabel: 'استرجع', danger: true });
      if (!ok) return;
      try {
        const res = await restoreFromText(await file.text());
        await refresh(); fb.ok();
        toast(`تم استرجاع ${fmtNum(res.products)} صنف و${fmtNum(res.movements)} حركة`, { kind: 'ok', ms: 7000 });
      } catch (e) { fb.error(); toast(reportError(e), { kind: 'error' }); }
    });
    document.body.append(input);
    input.click();
  }

  async function shareShortages() {
    const text = shortagesText(store.items);
    if (!text) { toast('مفيش نواقص دلوقتي ✓', { kind: 'ok' }); return; }
    if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  function openSettings() {
    openSheet({
      title: 'الإعدادات', full: true,
      build(body, api) {
        const s = getSettings();
        const emp = h('input', { class: 'field', type: 'text', maxlength: '40', value: s.employee, placeholder: 'اسمك (بيتسجل مع كل حركة)', 'aria-label': 'اسم الموظف', autocomplete: 'off' });
        const num = (v) => h('input', { class: 'field num-in', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: String(v) });
        const warn = num(s.warnDays), crit = num(s.critDays), big = num(s.bigQty);
        const sw = (label, sub, checked) => { const i = h('input', { type: 'checkbox', 'aria-label': label }); i.checked = checked; return { i, el: h('label', { class: 'toggle-row' }, h('span', {}, label, sub ? h('small', { text: sub }) : null), h('span', { class: 'switch' }, i, h('span'))) }; };
        const sound = sw('صوت البيب', null, s.sound), vib = sw('الاهتزاز', 'مش مدعوم على iPhone', s.vibrate), light = sw('الوضع الفاتح', 'للمخازن المضيئة (الافتراضي داكن)', s.theme === 'light');
        append2(body, [
          h('label', { class: 'lbl', text: 'اسم الموظف' }), emp,
          h('label', { class: 'lbl', text: 'تنبيه الصلاحية قبل (يوم)' }), warn,
          h('label', { class: 'lbl', text: 'تنبيه حرج قبل (يوم)' }), crit,
          h('label', { class: 'lbl', text: 'اطلب تأكيد إضافي لو الكمية ≥' }), big,
          h('div', { class: 'more-group' }), sound.el, vib.el, light.el,
        ]);
        body.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary btn-lg', type: 'button', text: 'حفظ', onclick: async () => {
          const n = (el) => parseInt(String(el.value).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)), 10);
          const saved = saveSettings({ employee: emp.value, warnDays: n(warn), critDays: n(crit), bigQty: n(big), sound: sound.i.checked, vibrate: vib.i.checked, theme: light.i.checked ? 'light' : 'dark' });
          ctx.applyTheme(); await refresh(); api.close();
          toast(saved.critDays !== n(crit) || saved.warnDays !== n(warn) ? 'تم الحفظ (اتعدلت قيم خارج الحدود المسموحة)' : 'تم حفظ الإعدادات', { kind: 'ok' });
        } })));
      },
    });
  }

  async function wipe() {
    const ok = await confirmDialog({ title: 'مسح كل البيانات', message: 'هيتمسح كل الأصناف والدفعات والسجل من الجهاز ده نهائيًا. خد نسخة احتياطية قبلها.', okLabel: 'امسح كل شيء', danger: true, typed: 'مسح' });
    if (!ok) return;
    try { await clearAll(); await refresh(); toast('تم مسح كل البيانات', { kind: 'ok' }); } catch (e) { toast(reportError(e), { kind: 'error' }); }
  }

  async function storageInfo() {
    let line = 'غير معروف';
    try {
      const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      line = `${persisted ? 'تخزين دائم ✓' : 'تخزين عادي (قد يمسحه المتصفح عند امتلاء الجهاز)'}${est ? ` · مستخدم ${(est.usage / 1048576).toFixed(1)} MB` : ''}`;
    } catch { /* ignore */ }
    return line;
  }

  async function render() {
    clear(box);
    const storage = await storageInfo();
    const s = getSettings();
    box.append(
      h('div', { class: 'more-group' }, item('clipboard', 'الجرد الفعلي', 'عدّ المخزن بالمسح وتسوية الفروقات تلقائيًا', () => openStocktake(ctx))),
      h('div', { class: 'section-title', text: 'تقارير وتصدير (Excel)' }),
      item('download', 'تصدير المخزون الحالي', 'ملف CSV يفتح في Excel بالعربي', () => exportCsv('inventory')),
      item('download', 'تصدير سجل الحركات', 'كل الحركات بالتاريخ والموظف', () => exportCsv('movements')),
      item('download', 'تصدير الدفعات والصلاحيات', 'تاريخ الدخول والانتهاء لكل دفعة', () => exportCsv('batches')),
      item('send', 'إرسال النواقص على واتساب', 'قائمة الأصناف تحت حد الطلب', shareShortages),
      h('div', { class: 'section-title', text: 'البيانات' }),
      item('database', 'نسخة احتياطية', 'احفظ كل بياناتك في ملف JSON', exportBackup),
      item('upload', 'استرجاع نسخة احتياطية', 'يستبدل البيانات الحالية', importBackup),
      item('box', 'بيانات تجريبية', 'للتجربة والعرض على العملاء', () => ctx.loadDemo()),
      item('trash', 'مسح كل البيانات', 'نهائي — خد نسخة احتياطية الأول', wipe, 'danger'),
      h('div', { class: 'section-title', text: 'التطبيق' }),
      item('menu', 'الإعدادات', `الموظف: ${s.employee || 'غير محدد'} · تنبيه الصلاحية ${s.warnDays} يوم`, openSettings),
      ctx.installPrompt ? item('download', 'ثبّت التطبيق على الشاشة الرئيسية', 'يفتح أسرع ويشتغل بدون إنترنت', () => ctx.install()) : null,
      h('p', { class: 'hint', text: `رفّ RAFF v${APP_VERSION} · البيانات محفوظة على هذا الجهاز فقط · ${storage}` }));
  }

  return { onShow: render, onHide() {} };
}

function append2(el, nodes) { for (const n of nodes) if (n) el.append(n); }
