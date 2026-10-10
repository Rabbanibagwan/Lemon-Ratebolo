# Lemon Mandi — Feature Inventory & Regression Checklist

**Authoritative branch:** `cursor/permanent-feature-recovery-80c6`  
**Inventory revision commit:** (updated with this file’s commit)  
**Baseline umbrella:** `6333ed4` (`50e5fe9` + pako)  
**Recovery tip:** includes individual-driver Bluetooth PRINT + PartyPicker keyboard wiring + release gate  

Status: **PASS** | **MISSING** | **REGRESSED** | **PARTIAL** | **UNVERIFIED** | **PHYSICAL TEST REQUIRED**

Do not mark PASS only because a button exists — verify the call path.

## Audit counts (evidence-based, this revision)

| Metric | Count |
|---|---|
| Total features audited | **36** |
| Already correctly integrated on recovery tip (code PATH PASS) | **33** |
| Recovered from Git this session (beyond prior 7e4347d tip) | **1** (PartyPicker dynamic keyboard from `combine`) |
| Newly fixed earlier on tip (individual driver BT) | **1** (counted in the 33) |
| Still MISSING | **0** |
| PARTIAL | **1** (backend optional `upi_name` not on ShopProfile model; frontend still sends/falls back) |
| UNVERIFIED (needs human/device) | **2** labeled below as visual or end-to-end Drive; plus all thermal **PHYSICAL TEST REQUIRED** |

Automated gate: `npm run verify:release` → **13/13 automated PASS**, **2 PHYSICAL TEST REQUIRED**.

---

## Matrix

| # | Feature | Expected | Source commit/PR | On recovery branch | Code correct | Preview (if not from this SHA) | Latest APK `e2fe065d` @50e5fe9 | Automated tests | Result | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Action Diary / Auction | Day lots, drivers, bhada | main + set-driver | Yes | Yes | UNKNOWN unless SHA matches | UNKNOWN/older | set-driver-nav | PASS | **PASS** |
| 2 | OCR extraction + review | Capture → review → save | OCR PRs / main | Yes | Yes | UNKNOWN | UNKNOWN | manual | — | **PASS** |
| 3 | OCR farmer-name snapshot | AAM ≠ AAMG exact | #50 / integrate | Yes | Yes | Missing on main | Present if from integrate | verify-ocr-farmer-name-snapshot | 14 PASS | **PASS** |
| 4 | Farmer Patti create/edit | Manual + OCR | main | Yes | Yes | — | — | print-document | PASS | **PASS** |
| 5 | Manual Entry | Add lot / bills | main | Yes | Yes | — | — | physical-keyboard | PASS | **PASS** |
| 6 | Farmer/Vendor People | Directory | main | Yes | Yes | — | — | PartyPicker verifies | PASS | **PASS** |
| 7 | Admin Directory Excel import | Admin import | #45 merged | Yes (admin) | Yes | N/A app | N/A | backend tests | PASS | **PASS** |
| 8 | Driver Day Setup | Modal ranges | #21 + gates | Yes | Yes | — | — | verify-set-driver-nav | PASS | **PASS** |
| 9 | Dashboard SET DRIVER | Opens setup w/ source=dashboard | integrate | Yes | Yes | — | — | verify-set-driver-nav | PASS | **PASS** |
| 10 | Auction driver-button visibility | No stale auto-open | integrate source gate | Yes | Yes | — | — | verify-set-driver-nav | PASS | **PASS** |
| 11 | Driver Report (list) | Summary thermal PRINT | #46 / 50e5fe9 | Yes | Yes | Missing on main/APK-from-main | Present on integrate APK | verify-reports-thermal-print | PASS | **PASS** |
| 12 | Individual Driver Details PRINT | Bluetooth ESC/POS only | **a2e1cae** → recovery | Yes | Yes | **REGRESSED** on 50e5fe9/6333ed4 APK | **REGRESSED** (system dialog) | verify-reports + verify-thermal-print | PASS code | **PASS** code / **PHYSICAL TEST REQUIRED** |
| 13 | Farmer Details printing | PDF/XLSX save/share | reports | Yes | Yes | — | — | UI wiring | — | **PASS** |
| 14 | Vendor Details printing | Thermal + save/share | #46 / 50e5fe9 | Yes | Yes | Missing on main | Present integrate APK | verify-reports-thermal-print | PASS | **PASS** |
| 15 | Reports thermal options | 58/80/100 + BT | integrate | Yes | Yes | — | — | verify-reports | PASS | **PASS** |
| 16 | Vendor Purchase Chart | Chart data UI | #33 / integrate | Yes | Yes | Missing on main | Present integrate | verify-vendor-purchase-chart | PASS | **PASS** |
| 17 | Vendor Chart thermal PRINT | requireBluetooth | integrate | Yes | Yes | Missing on main | Present integrate | verify-chart-vendor-print | PASS | **PASS** / PHYSICAL |
| 18 | Farmer Patti thermal | ESC/POS widths | print PRs | Yes | Yes | — | — | verify-thermal-print | PASS code | **PASS** / PHYSICAL |
| 19 | Vendor Bill thermal | ESC/POS + Lemon label | print PRs | Yes | Yes | — | — | verify-thermal-print | PASS code | **PASS** / PHYSICAL |
| 20 | Merchant UPI QR upload + print | Shop upload + bill QR | integrate / combine | Yes | Yes | Missing on main | Present integrate | verify-merchant-upi + qr-upload | PASS | **PASS** |
| 21 | 58/80/100 paper widths | Settings + encoders | thermal width PRs | Yes | Yes | — | — | multiple verifies | PASS | **PASS** |
| 22 | Feed/cut + print buffer | Cut after content | integrate cutAfterLastContent | Yes | Yes | — | — | escpos cut checks | PASS | **PASS** |
| 23 | Cash Book | Nav + CREDIT/DEBIT | integrate / #36 | Yes | Yes | Missing on main | Present integrate | nav presence | — | **PASS** |
| 24 | Bag Balance | Balance UI | #19 lineage | Yes | Yes | — | — | — | — | **PASS** |
| 25 | Bag Balance invoices | PDF/print invoice | #19/#23 | Yes | Yes | — | — | — | — | **PASS** |
| 26 | GST / invoice details | GST split on invoice | #23 | Yes | Yes | — | — | — | — | **PASS** |
| 27 | Free Bags claim/usage | Merchant free bags | #22 | Yes | Yes | — | — | — | — | **PASS** |
| 28 | Admin Free Bags | Admin allocation | #27/#24 | Yes | Yes | — | — | backend free_bags tests | — | **PASS** |
| 29 | Bag purchase enable/disable | Hide balance when off | #43 | Yes | Yes | — | — | — | — | **PASS** |
| 30 | Staff print permissions | Staff list thermal | #46 | Yes | Yes | — | — | verify-reports staff gates | PASS | **PASS** |
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
