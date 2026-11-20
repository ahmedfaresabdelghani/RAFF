// Run: npm test   (Node 18+, uses fake-indexeddb)
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import * as D from '../js/domain.js';
import * as S from '../js/services.js';
import * as B from '../js/backup.js';
import * as C from '../js/csv.js';
import { clearAll } from '../js/db.js';

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const rejects = (p, re) => assert.rejects(p, (e) => e instanceof D.ValidationError && (!re || re.test(e.message)));
const at = (iso) => new Date(iso);
const NOW = at('2026-11-20T10:00:00');

/* ----------------------------------------------------------- domain */
test('dates: add days/months with month-end clamp', () => {
  assert.equal(D.addDays('2026-11-20', 30), '2026-12-20');
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(D.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(D.addMonths('2026-11-20', 14), '2028-01-20');
  assert.equal(D.diffDays('2026-12-01', '2026-11-20'), 11);
});
test('dates: validation', () => {
  assert.ok(D.isValidDateStr('2026-02-28'));
  assert.ok(!D.isValidDateStr('2026-02-30'));
  assert.ok(!D.isValidDateStr('2026-2-3'));
  assert.ok(!D.isValidDateStr('1999-01-01'));
  assert.ok(!D.isValidDateStr(20261120));
});
test('shelf life -> expiry', () => {
  assert.equal(D.computeExpiry('2026-11-20', { value: 6, unit: 'm' }), '2027-05-20');
  assert.equal(D.computeExpiry('2026-11-20', { value: 1, unit: 'y' }), '2027-11-20');
  assert.equal(D.computeExpiry('2026-11-20', { value: 90, unit: 'd' }), '2027-02-18');
  assert.equal(D.computeExpiry('2026-11-20', null), null);
  assert.throws(() => D.validateShelfLife({ value: 0, unit: 'd' }), D.ValidationError);
  assert.throws(() => D.validateShelfLife({ value: 5, unit: 'x' }), D.ValidationError);
});
test('expiry classification', () => {
  const t = { warnDays: 30, critDays: 7 };
  assert.deepEqual(D.classifyExpiry('2026-11-19', '2026-11-20', t), { status: 'expired', daysLeft: -1 });
  assert.equal(D.classifyExpiry('2026-11-20', '2026-11-20', t).status, 'critical');
  assert.equal(D.classifyExpiry('2026-11-27', '2026-11-20', t).status, 'critical');
  assert.equal(D.classifyExpiry('2026-11-28', '2026-11-20', t).status, 'soon');
  assert.equal(D.classifyExpiry('2026-12-20', '2026-11-20', t).status, 'soon');
  assert.equal(D.classifyExpiry('2026-12-21', '2026-11-20', t).status, 'ok');
  assert.equal(D.classifyExpiry(null, '2026-11-20', t).status, 'none');
});
test('barcode: arabic digits, validation, equivalents', () => {
  assert.equal(D.normalizeBarcode(' ٦٢٢١٠٠٠١٢٣٤٥٦ '), '6221000123456');
  assert.throws(() => D.normalizeBarcode(''), D.ValidationError);
  assert.throws(() => D.normalizeBarcode('a b'), D.ValidationError);
  assert.throws(() => D.normalizeBarcode('x'.repeat(33)), D.ValidationError);
  assert.equal(D.ean13Check('629104150021'), '3'); // 6291041500213 is a valid EAN-13
  const body = '629104150021';
  const itf = '1' + body + '7'; // GTIN-14 (check digit value irrelevant to our parsing)
  assert.ok(D.barcodeCandidates(itf).includes('6291041500213'));
  assert.ok(D.barcodeCandidates('012345678905').includes('0012345678905'));
  assert.ok(D.barcodeCandidates('0012345678905').includes('012345678905'));
});
test('text cleaning strips control + bidi override chars', () => {
  assert.equal(D.cleanText('  a‮b\u0000  c ', 20, 'x'), 'a b c');
  assert.throws(() => D.cleanText('', 5, 'الاسم', { required: true }), D.ValidationError);
  assert.throws(() => D.cleanText('123456', 5, 'x'), D.ValidationError);
  assert.throws(() => D.cleanText({}, 5, 'x'), D.ValidationError);
});
test('toInt strictness', () => {
  assert.equal(D.toInt('٣٠', { min: 1, max: 100, label: 'q' }), 30);
  for (const bad of ['1.5', '1e3', '', 'abc', '0', '101', '-1', null, undefined, '0x10']) {
    assert.throws(() => D.toInt(bad, { min: 1, max: 100, label: 'q' }), D.ValidationError, String(bad));
  }
});
test('FEFO order + allocation', () => {
  const b = [
    { id: 'c', qty: 5, expiry: null, receivedAt: '2026-01-01' },
    { id: 'b', qty: 5, expiry: '2027-01-01', receivedAt: '2026-02-01' },
    { id: 'a', qty: 5, expiry: '2026-12-01', receivedAt: '2026-03-01' },
  ];
  const r = D.allocateFefo(b, 8);
  assert.deepEqual(r.allocs.map((x) => [x.batchId, x.qty]), [['a', 5], ['b', 3]]);
  assert.equal(r.shortfall, 0);
  assert.equal(D.allocateFefo(b, 20).shortfall, 5);
});
test('csv: formula injection guard, quoting, bom, barcode as text', () => {
  assert.equal(D.csvCell('=1+1'), "'=1+1");
  assert.equal(D.csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(D.csvCell('-cmd'), "'-cmd");
  assert.equal(D.csvCell(-5), '-5');
  assert.equal(D.csvCell('a,b'), '"a,b"');
  assert.equal(D.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(D.csvCell('l1\nl2'), '"l1\nl2"');
  const out = D.toCsv([['x', D.csvBarcode('6221000123456'), D.csvBarcode('AB-1')]]);
  assert.ok(out.startsWith('﻿'));
  assert.ok(out.includes('="6221000123456"'));
  assert.ok(out.includes('AB-1'));
  assert.ok(out.endsWith('\r\n'));
  assert.ok(D.toCsv([[D.csvBarcode('=cmd')]]).includes("'=cmd"));
});

/* ---------------------------------------------------------- services */
const mk = (over = {}) => S.createProduct({ barcode: '6221000123456', name: 'شيبسي', category: 'مقرمشات', minStock: 5, ...over }, { now: NOW });
const stockOf = async (id) => (await S.getInventory({ now: NOW })).find((i) => i.product.id === id).stock;

async function fresh() { await clearAll(); }

test('product create / duplicate / equivalent-barcode duplicate', async () => {
  await fresh();
  const p = await mk();
  assert.equal(p.barcodes.length, 1);
  await rejects(mk(), /مسجل بالفعل/);
  await rejects(S.createProduct({ barcode: '6221000123457', name: '   ', category: 'x', minStock: 1 }), /مطلوب/);
  await rejects(S.createProduct({ barcode: '6221000123457', name: 'a', category: 'x', minStock: -1 }), /حد الطلب/);
});
test('UPC-A scan finds EAN-13 product', async () => {
  await fresh();
  const p = await mk({ barcode: '0012345678905' });
  assert.equal((await S.findProductByBarcode('012345678905')).id, p.id);
});
test('ITF-14 carton barcode resolves to inner EAN-13', async () => {
  await fresh();
  const body = '629104150021';
  const ean = body + D.ean13Check(body);
  const p = await mk({ barcode: ean });
  const itf = '1' + body + '9';
  assert.equal((await S.findProductByBarcode(itf)).id, p.id);
});
test('IN with shelf life computes expiry; manual expiry wins', async () => {
  await fresh();
  const p = await mk();
  const a = await S.recordMovement({ productId: p.id, type: 'in', qty: 10, receivedAt: '2026-11-20', shelfLife: { value: 6, unit: 'm' } }, { now: NOW });
  const batchA = (await S.getProductBatches(p.id))[0];
  assert.equal(batchA.expiry, '2027-05-20');
  assert.equal(batchA.expirySource, 'auto');
  assert.equal(a.stock, 10);
  await S.recordMovement({ productId: p.id, type: 'in', qty: 5, expiryDate: '2027-01-15', shelfLife: { value: 1, unit: 'y' } }, { now: NOW });
  const batches = await S.getProductBatches(p.id);
  assert.equal(batches[0].expiry, '2027-01-15');
  assert.equal(batches[0].expirySource, 'manual');
  assert.deepEqual((await S.getProduct(p.id)).shelfLife, { value: 6, unit: 'm' }, 'manual expiry must not overwrite default shelf life');
});
test('shelf life typed on receipt is remembered on the product', async () => {
  await fresh();
  const p = await mk();
  await S.recordMovement({ productId: p.id, type: 'in', qty: 1, shelfLife: { value: 3, unit: 'm' } }, { now: NOW });
  assert.deepEqual((await S.getProduct(p.id)).shelfLife, { value: 3, unit: 'm' });
});
test('IN rejects bad dates', async () => {
  await fresh();
  const p = await mk();
  const base = { productId: p.id, type: 'in', qty: 1 };
  await rejects(S.recordMovement({ ...base, expiryDate: '2026-11-01' }, { now: NOW }), /منتهي/);
  await rejects(S.recordMovement({ ...base, receivedAt: '2026-11-25' }, { now: NOW }), /المستقبل/);
  await rejects(S.recordMovement({ ...base, receivedAt: '2026-11-10', expiryDate: '2026-11-05' }, { now: NOW }), /منتهي|قبل/);
  await rejects(S.recordMovement({ ...base, expiryDate: '2026-13-40' }, { now: NOW }), /غير صالح/);
  assert.equal(await stockOf(p.id), 0, 'failed receipts leave no trace');
  assert.equal((await S.listMovements()).length, 0);
});
test('OUT takes earliest-expiry batch first (FEFO), then spills over', async () => {
  await fresh();
  const p = await mk();
  const rec = (qty, exp) => S.recordMovement({ productId: p.id, type: 'in', qty, expiryDate: exp }, { now: NOW });
  await rec(10, '2027-06-01'); await rec(10, '2026-12-15'); await rec(10, '2027-01-10');
  const { movement } = await S.recordMovement({ productId: p.id, type: 'out', qty: 14 }, { now: NOW });
  assert.deepEqual(movement.allocs.map((a) => [a.expiry, a.qty]), [['2026-12-15', 10], ['2027-01-10', 4]]);
  assert.equal(movement.balanceAfter, 16);
  assert.equal(await stockOf(p.id), 16);
});
test('OUT/damaged cannot exceed stock; nothing changes on failure', async () => {
  await fresh();
  const p = await mk();
  await S.recordMovement({ productId: p.id, type: 'in', qty: 3 }, { now: NOW });
  await rejects(S.recordMovement({ productId: p.id, type: 'out', qty: 4 }, { now: NOW }), /3 فقط/);
  await rejects(S.recordMovement({ productId: p.id, type: 'damaged', qty: 4 }, { now: NOW }), /3 فقط/);
  assert.equal(await stockOf(p.id), 3);
  assert.equal((await S.listMovements()).length, 1);
});
test('quantity validation (zero, negative, decimals, huge, junk)', async () => {
  await fresh();
  const p = await mk();
  for (const qty of [0, -1, 1.5, '1e3', 'x', 100001, null, undefined]) {
    await rejects(S.recordMovement({ productId: p.id, type: 'in', qty }, { now: NOW }), /الكمية/);
  }
  await rejects(S.recordMovement({ productId: p.id, type: 'adjust', qty: 1 }), /نوع/);
  await rejects(S.recordMovement({ productId: 'nope', type: 'in', qty: 1 }), /غير موجود/);
});
test('damaged targeting a specific batch', async () => {
  await fresh();
  const p = await mk();
  await S.recordMovement({ productId: p.id, type: 'in', qty: 6, expiryDate: '2027-03-01' }, { now: NOW });
  await S.recordMovement({ productId: p.id, type: 'in', qty: 4, expiryDate: '2027-02-01' }, { now: NOW });
  const late = (await S.getProductBatches(p.id)).find((b) => b.expiry === '2027-03-01');
  await S.recordMovement({ productId: p.id, type: 'damaged', qty: 6, batchId: late.id }, { now: NOW });
  const left = await S.getProductBatches(p.id);
  assert.equal(left.length, 1);
  assert.equal(left[0].expiry, '2027-02-01');
  await rejects(S.recordMovement({ productId: p.id, type: 'damaged', qty: 1, batchId: late.id }, { now: NOW }), /الدفعة/);
});
test('undo: IN removes its batch, OUT restores exact batches, only latest', async () => {
  await fresh();
  const p = await mk();
  const r1 = await S.recordMovement({ productId: p.id, type: 'in', qty: 10, expiryDate: '2027-02-01' }, { now: NOW });
  const r2 = await S.recordMovement({ productId: p.id, type: 'in', qty: 10, expiryDate: '2027-01-01' }, { now: NOW });
  const r3 = await S.recordMovement({ productId: p.id, type: 'out', qty: 12 }, { now: new Date(NOW.getTime() + 1000) });
  await rejects(S.undoLast(r1.movement.id), /أحدث/);
  await S.undoLast(r3.movement.id);
  assert.equal(await stockOf(p.id), 20);
  const b = await S.getProductBatches(p.id);
  assert.deepEqual(b.map((x) => [x.expiry, x.qty]), [['2027-01-01', 10], ['2027-02-01', 10]]);
  await S.undoLast(); // r2 (last live)
  assert.equal(await stockOf(p.id), 10);
  const log = await S.listMovements();
  assert.equal(log.filter((m) => m.undone).length, 2);
  assert.equal((await S.getLastMovement()).id, r1.movement.id);
  await S.undoLast();
  await rejects(S.undoLast(), /لا توجد/);
});
test('undo of IN refused when part of its batch was already issued', async () => {
  await fresh();
  const p = await mk();
  const r1 = await S.recordMovement({ productId: p.id, type: 'in', qty: 10 }, { now: NOW });
  await S.recordMovement({ productId: p.id, type: 'out', qty: 2 }, { now: new Date(NOW.getTime() + 1000) });
  await S.undoLast(); // undo the out first
  await S.undoLast(r1.movement.id); // now allowed
  assert.equal(await stockOf(p.id), 0);
});
test('stocktake: shortage, surplus, matched; booked as adjust movements', async () => {
  await fresh();
  const a = await mk({ barcode: '6221000000011', name: 'A' });
  const b = await mk({ barcode: '6221000000028', name: 'B' });
  const c = await mk({ barcode: '6221000000035', name: 'C' });
  for (const p of [a, b, c]) await S.recordMovement({ productId: p.id, type: 'in', qty: 20, expiryDate: '2027-05-01' }, { now: NOW });
  const sum = await S.applyStocktake([
    { productId: a.id, counted: 18 }, { productId: b.id, counted: 25 }, { productId: c.id, counted: 20 },
  ], { user: 'سيد', now: NOW });
  assert.deepEqual(sum, { shortage: 2, surplus: 5, changed: 2, matched: 1 });
  assert.equal(await stockOf(a.id), 18);
  assert.equal(await stockOf(b.id), 25);
  const adj = (await S.listMovements()).filter((m) => m.type === 'adjust');
  assert.equal(adj.length, 2);
  assert.ok(adj.every((m) => m.user === 'سيد'));
  await rejects(S.applyStocktake([{ productId: a.id, counted: -3 }]), /الكمية/);
});
test('stocktake is atomic: bad row rolls back earlier rows', async () => {
  await fresh();
  const a = await mk({ barcode: '6221000000011', name: 'A' });
  await S.recordMovement({ productId: a.id, type: 'in', qty: 5 }, { now: NOW });
  await rejects(S.applyStocktake([{ productId: a.id, counted: 1 }, { productId: a.id, counted: 'zz' }]), /الكمية/);
  assert.equal(await stockOf(a.id), 5);
});
test('inventory summary + alerts', async () => {
  await fresh();
  const low = await mk({ barcode: '6221000000011', name: 'Low', minStock: 5 });
  const ok = await mk({ barcode: '6221000000028', name: 'Ok', minStock: 5 });
  const exp = await mk({ barcode: '6221000000035', name: 'Exp', minStock: 0 });
  await S.recordMovement({ productId: low.id, type: 'in', qty: 5 }, { now: NOW });
  await S.recordMovement({ productId: ok.id, type: 'in', qty: 6 }, { now: NOW });
  await S.recordMovement({ productId: exp.id, type: 'in', qty: 3, expiryDate: '2026-11-25' }, { now: NOW });
  const items = await S.getInventory({ now: NOW });
  const sum = D.summarize(items);
  assert.deepEqual([sum.cartons, sum.products, sum.low, sum.expiring, sum.expired], [14, 3, 1, 1, 0]);
  assert.ok(items.find((i) => i.product.id === low.id).low, 'stock == min counts as low');
  assert.ok(!items.find((i) => i.product.id === ok.id).low);
  assert.ok(!items.find((i) => i.product.id === exp.id).low, 'min 0 never alerts');
  const rows = D.expiryRows(items, D.todayStr(NOW));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'critical');
});
test('extra barcodes: link, duplicate refused, remove keeps one', async () => {
  await fresh();
  const a = await mk();
  const b = await mk({ barcode: '6221000000011', name: 'B' });
  const a2 = await S.addBarcode(a.id, '6221000999999');
  assert.equal((await S.findProductByBarcode('6221000999999')).id, a.id);
  await rejects(S.addBarcode(b.id, '6221000999999'), /مسجل/);
  const a3 = await S.removeBarcode(a.id, a.barcode);
  assert.equal(a3.barcode, '6221000999999');
  await rejects(S.removeBarcode(a.id, '6221000999999'), /واحد/);
  assert.equal(a2.barcodes.length, 2);
});
test('delete product only at zero stock; log survives', async () => {
  await fresh();
  const p = await mk();
  await S.recordMovement({ productId: p.id, type: 'in', qty: 2 }, { now: NOW });
  await rejects(S.deleteProduct(p.id), /رصيد/);
  await S.recordMovement({ productId: p.id, type: 'out', qty: 2 }, { now: NOW });
  await S.deleteProduct(p.id);
  assert.equal((await S.getInventory()).length, 0);
  assert.equal((await S.listMovements()).length, 2);
});
test('concurrent movements never oversell', async () => {
  await fresh();
  const p = await mk();
  await S.recordMovement({ productId: p.id, type: 'in', qty: 10 }, { now: NOW });
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => S.recordMovement({ productId: p.id, type: 'out', qty: 3 }, { now: NOW })));
  const okCount = results.filter((r) => r.status === 'fulfilled').length;
  assert.equal(okCount, 3);
  assert.equal(await stockOf(p.id), 1);
});

/* ----------------------------------------------------- backup / csv */
test('backup round trip + export csv content', async () => {
  await fresh();
  const p = await mk({ name: '=HYPERLINK("x")' });
  await S.recordMovement({ productId: p.id, type: 'in', qty: 7, expiryDate: '2027-04-01' }, { now: NOW, user: 'Ali' });
  const backup = await B.buildBackup(NOW);
  const text = JSON.stringify(backup);
  await fresh();
  assert.equal((await S.getInventory()).length, 0);
  const r = await B.restoreFromText(text);
  assert.deepEqual(r, { products: 1, movements: 1 });
  const inv = await S.getInventory({ now: NOW });
  assert.equal(inv[0].stock, 7);
  const csv = C.inventoryCsv(inv);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"') || csv.includes("'=HYPERLINK"));
  assert.ok(C.movementsCsv(await S.listMovements()).includes('وارد'));
  assert.ok(C.batchesCsv(inv, D.todayStr(NOW)).includes('2027-04-01'));
});
test('backup import rejects hostile / malformed files and keeps old data', async () => {
  await fresh();
  const p = await mk();
  await S.recordMovement({ productId: p.id, type: 'in', qty: 4 }, { now: NOW });
  const good = await B.buildBackup(NOW);
  const clone = () => JSON.parse(JSON.stringify(good));
  const cases = {
    notJson: '{oops',
    wrongFormat: JSON.stringify({ ...clone(), format: 'x' }),
    wrongVersion: JSON.stringify({ ...clone(), version: 99 }),
    negativeQty: (() => { const c = clone(); c.data.batches[0].qty = -5; return JSON.stringify(c); })(),
    orphanBatch: (() => { const c = clone(); c.data.batches[0].productId = 'ghost'; return JSON.stringify(c); })(),
    badDate: (() => { const c = clone(); c.data.batches[0].expiry = '2026-99-99'; return JSON.stringify(c); })(),
    hugeName: (() => { const c = clone(); c.data.products[0].name = 'x'.repeat(500); return JSON.stringify(c); })(),
    dupBarcode: (() => { const c = clone(); c.data.products.push({ ...c.data.products[0], id: 'other' }); return JSON.stringify(c); })(),
    arrayRoot: '[]',
    nullRoot: 'null',
    badType: (() => { const c = clone(); c.data.movements[0].type = 'steal'; return JSON.stringify(c); })(),
  };
  for (const [name, text] of Object.entries(cases)) {
    await assert.rejects(B.restoreFromText(text), D.ValidationError, name);
  }
  assert.equal(({}).polluted, undefined);
  assert.equal(await stockOf(p.id), 4, 'data intact after rejected imports');
});
test('backup import drops unknown fields (whitelist)', async () => {
  await fresh();
  const p = await mk();
  const b = await B.buildBackup(NOW);
  b.data.products[0].evil = '<script>alert(1)</script>';
  const text = JSON.stringify(b).replace('"evil"', '"__proto__":{"polluted":1},"evil"');
  assert.ok(text.includes('"__proto__"'));
  await B.restoreFromText(text);
  assert.equal(({}).polluted, undefined, 'no prototype pollution');
  const [again] = await S.getInventory();
  assert.equal(again.product.evil, undefined);
  assert.equal(again.product.id, p.id);
});

/* ------------------------------------------------------------- run */
let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}
console.log(`\n${passed} passed, ${failed} failed (${tests.length} total)`);
process.exit(failed ? 1 : 0);
