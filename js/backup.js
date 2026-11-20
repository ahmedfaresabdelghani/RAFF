// backup.js — JSON backup / restore. Imported files are UNTRUSTED input:
// every record is rebuilt from a whitelist of fields and re-validated; unknown keys are dropped.

import {
  LIMITS, ValidationError, cleanText, isValidDateStr, normalizeBarcode, validateShelfLife,
} from './domain.js';
import { exportAll, replaceAll } from './db.js';

export const BACKUP_FORMAT = 'raff-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 300000;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const bad = (what) => new ValidationError(`ملف النسخة الاحتياطية غير صالح (${what})`);
const str = (v, what, max = 64) => {
  if (typeof v !== 'string' || !v || v.length > max) throw bad(what);
  return v;
};
const num = (v, what, min, max) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw bad(what);
  return v;
};
const iso = (v, what) => {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v)) || v.length > 40) throw bad(what);
  return v;
};
const optDate = (v, what) => {
  if (v == null) return null;
  if (!isValidDateStr(v)) throw bad(what);
  return v;
};

export async function buildBackup(now = new Date()) {
  const data = await exportAll();
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(),
    data: { products: data.products, batches: data.batches, movements: data.movements },
  };
}

export function validateBackup(obj) {
  if (!isObj(obj) || obj.format !== BACKUP_FORMAT) throw bad('الصيغة');
  if (obj.version !== BACKUP_VERSION) throw bad('الإصدار');
  if (!isObj(obj.data)) throw bad('البيانات');
  const { products, batches, movements } = obj.data;
  for (const [k, arr] of Object.entries({ products, batches, movements })) {
    if (!Array.isArray(arr) || arr.length > MAX_ROWS) throw bad(k);
  }

  const seen = new Set();
  const cleanProducts = products.map((p) => {
    if (!isObj(p)) throw bad('صنف');
    const id = str(p.id, 'id');
    if (seen.has(id)) throw bad('صنف مكرر');
    seen.add(id);
    if (!Array.isArray(p.barcodes) || p.barcodes.length < 1 || p.barcodes.length > 10) throw bad('باركود');
    const barcodes = [...new Set(p.barcodes.map((b) => normalizeBarcode(b)))];
    const barcode = normalizeBarcode(p.barcode);
    if (!barcodes.includes(barcode)) throw bad('باركود رئيسي');
    return {
      id, barcode, barcodes,
      name: cleanText(p.name, LIMITS.nameMax, 'اسم الصنف', { required: true }),
      category: cleanText(p.category, LIMITS.categoryMax, 'التصنيف') || 'أخرى',
      minStock: num(p.minStock, 'حد الطلب', 0, LIMITS.minStockMax),
      shelfLife: validateShelfLife(p.shelfLife ?? null),
      createdAt: iso(p.createdAt, 'تاريخ'), updatedAt: iso(p.updatedAt, 'تاريخ'),
    };
  });
  // A barcode may belong to only one product.
  const codes = new Set();
  for (const p of cleanProducts) for (const c of p.barcodes) {
    if (codes.has(c)) throw bad('باركود مكرر');
    codes.add(c);
  }

  const batchIds = new Set();
  const cleanBatches = batches.map((b) => {
    if (!isObj(b)) throw bad('دفعة');
    const id = str(b.id, 'id');
    if (batchIds.has(id)) throw bad('دفعة مكررة');
    batchIds.add(id);
    const productId = str(b.productId, 'productId');
    if (!seen.has(productId)) throw bad('دفعة بلا صنف');
    if (!isValidDateStr(b.receivedAt)) throw bad('تاريخ الدخول');
    return {
      id, productId,
      qty: num(b.qty, 'كمية', 0, LIMITS.qtyMax * 10),
      qtyIn: num(b.qtyIn, 'كمية', 0, LIMITS.qtyMax * 10),
      receivedAt: b.receivedAt, expiry: optDate(b.expiry, 'تاريخ الانتهاء'),
      expirySource: ['auto', 'manual', null].includes(b.expirySource ?? null) ? (b.expirySource ?? null) : (() => { throw bad('مصدر'); })(),
      createdAt: iso(b.createdAt, 'تاريخ'),
    };
  });

  const movIds = new Set();
  const cleanMovements = movements.map((m) => {
    if (!isObj(m)) throw bad('حركة');
    const id = str(m.id, 'id');
    if (movIds.has(id)) throw bad('حركة مكررة');
    movIds.add(id);
    if (!['in', 'out', 'damaged', 'adjust'].includes(m.type)) throw bad('نوع الحركة');
    if (!Array.isArray(m.allocs) || m.allocs.length > 5000) throw bad('تخصيص');
    return {
      id, ts: iso(m.ts, 'تاريخ'), productId: str(m.productId, 'productId'),
      productName: cleanText(m.productName, LIMITS.nameMax, 'اسم الصنف'),
      barcode: normalizeBarcode(m.barcode), type: m.type,
      qty: num(m.qty, 'كمية', 1, LIMITS.qtyMax * 10),
      delta: num(m.delta, 'كمية', -LIMITS.qtyMax * 10, LIMITS.qtyMax * 10),
      balanceAfter: num(m.balanceAfter, 'رصيد', -LIMITS.qtyMax * 10, LIMITS.qtyMax * 100),
      allocs: m.allocs.map((a) => {
        if (!isObj(a)) throw bad('تخصيص');
        return { batchId: str(a.batchId, 'batchId'), qty: num(a.qty, 'كمية', 1, LIMITS.qtyMax * 10), expiry: optDate(a.expiry, 'تاريخ') };
      }),
      createdBatchId: m.createdBatchId == null ? null : str(m.createdBatchId, 'batchId'),
      user: cleanText(m.user ?? '', LIMITS.userMax, 'الموظف'),
      note: cleanText(m.note ?? '', LIMITS.noteMax, 'الملاحظة'),
      undone: m.undone === true,
    };
  });

  return { products: cleanProducts, batches: cleanBatches, movements: cleanMovements, meta: [] };
}

export async function restoreFromText(text) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES) throw bad('الحجم');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw bad('JSON'); }
  const clean = validateBackup(parsed);
  await replaceAll(clean);
  return { products: clean.products.length, movements: clean.movements.length };
}
