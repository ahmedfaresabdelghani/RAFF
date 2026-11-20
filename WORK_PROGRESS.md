# RAFF (رفّ) — work progress

## Decisions
- Vanilla ES modules, no build step. IndexedDB behind a thin adapter (db.js). html5-qrcode 2.3.8 + Cairo font vendored locally (offline + strict CSP).
- Expiry: batches (received date + shelf life -> auto expiry, or manual). FEFO on out/damaged. Undo last movement. Stocktake mode.
- No innerHTML anywhere (DOM builder `h()`); CSV formula-injection guard; strict CSP.
- Inspected vendor lib: only `new Function("return this")` is a dead-code globalThis fallback (webpack shim) -> never executes in browsers with globalThis.

## Status
- [x] Phase A: scaffold + vendor libs (vendor/, fonts/)
- [x] Phase B: domain.js, db.js, services.js, backup.js, csv.js, settings.js + 30 node tests passing (`npm test`)
- [ ] Phase C: UI (css, screens, sheets, scanner), sw.js, manifest, icons
- [x] Phase D: README, SECURITY.md, USER_GUIDE.md, licenses, zip delivered
- [ ] Not done: test on physical Android/iOS devices; Phase 2 (cloud sync, auth/roles)

## Next action
Field-test on real phones in a dark warehouse; then plan Phase 2 (Supabase/Firebase + auth/roles).
