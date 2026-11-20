// actions.js — UI-facing wrappers: run a service call, give feedback, offer undo.
import { recordMovement, undoLast } from './services.js';
import { ValidationError, MOVEMENT_LABEL } from './domain.js';
import { getSettings } from './settings.js';
import { refresh } from './store.js';
import { toast, fmtNum } from './ui/dom.js';
import * as fb from './ui/feedback.js';

export function reportError(e) {
  if (e instanceof ValidationError) return e.message;
  console.error(e); // details stay in the console only; users see a generic message
  return 'حصل خطأ غير متوقع. حاول تاني، ولو اتكرر أعد تشغيل التطبيق.';
}

export async function undoAction(movementId) {
  try {
    await undoLast(movementId);
    await refresh();
    fb.ok();
    toast('تم التراجع عن آخر حركة', { kind: 'ok', ms: 3000 });
    return true;
  } catch (e) {
    fb.error();
    toast(reportError(e), { kind: 'error' });
    return false;
  }
}

export async function commitMovement(input) {
  try {
    const res = await recordMovement(input, { user: getSettings().employee });
    await refresh();
    fb.ok();
    const m = res.movement;
    const sign = m.delta > 0 ? '+' : '−';
    toast(`${sign}${fmtNum(m.qty)} ${MOVEMENT_LABEL[m.type]} · ${m.productName} — الرصيد ${fmtNum(res.stock)}`, {
      kind: 'ok', action: { label: 'تراجع', fn: () => undoAction(m.id) }, ms: 6000,
    });
    return res;
  } catch (e) {
    fb.error();
    toast(reportError(e), { kind: 'error' });
    return null;
  }
}
