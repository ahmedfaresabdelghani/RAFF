// store.js — in-memory snapshot of inventory + change notifications for the UI.
import { getInventory } from './services.js';
import { summarize, expiryRows, todayStr } from './domain.js';
import { thresholds } from './settings.js';

export const bus = new EventTarget();
export const store = { items: [], summary: { cartons: 0, products: 0, low: 0, expiring: 0, expired: 0 }, loaded: false };

export const DEFAULT_CATEGORIES = ['مشروبات', 'مقرمشات', 'ألبان', 'منظفات', 'معلبات', 'زيوت وسمن', 'مكرونة وأرز', 'حلويات وبسكويت', 'عناية شخصية', 'مجمدات', 'أخرى'];

export async function refresh() {
  store.items = await getInventory({ thresholds: thresholds() });
  store.summary = summarize(store.items);
  store.loaded = true;
  bus.dispatchEvent(new CustomEvent('changed'));
  return store;
}

export const categories = () => [...new Set([...DEFAULT_CATEGORIES, ...store.items.map((i) => i.product.category)])];
export const itemById = (id) => store.items.find((i) => i.product.id === id) || null;
export const expiryList = () => expiryRows(store.items, todayStr(), thresholds());
export const alertCounts = () => {
  const rows = expiryList().filter((r) => r.status !== 'ok');
  return { low: store.summary.low, expiryUrgent: rows.filter((r) => r.status === 'expired' || r.status === 'critical').length, expiryAll: rows.length };
};
