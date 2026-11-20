// feedback.js — beep, haptic and full-screen flash so the operator never has to stare at the screen.
// iOS Safari has no Vibration API: sound + flash cover it.
import { getSettings } from '../settings.js';

let ctx = null;

// Must be called from a user gesture (tap) at least once so iOS lets audio play later.
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* audio unavailable */ }
}

function tone(freq, start, dur, vol = 0.25, type = 'sine') {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function flash(kind) {
  const el = document.getElementById('flash');
  if (!el) return;
  el.className = `flash flash-${kind}`;
  void el.offsetWidth; // restart animation
  el.classList.add('go');
}

function buzz(pattern) {
  if (getSettings().vibrate && navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignore */ } }
}

export function ok() {
  if (getSettings().sound) tone(1760, 0, 0.09);
  buzz(40); flash('ok');
}
export function unknown() {
  if (getSettings().sound) { tone(880, 0, 0.09); tone(1320, 0.11, 0.09); }
  buzz([30, 40, 30]); flash('warn');
}
export function error() {
  if (getSettings().sound) { tone(220, 0, 0.18, 0.3, 'square'); tone(180, 0.2, 0.22, 0.3, 'square'); }
  buzz([120, 60, 120]); flash('err');
}
