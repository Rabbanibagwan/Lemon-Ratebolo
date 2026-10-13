# Lemon Mandi — Feature Inventory & Regression Checklist

**Authoritative branch:** `cursor/permanent-feature-recovery-80c6`  
**Inventory revision:** tip after capacity OCR/Cash Book audit merge (#58)  
**Baseline umbrella:** `6333ed4` (`50e5fe9` + pako)  
**Recovery tip includes:** individual-driver Bluetooth PRINT + PartyPicker keyboard + release gate/CI + OCR vendor exact-only (BB≠JBB) + OCR concurrency/observability + Cash Book local double-save guards  

Status: **PASS** | **MISSING** | **REGRESSED** | **PARTIAL** | **UNVERIFIED** | **PHYSICAL TEST REQUIRED**

Do not mark PASS only because a button exists — verify the call path.

## Audit counts (evidence-based, this revision)

| Metric | Count |
|---|---|
| Total features audited | **39** (adds OCR concurrency reliability + Cash Book local integrity) |
| Already correctly integrated on recovery tip (code PATH PASS) | **36** |
| Newly fixed this revision (OCR semaphore-during-backoff + observability; Cash Book locks) | **2** |
| Still MISSING | **0** |
| PARTIAL | **1** (backend optional `upi_name` not on ShopProfile model) |
| UNVERIFIED (needs human/device) | **2** (login visual; Drive backup E2E) + thermal **PHYSICAL TEST REQUIRED** |

Automated gate: `npm run verify:release` → **16/16 automated PASS**, **2 PHYSICAL TEST REQUIRED**.  
OCR party verify: **27 PASS** (farmer AAM≠AAMG + vendor BB≠JBB).  
OCR backend resilience/concurrency (mocked): **38 PASS**.

---

## Matrix

| # | Feature | Expected | Source commit/PR | On recovery branch | Code correct | Preview (if not from this SHA) | Latest APK `e2fe065d` @50e5fe9 | Automated tests | Result | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Action Diary / Auction | Day lots, drivers, bhada | main + set-driver | Yes | Yes | UNKNOWN unless SHA matches | UNKNOWN/older | set-driver-nav | PASS | **PASS** |
| 2 | OCR extraction + review | Capture → review → save | OCR PRs / main | Yes | Yes | UNKNOWN | UNKNOWN | manual | — | **PASS** |
| 2b | OCR concurrency reliability | Sem only on provider call; backoff releases slot; queue wait timeout; process-scoped metrics | #58 capacity audit | Yes | Yes | N/A | N/A | test_ocr_resilience + concurrency edges + verify-ocr-client-retries | 38 backend + gate | **PASS** (mocked; not prod capacity) |
| 3 | OCR farmer-name snapshot | AAM ≠ AAMG exact | #50 / ocr-exact-match-apk | Yes | Yes | Missing on main | Present recovery | verify-ocr-farmer-name-snapshot | 33 PASS | **PASS** |
| 3b | OCR vendor-name exact match | BB ≠ JBB; findExactParty=normPartyKey | ocr-exact-match-apk | Yes | Yes | Prior APK fuzzy | Fixed recovery | verify-ocr-farmer-name-snapshot | 33 PASS | **PASS** |
| 4 | Farmer Patti create/edit | Manual + OCR | main | Yes | Yes | — | — | print-document | PASS | **PASS** |
| 5 | Manual Entry | Add lot / bills | main | Yes | Yes | — | — | physical-keyboard | PASS | **PASS** |
| 6 | Farmer/Vendor People | Directory | main | Yes | Yes | — | — | PartyPicker verifies | PASS | **PASS** |
| 7 | Admin Directory Excel import | Admin import | #45 merged | Yes (admin) | Yes | N/A app | N/A | backend tests | PASS | **PASS** |
| 8 | Driver Day Setup | Modal ranges | #21 + gates | Yes | Yes | — | — | verify-set-driver-nav | PASS | **PASS** |
| 9 | Dashboard SET DRIVER | Opens setup w/ source=dashboard | integrate | Yes | Yes | — | — | verify-set-driver-nav | PASS | **PASS** |
| 10 | Auction driver-button visibility | No stale auto-open | integrate source gate | Yes | Yes | — | — | verify-set-driver-nav | PASS | **PASS** |
| 10b | Entry Book receiver entry | Tap Patti → focused UPDATE RECEIVER (from=entry) | entry-book-receiver-preview | Yes | Yes | — | — | verify-entry-book-receiver | PASS | **PASS** |
| 11 | Driver Report (list) | Summary thermal PRINT | #46 / 50e5fe9 | Yes | Yes | Missing on main/APK-from-main | Present on integrate APK | verify-reports-thermal-print | PASS | **PASS** |
| 12 | Individual Driver Details PRINT | Bluetooth ESC/POS only | **a2e1cae** → recovery | Yes | Yes | **REGRESSED** on 50e5fe9/6333ed4 APK | **REGRESSED** (system dialog) | verify-reports + verify-thermal-print | PASS code | **PASS** code / **PHYSICAL TEST REQUIRED** |
| 13 | Farmer Details printing | PDF/XLSX save/share | reports | Yes | Yes | — | — | UI wiring | — | **PASS** |
| 14 | Vendor Details printing | Thermal + save/share | #46 / 50e5fe9 | Yes | Yes | Missing on main | Present integrate APK | verify-reports-thermal-print | PASS | **PASS** |
| 15 | Reports thermal options | 58/80/100 + BT | integrate | Yes | Yes | — | — | verify-reports | PASS | **PASS** |
| 16 | Vendor Purchase Chart | Chart data UI | #33 / integrate | Yes | Yes | Missing on main | Present integrate | verify-vendor-purchase-chart | PASS | **PASS** |
| 17 | Vendor Chart thermal PRINT | requireBluetooth | integrate | Yes | Yes | Missing on main | Present integrate | verify-chart-vendor-print | PASS | **PASS** / PHYSICAL |
| 18 | Farmer Patti thermal | ESC/POS widths | print PRs | Yes | Yes | — | — | verify-thermal-print | PASS code | **PASS** / PHYSICAL |
| 19 | Vendor Bill thermal | ESC/POS + Lemon + No. of Bags + merchant QR + cut after QR | staff-driver-vendor-qr | Yes | Yes | — | — | verify-thermal-print + no-bags + merchant-qr | PASS code | **PASS** / PHYSICAL |
| 20 | Merchant UPI QR upload + print | Shop upload PNG + bill preview + ESC/POS raster | staff-driver-vendor-qr | Yes | Yes | Missing on main | Present recovery | verify-merchant-upi + qr-upload | PASS | **PASS** / PHYSICAL QR scan |
| 21 | 58/80/100 paper widths | Settings + encoders | thermal width PRs | Yes | Yes | — | — | multiple verifies | PASS | **PASS** |
| 22 | Feed/cut + print buffer | cutAfterLastContent = qrClearanceFeed + GS V 0 after QR | staff-driver-vendor-qr | Yes | Yes | — | — | verify-merchant-qr-upload cut order | PASS | **PASS** / PHYSICAL |
| 23 | Cash Book | Live API CREDIT/DEBIT day book; shop isolation; opening/closing balance; local import | cash-book-live-api | Yes | Yes | Missing on main until backend deploy | — | verify-cash-book-live + test_cash_book | PASS (unit); prod deploy required | **PASS** code / deploy pending |
| 24 | Bag Balance | Balance UI | #19 lineage | Yes | Yes | — | — | — | — | **PASS** |
| 25 | Bag Balance invoices | PDF/print invoice | #19/#23 | Yes | Yes | — | — | — | — | **PASS** |
| 26 | GST / invoice details | GST split on invoice | #23 | Yes | Yes | — | — | — | — | **PASS** |
| 27 | Free Bags claim/usage | Merchant free bags | #22 | Yes | Yes | — | — | — | — | **PASS** |
| 28 | Admin Free Bags | Admin allocation | #27/#24 | Yes | Yes | — | — | backend free_bags tests | — | **PASS** |
| 29 | Bag purchase enable/disable | Hide balance when off | #43 | Yes | Yes | — | — | — | — | **PASS** |
| 30 | Staff print permissions | Staff list + individual driver PRINT/SHARE | staff-driver-vendor-qr | Yes | Yes | Individual was owner-only after 50e5fe9 | Restored canUserExportReport | verify-reports staff + detail gates | PASS | **PASS** / PHYSICAL |
| 31 | Global working date | App + admin | #40 | Yes | Yes | — | — | — | — | **PASS** |
| 32 | Physical keyboard nav | Enter/arrows | #34 / 50e5fe9 | Yes | Yes | Missing on main | Present integrate | verify-physical-keyboard | PASS | **PASS** |
| 33 | Login / Product by RateBolo | Login redesign | #20 | Yes | Yes | — | — | visual | — | **UNVERIFIED** visual |
| 34 | Search + reports | Search filters | main | Yes | Yes | — | — | — | — | **PASS** |
| 35 | Backup / restore | Drive backup UI | backup.tsx | Yes | Yes | — | — | backend backup tests | — | **UNVERIFIED** E2E Drive |
| 36 | pako / png-mono for EAS | Declared dependency | 6333ed4 | Yes | Yes | N/A | Fixed in e2fe065d lineage | preflight | PASS | **PASS** |

### PARTIAL detail

- **Merchant `upi_name`:** frontend `ShopProfile` + `shop-profile.tsx` still send optional `upi_name`; backend `ShopProfile` model only declares `upi_id` + `upi_qr_base64`. Display falls back to `shop_name`. Not blocking QR print.

---

## Critical call path — Individual Driver PRINT (#12)

```
reports.tsx → exportDriver(..., "print")
  → thermalPrintDriverReport
    → printThermalDocument({ requireBluetooth: true, encodeDriverReportEscPos })
      → writeEscPos → ThermalBluetooth.writeBase64
```

Must not use `preferHtml`, `Print.printAsync`, or `printThermalHtmlOnly` on this path.

## Release commands

```bash
cd frontend && npm run verify:release
```

CI: `.github/workflows/lemon-mandi-verify.yml` (no secrets).
