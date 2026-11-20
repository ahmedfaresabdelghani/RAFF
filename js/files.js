// files.js — hand a generated file to the user. iOS Safari/PWA handles blob downloads poorly,
// so there we use the native share sheet ("Save to Files", WhatsApp, Mail…) and fall back to download.

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function saveFile(filename, text, mime = 'text/csv') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  if (isIos() && typeof File === 'function' && navigator.canShare) {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener'; a.className = 'hidden';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  return 'downloaded';
}

export const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
