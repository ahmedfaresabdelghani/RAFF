// demo.js — realistic sample data for sales demos (generic product names, relative dates).
import { createProduct, recordMovement } from './services.js';
import { ean13Check } from './domain.js';

const bc = (n) => { const body = `622100${String(n).padStart(6, '0')}`; return body + ean13Check(body); };

// [name, category, minStock, shelfLife, [[daysAgoReceived, qty, expiryInDays|null]...], [[daysAgo, outQty]...]]
const DATA = [
  ['مشروب غازي كولا 330 مل (24 علبة)', 'مشروبات', 20, { value: 12, unit: 'm' }, [[40, 60, 300], [10, 40, 330]], [[30, 25], [12, 18], [3, 20]]],
  ['مياه معدنية 600 مل (12 زجاجة)', 'مشروبات', 15, { value: 2, unit: 'y' }, [[25, 50, 700]], [[20, 10], [8, 15], [2, 8]]],
  ['بطاطس شيبس عائلي (24 كيس)', 'مقرمشات', 10, { value: 6, unit: 'm' }, [[60, 30, 120], [5, 30, 175]], [[40, 12], [15, 10], [1, 10]]],
  ['لبن كامل الدسم 1 لتر (12 علبة)', 'ألبان', 12, { value: 3, unit: 'm' }, [[80, 20, -6], [14, 30, 5], [4, 40, 85]], [[60, 6], [10, 14], [2, 12]]],
  ['زبادي طبيعي 105 جم (24 كوب)', 'ألبان', 8, { value: 45, unit: 'd' }, [[20, 18, 12], [3, 20, 42]], [[8, 6], [1, 10]]],
  ['عصير مانجو 1 لتر (12 علبة)', 'مشروبات', 10, { value: 9, unit: 'm' }, [[50, 25, 22], [6, 20, 260]], [[30, 10], [5, 12]]],
  ['مسحوق غسيل 3 كجم (4 عبوات)', 'منظفات', 6, null, [[35, 15, null]], [[20, 5], [7, 6]]],
  ['سائل أطباق 1 لتر (12 زجاجة)', 'منظفات', 8, null, [[28, 14, null]], [[18, 3], [6, 4]]],
  ['زيت طعام 1 لتر (12 زجاجة)', 'زيوت وسمن', 10, { value: 18, unit: 'm' }, [[45, 20, 500]], [[30, 6], [10, 8]]],
  ['مكرونة 400 جم (20 كيس)', 'مكرونة وأرز', 10, { value: 2, unit: 'y' }, [[30, 40, 680]], [[15, 12], [4, 10]]],
  ['أرز مصري 1 كجم (12 كيس)', 'مكرونة وأرز', 10, { value: 1, unit: 'y' }, [[22, 30, 340]], [[12, 8], [2, 6]]],
  ['فول معلب 400 جم (24 علبة)', 'معلبات', 8, { value: 2, unit: 'y' }, [[55, 20, 20], [9, 25, 700]], [[30, 6], [6, 10]]],
  ['بسكويت شاي (36 عبوة)', 'حلويات وبسكويت', 6, { value: 8, unit: 'm' }, [[33, 24, 210]], [[20, 8], [5, 7]]],
  ['شامبو 400 مل (12 زجاجة)', 'عناية شخصية', 5, null, [[26, 12, null]], [[14, 4], [3, 3]]],
];

const dayStart = (daysAgo, hour = 9) => { const d = new Date(); d.setHours(hour, 0, 0, 0); d.setDate(d.getDate() - daysAgo); return d; };
const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function loadDemoData(user = 'عرض تجريبي') {
  const events = [];
  const products = [];
  for (let i = 0; i < DATA.length; i++) {
    const [name, category, minStock, shelfLife] = DATA[i];
    products.push(await createProduct({ barcode: bc(i + 1), name, category, minStock, shelfLife }));
  }
  DATA.forEach(([, , , , ins, outs], i) => {
    for (const [ago, qty, exp] of ins) {
      const at = dayStart(ago);
      const e = new Date(); e.setHours(0, 0, 0, 0); e.setDate(e.getDate() + exp);
      events.push({ at, productId: products[i].id, type: 'in', qty, receivedAt: dateStr(at), expiryDate: exp == null ? null : dateStr(e) });
    }
    for (const [ago, qty] of outs) events.push({ at: dayStart(ago, 15), productId: products[i].id, type: 'out', qty });
  });
  events.sort((a, b) => a.at - b.at);
  for (const ev of events) {
    const { at, ...input } = ev;
    try { await recordMovement(input, { user, now: at }); } catch { /* skip an impossible combination, keep going */ }
  }
  return products.length;
}
