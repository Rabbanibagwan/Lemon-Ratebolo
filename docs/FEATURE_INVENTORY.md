# Lemon Mandi — Feature Inventory & Regression Checklist

**Authoritative integration branch:** `cursor/permanent-feature-recovery-80c6`  
**Baseline:** `6333ed4` (includes verified `50e5fe9` + pako)  
**Last inventory update:** 2026-10-10

Status legend: **PASS** | **MISSING** | **REGRESSED** | **PARTIAL** | **UNVERIFIED**

Do not mark PASS only because a button exists — verify the call path and behavior.

| ID | Feature | Expected behavior | Key files | Source commit/PR | On recovery branch | Preview/build | Verify method | Status | Recovery action |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Action Diary / Auction lots | Day auction lots, drivers, bhada | `app/(tabs)/auction.tsx` | main + set-driver | Yes | Depends on build SHA | Manual + set-driver verify | PASS | — |
| A2 | OCR capture + review | Scan Action Book / Patti | `app/ocr/*` | main + OCR PRs | Yes | Depends on build SHA | Manual | PASS | — |
| A3 | OCR farmer-name snapshot | Exact name; AAM ≠ AAMG | `ocr-party-match` utils | #50 / integrate | Yes | Integrate APK | `verify-ocr-farmer-name-snapshot.ts` | PASS | — |
| A4 | OCR Review PartyPicker keyboard | Keyboard avoids link UI | PartyPicker / KeyboardFormAvoid | #54 / `b0418e6` | Yes | Integrate | Manual / prior verify | PASS | — |
| A5 | Farmer Patti create/edit | Manual + OCR patti | `app/patti/*` | main | Yes | — | Manual | PASS | — |
| B1 | Farmer/Vendor directory | People management | directory screens | #45 merged | Yes | — | Manual | PASS | — |
| C1 | Driver Day Setup | Dashboard SET DRIVER opens setup | auction + `set-driver-nav` | #21 + integrate gates | Yes | — | `verify-set-driver-nav.js` | PASS | — |
| C2 | Hide Auction SET DRIVER | No Auction auto-open / no Auction shortcut | auction source gate | integrate (not `2ddc980` wholesale) | Yes | — | `verify-set-driver-nav.js` | PASS | Keep source gate; do not apply main-based hide PR wholesale |
| D1 | Driver/Farmer/Vendor reports UI | Tabs + search + detail | `app/(tabs)/reports.tsx` | main + integrate | Yes | — | Manual | PASS | — |
| E1 | **Individual driver thermal PRINT** | Bluetooth ESC/POS only; no system dialog | `reports-export.thermalPrintDriverReport`, reports UI | **`a2e1cae`** recovered into recovery branch | Yes (fixed) | Prior APK on integrate still REGRESSED | `verify-reports-thermal-print.ts` | **PASS** (code) / physical **UNVERIFIED** | Applied `requireBluetooth: true`; removed `preferHtml` |
| E2 | Driver list thermal PRINT | Summary ESC/POS; staff+owner | `thermalPrintDriverDetailsReport` | #46 / `50e5fe9` | Yes | Integrate APK | `verify-reports-thermal-print.ts` | PASS | — |
| F1 | Vendor purchase chart | Chart data + PRINT | chart screens + `chart-print.ts` | #33 / integrate | Yes | Integrate | `verify-vendor-purchase-chart.ts`, `verify-chart-vendor-print.ts` | PASS | — |
| F2 | Vendor Details thermal PRINT | Bluetooth ESC/POS; staff+owner | `thermalPrintVendorDetailsReport` | #46 / `50e5fe9` | Yes | Integrate | `verify-reports-thermal-print.ts` | PASS | — |
| G1 | Vendor bill thermal print | ESC/POS + paper width | `vendor-bill-print.ts` | main + print PRs | Yes | — | Manual / thermal utils | PASS | — |
| G2 | Vendor bill QR cut | Cut after merchant QR | vendor bill ESC/POS | integrate (`cutAfterLastContent`) | Yes | — | Code presence + bill verifies | PASS | — |
| H1 | Farmer Patti thermal print | ESC/POS match preview | `patti-print.ts`, escpos | #32/#31/#26 | Yes | — | Manual | PASS | — |
| I1 | Thermal widths 58/80/100 | Settings + encoders | `escpos.ts`, settings | #30 region | Yes | — | verify scripts cols checks | PASS | — |
| J1 | Merchant UPI QR upload | Settings upload | merchant UPI utils | integrate / #35 | Yes | Integrate | Prior merchant verify on other branches | PASS | — |
| J2 | Vendor bill QR print | Print uploaded QR | vendor-bill thermal | integrate | Yes | — | Manual | PASS | — |
| K1 | Cash Book | Nav + screens | cash-book routes | integrate / #36/#39 | Yes | Integrate | Manual / nav presence | PASS | — |
| L1 | Bag Balance + invoice | Invoice PDF/print when purchase on | bag-invoice | #19 merged + integrate | Yes | — | Manual | PASS | — |
| M1 | Free Bags claim/usage | Merchant free bags | free-bags | #22 + integrate | Yes | — | Manual | PASS | — |
| N1 | Admin free-bags | Admin allocation | admin | #27/#24 merged | On main/admin | N/A app | Admin tests | PASS (admin on main) | Ensure admin deploys from main |
| O1 | Purchase enable/disable | Hide bag balance when off | settings toggle | #43 merged + integrate | Yes | — | Manual | PASS | — |
| P1 | Staff print permissions | Staff thermal driver/vendor list; owner share/save | `canUserExportReport` | #46 / integrate | Yes | — | verify-reports-thermal-print | PASS | Individual driver PRINT remains owner (as integrate) |
| Q1 | Global working date | App + admin date | working-date | #40 merged | Yes | — | Manual | PASS | — |
| R1 | Physical keyboard Enter | Directory / Add Lot / Vendor Bill New | keyboard wiring | #34 / `50e5fe9` | Yes | — | `verify-physical-keyboard.ts` | PASS | — |
| S1 | Login UI / Product by Ratebolo | Login redesign | login screens | #20 merged | Yes | — | Manual | UNVERIFIED visual | Smoke in preview |
| T1 | OCR exact farmer match | See A3 | — | — | Yes | — | verify-ocr… | PASS | — |
| U1 | Merchant/staff thermal access | See P1 | — | — | Yes | — | verify-reports… | PASS | — |
| V1 | Reports thermal printing | E1+E2+F2 | — | — | Yes | — | verify-reports… | PASS (code) | Physical printer pending |
| W1 | `pako` for PNG inflate | EAS Metro resolves png-mono | `package.json` | `6333ed4` | Yes | EAS APK success | `expo export` | PASS | — |

## Critical call path — Individual Driver PRINT (E1)

```
reports.tsx exportDriver(..., "print")
  → thermalPrintDriverReport(...)
    → printThermalDocument({ requireBluetooth: true, escposBase64: encodeDriverReportEscPos(...) })
      → writeEscPos(...)   // Bluetooth Classic
```

Must **not** call `Print.printAsync`, `preferHtml: true`, or `printThermalHtmlOnly` on this path.

## Build provenance note

A successful APK from an older SHA can miss features present only on this recovery branch. Always record the **exact Git SHA** used for each preview/EAS build (see `docs/RELEASE_CHECKLIST.md`).
