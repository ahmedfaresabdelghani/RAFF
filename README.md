# رفّ RAFF — Warehouse Carton Inventory PWA (Phase 1 MVP)

Arabic (RTL) progressive web app for supermarket warehouses. Scan cartons with the phone camera, track
**in / out / damaged**, follow **expiry per batch (FEFO)**, run a **physical stocktake**, export to **Excel**.
Works offline. No backend, no accounts, no network calls — all data stays on the device (IndexedDB).

## Run locally
```bash
npm install          # only needed for tests (fake-indexeddb)
npm run serve        # http://localhost:8080   (camera needs HTTPS or localhost)
npm test             # 30 data-layer tests (stock math, FEFO, undo, stocktake, backup validation, CSV)
npm run lint:security  # static checks: no innerHTML/eval/fetch/external URLs/inline scripts
```

## Deploy (HTTPS is mandatory for the camera and the service worker)
- **Vercel:** import the folder as a static project (no build command, output = root). `vercel.json` sets the security headers.
- **GitHub Pages / Netlify:** works as-is; security headers can't be set on Pages, so the CSP `<meta>` in `index.html` is the fallback
  (it cannot express `frame-ancestors`). Prefer Vercel/Netlify for customers.

## Features
| Area | What it does |
|---|---|
| Scan | Rear camera, EAN-13 / ITF-14 / UPC-A / Code-128 (+EAN-8, UPC-E, Code-39), torch + zoom when the device supports them, beep + vibration + screen flash, screen kept awake, camera stops when app is backgrounded |
| Movements | وارد / منصرف / هالك with quantity stepper, quick chips (6/12/24/50/100), direct typing (Arabic digits accepted) |
| Instant mode | Optional: scan = record immediately (no confirm sheet); quantity resets to 1 |
| Expiry | Each **receipt creates a batch** with entry date. Expiry = entry date + shelf life (days/months/years) **or** typed manually. Shelf life is remembered per product |
| FEFO | Out/damaged always consume the earliest-expiry batch first; the sheet previews which batch will be used |
| Alerts | Low stock (≤ reorder point), expired / critical (default 7 d) / soon (default 30 d); tab badges; WhatsApp/share text |
| Undo | One tap undo of the last movement (restores the exact batches) |
| Stocktake | Count by scanning, see shortage/surplus vs system, one tap books `تسوية جرد` movements; session survives app close |
| Products | Barcode auto-filled on first scan; extra barcodes per product; ITF-14 carton codes resolve to the inner EAN-13; UPC-A ↔ EAN-13 |
| Export | Inventory, movements, batches/expiry → CSV with UTF-8 BOM (Arabic OK in Excel; long barcodes stay text) · JSON backup/restore |
| PWA | Installable, offline app shell, persistent-storage request, iOS "Add to Home Screen" hint |

## Architecture
```
index.html          shell + CSP meta          sw.js            offline shell (stale-while-revalidate, same-origin only)
js/domain.js        pure rules (dates, FEFO, barcode, validation, CSV escaping)  <- unit tested
js/db.js            storage adapter: transact(stores, mode, fn)                  <- the ONLY file that knows IndexedDB
js/services.js      business operations, each in ONE transaction (all-or-nothing)
js/backup.js        whitelist-validating JSON restore
js/csv.js           exports                    js/settings.js   per-device prefs (validated)
js/store.js         in-memory snapshot + change events
js/ui/*             DOM builder (no innerHTML), scanner wrapper, sheets, 5 screens + stocktake
vendor/             html5-qrcode 2.3.8 (Apache-2.0)      fonts/  Cairo (OFL-1.1)
```
**Phase 2 (Firebase/Supabase):** re-implement `transact`, `exportAll`, `replaceAll` in `db.js` (or put a sync queue behind it).
`services.js` and the UI don't change. Data model: `products`, `batches` (qty, receivedAt, expiry), `movements` (immutable audit rows with `balanceAfter`, `user`, `allocs`).
Needed for multi-device: user accounts + roles (admin/staff), server-side validation, conflict handling for concurrent edits.

## Known limits (Phase 1)
- Data lives only in the browser of that phone. Clearing site data or losing the phone loses it → use **Backup**. On iOS install to the Home Screen (Safari tabs can be evicted).
- No login/roles yet; the "employee name" is a label stored with each movement, not an authenticated identity.
- Torch/zoom need Android Chrome; iOS Safari doesn't expose them (button hidden) and has no vibration API (sound + flash are used).
- Verified in headless Chromium with a fake camera feeding a real EAN-13 image. **Not yet verified on physical Android/iOS devices** — do a field test in a dark warehouse before selling.
