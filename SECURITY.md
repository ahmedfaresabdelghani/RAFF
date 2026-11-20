# RAFF — Security Documentation (for security review)

Scope: Phase 1 MVP, a static, client-only PWA. There is **no server component, no API, no authentication, no telemetry**.
This document states what the code does, what controls exist, how to verify each claim, and what is *not* covered.

## 1. Architecture & data flow
```
Browser (HTTPS) ── loads static files (HTML/JS/CSS/fonts/icons) from our own origin only
   └─ IndexedDB  ── products, batches, movements        (on the device, same-origin only)
   └─ localStorage ─ UI preferences (employee label, thresholds, theme)
   └─ Camera     ── getUserMedia, frames processed locally by html5-qrcode; nothing is recorded or uploaded
```
- **No outbound requests.** `connect-src 'self'`; the app contains no `fetch/XMLHttpRequest/WebSocket/sendBeacon`
  (enforced by `npm run lint:security`). The only navigation to a third party is the user-initiated WhatsApp share
  (`https://wa.me/?text=…`, opened with `noopener,noreferrer`) when the Web Share API is unavailable; its content is the shortage/expiry text the user chose to send.
- **No secrets, credentials, API keys or personal data** are handled. Product names, quantities and an optional employee name are the only data.

## 2. Controls
| Risk | Control | Where |
|---|---|---|
| XSS | UI built only with `createElement/textContent`; **no** `innerHTML/outerHTML/insertAdjacentHTML/document.write/eval/new Function` in first-party code | `js/ui/dom.js`, lint |
| XSS (defence in depth) | CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'` — no `unsafe-inline`, no `unsafe-eval`, no inline `<script>`/`style=`/`on*=` | `index.html`, `vercel.json` |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` (response headers; not possible via `<meta>`) | `vercel.json` |
| Transport | HTTPS required (camera + service worker refuse insecure origins); HSTS header | `vercel.json` |
| Browser features | `Permissions-Policy`: camera only for self; mic/geolocation/payment/USB/Bluetooth/serial disabled | `vercel.json` |
| Third-party code | One library (html5-qrcode 2.3.8, Apache-2.0) **vendored locally**, no CDN. SHA-256 `660b12437b1d747e3e68b8be0685c08cb728140110ad213f167b14b66f8b1d8e`. Reviewed: no `eval`; the single `new Function("return this")` is the bundler's `globalThis` fallback, reached only if `globalThis` is not an object (never in supported browsers) and it would be blocked by CSP anyway. No network calls in the library. | `vendor/` |
| Input validation | Every service call re-validates: integers only (Arabic digits normalised), bounded ranges, names/categories length-limited with control & **bidi-override characters stripped**, barcodes `[\x21-\x7E]{1,32}`, strict `YYYY-MM-DD` dates | `js/domain.js`, tested |
| CSV/Excel formula injection | Text cells beginning with `= + - @ TAB CR` are prefixed with `'`; quotes/commas/newlines escaped. Only regex-validated all-digit barcodes are emitted as `="123…"` (so Excel keeps them as text) | `js/domain.js`, tested |
| Malicious backup file | Restore parses JSON, **rebuilds every record from a field whitelist**, re-validates types/ranges/dates, checks referential integrity & duplicate barcodes, caps size (25 MB) and rows; unknown keys (incl. `__proto__`) are dropped; failure leaves existing data untouched | `js/backup.js`, tested (11 hostile files + a `__proto__` pollution case) |
| Data integrity | Each business operation is one IndexedDB transaction (rollback on any error); quantity cannot go negative; concurrent writes serialised by the DB (tested: 8 parallel "out" never oversell); audit rows are append-only and carry `balanceAfter`; undo only for the newest movement | `js/services.js`, tested |
| Service worker | Same-origin GET only, cache name versioned, old caches deleted, never intercepts other origins or non-GET | `sw.js` |
| Error handling | Users see Arabic messages; internal errors go to `console` only (no stack traces in UI) | `js/actions.js` |
| Clipboard/Share | Only on explicit tap | — |

## 3. How to verify (reproducible)
```bash
npm install && npm test              # 30 tests: stock math, FEFO, undo, stocktake, hostile backups, CSV escaping
npm run lint:security                # greps first-party code for banned APIs; checks index.html for inline script/style/handlers
grep -rn "innerHTML\|eval(\|fetch(" js            # expect matches in comments only (sw.js legitimately calls fetch for its own origin)
sha256sum vendor/html5-qrcode.min.js # compare with the hash above
```
Browser check: open DevTools → Network while using every screen: only same-origin requests appear. Console shows no CSP violations.

## 4. Data & privacy
- Stored on the device only: IndexedDB `raff` (products/batches/movements/meta) and `localStorage` key `raff.settings.v1`.
- Not encrypted at rest (browser storage). Anyone with unlocked access to the phone/browser profile can read or change it. Use the device lock screen; consider MDM-managed devices.
- Backup JSON and CSV exports are **plain text**; handle as business-confidential.
- "Employee" is a free-text label for the audit trail. It is **not** authentication (no repudiation protection in Phase 1).
- Camera: requested on user tap; stream stays in the page; stopped when the tab hides or the user stops it.

## 5. Not covered / residual risk (be explicit with reviewers)
1. No authentication, roles or server-side enforcement in Phase 1 (planned for Phase 2 with Firebase/Supabase: auth + Row-Level Security/Rules, roles admin/staff).
2. Local data can be altered by a user with devtools access to the same browser profile; the audit log is tamper-*evident* only by `balanceAfter` continuity, not cryptographically signed.
3. Static review + automated tests + headless-browser run were done. **No third-party penetration test, and no test on physical iOS devices yet.**
4. GitHub Pages cannot send response headers: CSP falls back to `<meta>` (no `frame-ancestors`, no HSTS control). Use Vercel/Netlify with `vercel.json` headers for customers.
5. Dependencies: none at runtime except the vendored library; dev-only `fake-indexeddb` for tests (not shipped). Re-hash and re-review `vendor/` on any upgrade.

## 6. Phase 2 hardening checklist
Authenticated users + roles; server-side validation mirroring `domain.js`; per-tenant data isolation (RLS) for multi-supermarket SaaS; signed audit trail or server timestamps; encrypted local cache option; Subresource Integrity if any asset ever moves to a CDN; automated dependency/licence scanning in CI; external pen-test before onboarding customers.
