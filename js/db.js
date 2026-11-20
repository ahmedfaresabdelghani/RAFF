// db.js — storage adapter (IndexedDB).
//
// The rest of the app talks ONLY to `transact()` and the helper object `t` it passes in.
// Phase 2 (Firebase/Supabase): re-implement `transact`, `exportAll`, `importAll`,
// `clearAll` with the same signatures and nothing else has to change.

const DB_NAME = 'raff';
const DB_VERSION = 1;

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('المتصفح لا يدعم التخزين المحلي (IndexedDB)'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const products = db.createObjectStore('products', { keyPath: 'id' });
      products.createIndex('barcodes', 'barcodes', { multiEntry: true });
      products.createIndex('name', 'name');
      const batches = db.createObjectStore('batches', { keyPath: 'id' });
      batches.createIndex('productId', 'productId');
      batches.createIndex('expiry', 'expiry');
      const movements = db.createObjectStore('movements', { keyPath: 'id' });
      movements.createIndex('ts', 'ts');
      movements.createIndex('productId', 'productId');
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => reject(new Error('أغلق باقي نوافذ التطبيق ثم أعد المحاولة'));
  });
  return dbPromise;
}

const wrap = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function helpers(tx) {
  return {
    get: (store, key) => wrap(tx.objectStore(store).get(key)),
    getAll: (store) => wrap(tx.objectStore(store).getAll()),
    put: (store, value) => wrap(tx.objectStore(store).put(value)),
    del: (store, key) => wrap(tx.objectStore(store).delete(key)),
    clear: (store) => wrap(tx.objectStore(store).clear()),
    byIndex: (store, index, key) => wrap(tx.objectStore(store).index(index).getAll(key)),
    // Newest record (by index order) that satisfies `pred`.
    findLast: (store, index, pred) => new Promise((resolve, reject) => {
      const req = tx.objectStore(store).index(index).openCursor(null, 'prev');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve(null);
        if (pred(cur.value)) return resolve(cur.value);
        cur.continue();
      };
    }),
    // Newest N records by index order.
    newest: (store, index, limit, pred = () => true) => new Promise((resolve, reject) => {
      const out = [];
      const req = tx.objectStore(store).index(index).openCursor(null, 'prev');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || out.length >= limit) return resolve(out);
        if (pred(cur.value)) out.push(cur.value);
        cur.continue();
      };
    }),
  };
}

// Runs `fn(t)` inside ONE transaction. If fn throws, everything is rolled back.
export function transact(storeNames, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    let failure = null;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error('تعذر حفظ البيانات'));
    tx.onerror = () => { failure = failure || tx.error; };
    Promise.resolve()
      .then(() => fn(helpers(tx)))
      .then((r) => { result = r; })
      .catch((err) => {
        failure = err;
        try { tx.abort(); } catch { /* already finished */ }
      });
  }));
}

const ALL_STORES = ['products', 'batches', 'movements', 'meta'];

export function exportAll() {
  return transact(ALL_STORES, 'readonly', async (t) => ({
    products: await t.getAll('products'),
    batches: await t.getAll('batches'),
    movements: await t.getAll('movements'),
    meta: await t.getAll('meta'),
  }));
}

export function replaceAll(data) {
  return transact(ALL_STORES, 'readwrite', async (t) => {
    for (const s of ALL_STORES) await t.clear(s);
    for (const s of ALL_STORES) for (const row of data[s] || []) await t.put(s, row);
  });
}

export function clearAll() {
  return replaceAll({});
}

export function newId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
