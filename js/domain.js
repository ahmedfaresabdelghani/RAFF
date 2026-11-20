// domain.js — pure business rules. No DOM, no storage, no network.
// Everything here is unit-tested (tests/run.mjs).

export const MOVEMENT = Object.freeze({ IN: 'in', OUT: 'out', DAMAGED: 'damaged', ADJUST: 'adjust' });
export const MOVEMENT_LABEL = Object.freeze({
  in: 'وارد', out: 'منصرف', damaged: 'هالك', adjust: 'تسوية جرد',
});
export const LIMITS = Object.freeze({
  qtyMax: 100000, nameMax: 80, categoryMax: 30, barcodeMax: 32,
  minStockMax: 100000, noteMax: 100, userMax: 40,
  shelfMax: Object.freeze({ d: 3650, m: 120, y: 10 }),
});

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}

/* ---------------------------------------------------------------- text */

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
export function toAsciiDigits(s) {
  return String(s).replace(ARABIC_DIGITS, (c) => {
    const code = c.charCodeAt(0);
    return String(code >= 0x06F0 ? code - 0x06F0 : code - 0x0660);
  });
}

// Strips control characters and bidi-override characters (anti-spoofing),
// collapses whitespace, enforces length.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;
export function cleanText(value, max, label, { required = false } = {}) {
  if (value == null) value = '';
  if (typeof value !== 'string') throw new ValidationError(`${label}: قيمة غير صالحة`);
  const s = value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (required && !s) throw new ValidationError(`${label} مطلوب`);
  if (s.length > max) throw new ValidationError(`${label} طويل جدًا (الحد ${max} حرف)`);
  return s;
}

export function toInt(value, { min, max, label }) {
  const s = toAsciiDigits(String(value ?? '')).trim();
  if (!/^-?\d+$/.test(s)) throw new ValidationError(`${label}: اكتب رقمًا صحيحًا`);
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new ValidationError(`${label}: لازم يكون بين ${min} و ${max}`);
  }
  return n;
}

/* ------------------------------------------------------------- barcode */

export function normalizeBarcode(raw) {
  const s = toAsciiDigits(String(raw ?? '')).trim();
  if (!/^[\x21-\x7E]{1,32}$/.test(s)) throw new ValidationError('الباركود غير صالح');
  return s;
}

export function ean13Check(body12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

// A carton (ITF-14) barcode wraps the retail EAN-13; UPC-A is EAN-13 with a leading 0.
// Returns every equivalent representation, most specific first.
export function barcodeCandidates(code) {
  const out = [code];
  if (/^\d+$/.test(code)) {
    if (code.length === 12) out.push('0' + code);
    if (code.length === 13 && code[0] === '0') out.push(code.slice(1));
    if (code.length === 14) {
      const body = code.slice(1, 13);
      const inner = body + ean13Check(body);
      out.push(inner);
      if (inner[0] === '0') out.push(inner.slice(1));
    }
  }
  return [...new Set(out)];
}

/* --------------------------------------------------------------- dates */

export function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const pad2 = (n) => String(n).padStart(2, '0');
function dayNum(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function fromUtc(dt) {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
export const diffDays = (a, b) => dayNum(a) - dayNum(b);
export const addDays = (s, n) => fromUtc(new Date((dayNum(s) + n) * 86400000));
export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad2(nm + 1)}-${pad2(Math.min(d, last))}`;
}
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function validateShelfLife(shelf) {
  if (shelf == null) return null;
  if (typeof shelf !== 'object' || !['d', 'm', 'y'].includes(shelf.unit)) {
    throw new ValidationError('مدة الصلاحية غير صالحة');
  }
  const value = toInt(shelf.value, { min: 1, max: LIMITS.shelfMax[shelf.unit], label: 'مدة الصلاحية' });
  return { value, unit: shelf.unit };
}

export function computeExpiry(receivedAt, shelf) {
  if (!shelf) return null;
  if (shelf.unit === 'd') return addDays(receivedAt, shelf.value);
  if (shelf.unit === 'm') return addMonths(receivedAt, shelf.value);
  return addMonths(receivedAt, shelf.value * 12);
}

export const DEFAULT_THRESHOLDS = Object.freeze({ warnDays: 30, critDays: 7 });

export function classifyExpiry(expiry, today, { warnDays, critDays } = DEFAULT_THRESHOLDS) {
  if (!expiry) return { status: 'none', daysLeft: null };
  const daysLeft = diffDays(expiry, today);
  let status = 'ok';
  if (daysLeft < 0) status = 'expired';
  else if (daysLeft <= critDays) status = 'critical';
  else if (daysLeft <= warnDays) status = 'soon';
  return { status, daysLeft };
}

/* ---------------------------------------------------------------- FEFO */

// First-Expired-First-Out: earliest expiry first; no-expiry batches last; ties by received date.
export function compareFefo(a, b) {
  if (a.expiry && b.expiry && a.expiry !== b.expiry) return a.expiry < b.expiry ? -1 : 1;
  if (a.expiry && !b.expiry) return -1;
  if (!a.expiry && b.expiry) return 1;
  if (a.receivedAt !== b.receivedAt) return a.receivedAt < b.receivedAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function allocateFefo(batches, qty) {
  const sorted = batches.filter((b) => b.qty > 0).sort(compareFefo);
  const allocs = [];
  let left = qty;
  for (const b of sorted) {
    if (left <= 0) break;
    const take = Math.min(b.qty, left);
    allocs.push({ batchId: b.id, qty: take, expiry: b.expiry });
    left -= take;
  }
  return { allocs, shortfall: left };
}

/* ----------------------------------------------------------- inventory */

export function buildInventory(products, batches, today, thresholds = DEFAULT_THRESHOLDS) {
  const byProduct = new Map();
  for (const b of batches) {
    if (b.qty <= 0) continue;
    if (!byProduct.has(b.productId)) byProduct.set(b.productId, []);
    byProduct.get(b.productId).push(b);
  }
  return products.map((product) => {
    const active = (byProduct.get(product.id) || []).sort(compareFefo);
    const stock = active.reduce((n, b) => n + b.qty, 0);
    const firstExp = active.find((b) => b.expiry);
    const expiry = classifyExpiry(firstExp ? firstExp.expiry : null, today, thresholds);
    return {
      product, stock, batches: active,
      nextExpiry: firstExp ? firstExp.expiry : null,
      expiry,
      low: product.minStock > 0 && stock <= product.minStock,
      out: stock === 0,
    };
  });
}

export function summarize(items) {
  let cartons = 0, low = 0, expiring = 0, expired = 0, withStock = 0;
  for (const it of items) {
    cartons += it.stock;
    if (it.stock > 0) withStock++;
    if (it.low) low++;
    if (it.expiry.status === 'expired') expired++;
    if (['expired', 'critical', 'soon'].includes(it.expiry.status)) expiring++;
  }
  return { cartons, products: items.length, withStock, low, expiring, expired };
}

export function expiryRows(items, today, thresholds = DEFAULT_THRESHOLDS) {
  const rows = [];
  for (const it of items) {
    for (const batch of it.batches) {
      if (!batch.expiry) continue;
      rows.push({ product: it.product, batch, ...classifyExpiry(batch.expiry, today, thresholds) });
    }
  }
  return rows.sort((a, b) => a.daysLeft - b.daysLeft);
}

/* ------------------------------------------------------------- CSV     */

// Cells that Excel/LibreOffice may interpret as formulas are neutralised.
// Numbers are written raw. A digits-only barcode is written as ="digits" so Excel
// keeps it as text instead of 6.22E+12 — safe because it is regex-validated first.
const FORMULA_START = /^[=+\-@\t\r]/;
export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (FORMULA_START.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
export function csvBarcode(code) {
  return /^\d{8,32}$/.test(code) ? rawCell(`="${code}"`) : code;
}
export function toCsv(rows) {
  return '﻿' + rows.map((r) => r.map((c) => (c && c.__raw ? c.__raw : csvCell(c))).join(',')).join('\r\n') + '\r\n';
}
export const rawCell = (__raw) => ({ __raw });
