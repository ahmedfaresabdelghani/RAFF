// settings.js — per-device preferences in localStorage. Every value is validated on read,
// so a tampered/corrupt entry can never reach the rest of the app.

const KEY = 'raff.settings.v1';

export const DEFAULTS = Object.freeze({
  employee: '', warnDays: 30, critDays: 7, sound: true, vibrate: true,
  instant: false, theme: 'dark', bigQty: 100,
});

const clampInt = (v, min, max, d) => (Number.isInteger(v) && v >= min && v <= max ? v : d);

function sanitize(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const warnDays = clampInt(o.warnDays, 7, 365, DEFAULTS.warnDays);
  return {
    employee: typeof o.employee === 'string' ? o.employee.replace(/[\u0000-\u001F​-‏‪-‮]/g, '').slice(0, 40) : '',
    warnDays,
    critDays: Math.min(clampInt(o.critDays, 1, 30, DEFAULTS.critDays), warnDays),
    sound: o.sound !== false,
    vibrate: o.vibrate !== false,
    instant: o.instant === true,
    theme: o.theme === 'light' ? 'light' : 'dark',
    bigQty: clampInt(o.bigQty, 10, 100000, DEFAULTS.bigQty),
  };
}

let cache = null;
export function getSettings() {
  if (cache) return cache;
  try { cache = sanitize(JSON.parse(localStorage.getItem(KEY))); } catch { cache = sanitize(null); }
  return cache;
}
export function saveSettings(patch) {
  cache = sanitize({ ...getSettings(), ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode / quota: keep in memory */ }
  return cache;
}
export const thresholds = () => ({ warnDays: getSettings().warnDays, critDays: getSettings().critDays });
