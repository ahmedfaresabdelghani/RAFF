// services.js — business operations. Every write happens inside ONE storage
// transaction, so a movement, its batch changes and the audit record are all-or-nothing.

import {
  MOVEMENT, LIMITS, ValidationError, cleanText, toInt, normalizeBarcode, barcodeCandidates,
  isValidDateStr, todayStr, validateShelfLife, computeExpiry, allocateFefo, compareFefo,
  buildInventory, DEFAULT_THRESHOLDS,
} from './domain.js';
import { transact, newId } from './db.js';

/* ------------------------------------------------------------ products */

async function findByCode(t, code) {
  for (const c of barcodeCandidates(code)) {
    const hit = (await t.byIndex('products', 'barcodes', c))[0];
    if (hit) return hit;
  }
  return null;
}

export function findProductByBarcode(raw) {
  const code = normalizeBarcode(raw);
  return transact(['products'], 'readonly', (t) => findByCode(t, code));
}

export function getProduct(id) {
  return transact(['products'], 'readonly', (t) => t.get('products', id));
}

function readProductFields(input) {
  return {
    name: cleanText(input.name, LIMITS.nameMax, 'اسم الصنف', { required: true }),
    category: cleanText(input.category, LIMITS.categoryMax, 'التصنيف') || 'أخرى',
    minStock: toInt(input.minStock ?? 0, { min: 0, max: LIMITS.minStockMax, label: 'حد الطلب' }),
    shelfLife: validateShelfLife(input.shelfLife ?? null),
  };
}

export async function createProduct(input, { now = new Date() } = {}) {
  const barcode = normalizeBarcode(input.barcode);
  const fields = readProductFields(input);
  return transact(['products'], 'readwrite', async (t) => {
    const dup = await findByCode(t, barcode);
    if (dup) throw new ValidationError(`الباركود مسجل بالفعل للصنف: ${dup.name}`);
    const ts = now.toISOString();
    const product = { id: newId(), barcode, barcodes: [barcode], ...fields, createdAt: ts, updatedAt: ts };
    await t.put('products', product);
    return product;
  });
}

export async function updateProduct(id, input, { now = new Date() } = {}) {
  const fields = readProductFields(input);
  return transact(['products'], 'readwrite', async (t) => {
    const p = await t.get('products', id);
    if (!p) throw new ValidationError('الصنف غير موجود');
    const next = { ...p, ...fields, updatedAt: now.toISOString() };
    await t.put('products', next);
    return next;
  });
}

// A product can carry several barcodes (carton redesign, supplier change, ITF-14 vs EAN-13).
export function addBarcode(id, raw, { now = new Date() } = {}) {
  const code = normalizeBarcode(raw);
  return transact(['products'], 'readwrite', async (t) => {
    const p = await t.get('products', id);
    if (!p) throw new ValidationError('الصنف غير موجود');
    const dup = await findByCode(t, code);
    if (dup && dup.id !== id) throw new ValidationError(`الباركود مسجل بالفعل للصنف: ${dup.name}`);
    if (p.barcodes.includes(code)) return p;
    if (p.barcodes.length >= 10) throw new ValidationError('الحد الأقصى 10 باركودات للصنف');
    const next = { ...p, barcodes: [...p.barcodes, code], updatedAt: now.toISOString() };
    await t.put('products', next);
    return next;
  });
}

export function removeBarcode(id, code, { now = new Date() } = {}) {
  return transact(['products'], 'readwrite', async (t) => {
    const p = await t.get('products', id);
    if (!p) throw new ValidationError('الصنف غير موجود');
    if (p.barcodes.length <= 1) throw new ValidationError('لازم يفضل باركود واحد على الأقل');
    const barcodes = p.barcodes.filter((c) => c !== code);
    const next = { ...p, barcodes, barcode: barcodes.includes(p.barcode) ? p.barcode : barcodes[0], updatedAt: now.toISOString() };
    await t.put('products', next);
    return next;
  });
}

export function deleteProduct(id) {
  return transact(['products', 'batches'], 'readwrite', async (t) => {
    const batches = await t.byIndex('batches', 'productId', id);
    if (batches.some((b) => b.qty > 0)) throw new ValidationError('لا يمكن حذف صنف له رصيد. صفّر الرصيد أولًا');
    for (const b of batches) await t.del('batches', b.id);
    await t.del('products', id);
  });
}

/* ----------------------------------------------------------- inventory */

export function getInventory({ now = new Date(), thresholds = DEFAULT_THRESHOLDS } = {}) {
  return transact(['products', 'batches'], 'readonly', async (t) => {
    const [products, batches] = await Promise.all([t.getAll('products'), t.getAll('batches')]);
    return buildInventory(products, batches, todayStr(now), thresholds);
  });
}

export function getProductBatches(productId) {
  return transact(['batches'], 'readonly', async (t) =>
    (await t.byIndex('batches', 'productId', productId)).filter((b) => b.qty > 0).sort(compareFefo));
}

/* ----------------------------------------------------------- movements */

async function sumStock(t, productId) {
  const batches = await t.byIndex('batches', 'productId', productId);
  return { batches, stock: batches.reduce((n, b) => n + b.qty, 0) };
}

// Strictly increasing timestamps (ms) so "the latest movement" is never ambiguous.
let lastTs = 0;
function nextTs(now) {
  lastTs = Math.max(now.getTime(), lastTs + 1);
  return new Date(lastTs).toISOString();
}

// Core mutation. `direction` is 'in' or 'out'; `type` is what the audit log shows.
async function execute(t, product, spec, ctx) {
  const { type, direction, qty } = spec;
  const now = ctx.now || new Date();
  const today = todayStr(now);
  const { batches, stock } = await sumStock(t, product.id);
  const movement = {
    id: newId(), ts: nextTs(now), productId: product.id, productName: product.name,
    barcode: product.barcode, type, qty, delta: direction === 'in' ? qty : -qty,
    balanceAfter: 0, allocs: [], createdBatchId: null,
    user: ctx.user || '', note: spec.note || '', undone: false,
  };

  if (direction === 'in') {
    const receivedAt = spec.receivedAt || today;
    if (!isValidDateStr(receivedAt)) throw new ValidationError('تاريخ الدخول غير صالح');
    if (receivedAt > today) throw new ValidationError('تاريخ الدخول في المستقبل');
    let expiry = null;
    let source = null;
    if (spec.expiryDate) {
      if (!isValidDateStr(spec.expiryDate)) throw new ValidationError('تاريخ الانتهاء غير صالح');
      expiry = spec.expiryDate; source = 'manual';
    } else if (spec.shelfLife) {
      expiry = computeExpiry(receivedAt, spec.shelfLife); source = 'auto';
    }
    if (expiry) {
      if (expiry < today && type === MOVEMENT.IN) throw new ValidationError('الصنف منتهي الصلاحية بالفعل');
      if (expiry < receivedAt) throw new ValidationError('تاريخ الانتهاء قبل تاريخ الدخول');
    }
    const batch = {
      id: newId(), productId: product.id, qty, qtyIn: qty, receivedAt, expiry,
      expirySource: source, createdAt: movement.ts,
    };
    await t.put('batches', batch);
    movement.createdBatchId = batch.id;
    movement.allocs = [{ batchId: batch.id, qty, expiry }];
  } else {
    let allocs;
    if (spec.batchId) {
      const b = batches.find((x) => x.id === spec.batchId);
      if (!b || b.qty < qty) throw new ValidationError(`الكمية المتاحة في هذه الدفعة ${b ? b.qty : 0} فقط`);
      allocs = [{ batchId: b.id, qty, expiry: b.expiry }];
    } else {
      if (qty > stock) throw new ValidationError(`الرصيد المتاح ${stock} فقط`);
      allocs = allocateFefo(batches, qty).allocs;
    }
    for (const a of allocs) {
      const b = batches.find((x) => x.id === a.batchId);
      await t.put('batches', { ...b, qty: b.qty - a.qty });
    }
    movement.allocs = allocs;
  }
  movement.balanceAfter = stock + movement.delta;
  await t.put('movements', movement);
  return movement;
}

export async function recordMovement(input, ctx = {}) {
  if (![MOVEMENT.IN, MOVEMENT.OUT, MOVEMENT.DAMAGED].includes(input.type)) {
    throw new ValidationError('نوع الحركة غير صالح');
  }
  const qty = toInt(input.qty, { min: 1, max: LIMITS.qtyMax, label: 'الكمية' });
  const user = cleanText(ctx.user ?? '', LIMITS.userMax, 'اسم الموظف');
  const note = cleanText(input.note ?? '', LIMITS.noteMax, 'الملاحظة');
  const shelfLife = validateShelfLife(input.shelfLife ?? null);
  return transact(['products', 'batches', 'movements'], 'readwrite', async (t) => {
    const product = await t.get('products', input.productId);
    if (!product) throw new ValidationError('الصنف غير موجود');
    const movement = await execute(t, product, {
      type: input.type, direction: input.type === MOVEMENT.IN ? 'in' : 'out', qty, note,
      receivedAt: input.receivedAt, expiryDate: input.expiryDate || null, shelfLife,
      batchId: input.batchId || null,
    }, { user, now: ctx.now });
    // Remember the shelf life the user typed so next delivery is one tap.
    if (input.type === MOVEMENT.IN && shelfLife && !input.expiryDate) {
      const cur = product.shelfLife;
      if (!cur || cur.value !== shelfLife.value || cur.unit !== shelfLife.unit) {
        await t.put('products', { ...product, shelfLife, updatedAt: movement.ts });
      }
    }
    return { movement, stock: movement.balanceAfter };
  });
}

export function listMovements({ limit = 200, productId = null } = {}) {
  return transact(['movements'], 'readonly', (t) =>
    t.newest('movements', 'ts', limit, productId ? (m) => m.productId === productId : () => true));
}

export function getLastMovement() {
  return transact(['movements'], 'readonly', (t) => t.findLast('movements', 'ts', (m) => !m.undone));
}

// Only the most recent live movement can be undone — this keeps batch quantities provably consistent.
export function undoLast(expectedId = null) {
  return transact(['products', 'batches', 'movements'], 'readwrite', async (t) => {
    const m = await t.findLast('movements', 'ts', (x) => !x.undone);
    if (!m) throw new ValidationError('لا توجد حركة للتراجع عنها');
    if (expectedId && m.id !== expectedId) throw new ValidationError('تم تسجيل حركة أحدث، لا يمكن التراجع عن هذه');
    if (m.delta > 0) {
      const batch = await t.get('batches', m.createdBatchId);
      if (!batch || batch.qty !== batch.qtyIn) throw new ValidationError('لا يمكن التراجع: الدفعة تم صرف جزء منها');
      await t.del('batches', batch.id);
    } else {
      for (const a of m.allocs) {
        const b = await t.get('batches', a.batchId);
        if (!b) throw new ValidationError('لا يمكن التراجع: الدفعة محذوفة');
        await t.put('batches', { ...b, qty: b.qty + a.qty });
      }
    }
    await t.put('movements', { ...m, undone: true });
    return m;
  });
}

/* ----------------------------------------------------------- stocktake */

// counts: [{ productId, counted }] — books the difference as 'adjust' movements, atomically.
export async function applyStocktake(counts, ctx = {}) {
  const user = cleanText(ctx.user ?? '', LIMITS.userMax, 'اسم الموظف');
  const clean = counts.map((c) => ({
    productId: String(c.productId),
    counted: toInt(c.counted, { min: 0, max: LIMITS.qtyMax, label: 'الكمية المعدودة' }),
  }));
  return transact(['products', 'batches', 'movements'], 'readwrite', async (t) => {
    const summary = { shortage: 0, surplus: 0, changed: 0, matched: 0 };
    for (const c of clean) {
      const product = await t.get('products', c.productId);
      if (!product) continue;
      const { stock } = await sumStock(t, product.id);
      const diff = c.counted - stock;
      if (diff === 0) { summary.matched++; continue; }
      await execute(t, product, {
        type: MOVEMENT.ADJUST, direction: diff > 0 ? 'in' : 'out', qty: Math.abs(diff), note: 'تسوية جرد',
      }, { user, now: ctx.now });
      summary.changed++;
      if (diff > 0) summary.surplus += diff; else summary.shortage += -diff;
    }
    return summary;
  });
}

/* ------------------------------------------------- stocktake session  */

export function loadStocktake() {
  return transact(['meta'], 'readonly', async (t) => (await t.get('meta', 'stocktake'))?.value || null);
}
export function saveStocktake(session) {
  return transact(['meta'], 'readwrite', (t) => t.put('meta', { key: 'stocktake', value: session }));
}
export function clearStocktake() {
  return transact(['meta'], 'readwrite', (t) => t.del('meta', 'stocktake'));
}
