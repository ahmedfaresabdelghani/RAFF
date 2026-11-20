// csv.js — Excel-ready exports (UTF-8 BOM, CRLF). Escaping rules live in domain.js.
import { MOVEMENT_LABEL, classifyExpiry, csvBarcode, toCsv, expiryRows, DEFAULT_THRESHOLDS } from './domain.js';

const pad = (n) => String(n).padStart(2, '0');
function localParts(iso) {
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export function inventoryCsv(items) {
  const rows = [['الباركود', 'اسم الصنف', 'التصنيف', 'الرصيد (كرتونة)', 'حد الطلب', 'الحالة', 'أقرب تاريخ انتهاء', 'الأيام المتبقية', 'عدد الدفعات']];
  for (const it of items) {
    const status = it.out ? 'نافد' : it.low ? 'ناقص' : 'عادي';
    rows.push([
      csvBarcode(it.product.barcode), it.product.name, it.product.category, it.stock, it.product.minStock,
      status, it.nextExpiry || '', it.expiry.daysLeft, it.batches.length,
    ]);
  }
  return toCsv(rows);
}

export function movementsCsv(movements) {
  const rows = [['التاريخ', 'الوقت', 'الباركود', 'الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة', 'الموظف', 'ملاحظة', 'الحالة']];
  for (const m of movements) {
    const { date, time } = localParts(m.ts);
    rows.push([date, time, csvBarcode(m.barcode), m.productName, MOVEMENT_LABEL[m.type], m.delta, m.balanceAfter, m.user, m.note, m.undone ? 'ملغاة' : 'سارية']);
  }
  return toCsv(rows);
}

const STATUS_AR = { expired: 'منتهي', critical: 'حرج', soon: 'قريب', ok: 'سليم', none: 'بدون صلاحية' };
export function batchesCsv(items, today, thresholds = DEFAULT_THRESHOLDS) {
  const rows = [['الباركود', 'اسم الصنف', 'الكمية', 'تاريخ الدخول', 'تاريخ الانتهاء', 'الأيام المتبقية', 'الحالة']];
  for (const it of items) {
    for (const b of it.batches) {
      const c = classifyExpiry(b.expiry, today, thresholds);
      rows.push([csvBarcode(it.product.barcode), it.product.name, b.qty, b.receivedAt, b.expiry || '', c.daysLeft, STATUS_AR[c.status]]);
    }
  }
  return toCsv(rows);
}

// Plain-text report for WhatsApp / share sheet.
export function shortagesText(items, now = new Date()) {
  const list = items.filter((i) => i.low || (i.out && i.product.minStock > 0));
  if (!list.length) return '';
  const lines = [`📦 رفّ — نواقص المخزن (${now.toLocaleDateString('ar-EG-u-nu-latn')})`, ''];
  for (const i of list) lines.push(`• ${i.product.name}: الرصيد ${i.stock} (الحد ${i.product.minStock})`);
  return lines.join('\n');
}
export function expiryText(items, today, thresholds, now = new Date()) {
  const rows = expiryRows(items, today, thresholds).filter((r) => r.status !== 'ok');
  if (!rows.length) return '';
  const lines = [`⏰ رفّ — تنبيهات الصلاحية (${now.toLocaleDateString('ar-EG-u-nu-latn')})`, ''];
  for (const r of rows) {
    const when = r.daysLeft < 0 ? `منتهي من ${-r.daysLeft} يوم` : r.daysLeft === 0 ? 'ينتهي اليوم' : `باقي ${r.daysLeft} يوم`;
    lines.push(`• ${r.product.name} — ${r.batch.qty} كرتونة — ${r.batch.expiry} (${when})`);
  }
  return lines.join('\n');
}
