# Lemon Mandi — Permanent Feature Recovery Report

**Date:** 2026-10-10  
**Recovery branch:** `cursor/permanent-feature-recovery-80c6`  
**Baseline (integration tip):** `6333ed4076aa5d69ff5dba1ef5aa82f2dde465b6`  
**Verified reference commit:** `50e5fe9390b1f04fc7d79dd48d8d6def6ca0d3c2` (ancestor of baseline; baseline = reference + `pako` dependency fix)

## Phase 1 — Protected state (pre-modification)

| Item | Value |
|---|---|
| Workspace branch before recovery | `cursor/hide-auction-set-driver-80c6` @ `2ddc980` |
| Working tree | Clean (no uncommitted work discarded) |
| Open integration PR | #55 `cursor/integrate-cash-chart-upi-80c6` → `main` |
| Latest successful preview APK | EAS `e2fe065d-5219-42f5-a20a-f9bd6597de09` from integrate working tree / commit lineage of `50e5fe9`+pako → `6333ed4` |
| Destructive reset / force-push | Not used |

### Baseline selection evidence

1. `50e5fe9` is the last verified 23-feature parity commit (second-pass).
2. `6333ed4` is the same + declared `pako` / `@types/pako` (required for EAS Android Metro).
3. `origin/main` (`7da4285`) and current agent branch `hide-auction-set-driver` **lack** integrate features (cash book, chart, UPI, reports thermal list prints, etc.).
4. Therefore the authoritative recovery baseline is **`6333ed4`**, not `main` and not `2ddc980`.

### Confirmed regression (driver individual Print)

**Path:** Reports → Driver tab → select individual driver → PRINT  

| Ref | Handler | Bluetooth-only? | Result |
|---|---|---|---|
| `main` / `2ddc980` | `exportDriver` → `thermalPrintDriverReport` | No (`preferHtml: true`) | Opens Android system / expo-print dialog |
| Integrate `6333ed4` / `50e5fe9` | Same individual path | No (`preferHtml: true`) | **Still opens system dialog** |
| Integrate list Print (no driver selected) | `thermalPrintDriverDetailsReport` | Yes (`requireBluetooth: true`) | Correct ESC/POS |
| `a2e1cae` (`fix-driver-report-thermal-print`) | `thermalPrintDriverReport` | Yes (`requireBluetooth: true`) | Correct individual path |

**Root cause:** Individual Driver Details PRINT calls `thermalPrintDriverReport`, which on the integrate tip still uses `preferHtml: true` and does **not** set `requireBluetooth: true`, so `printThermalDocument` falls through to `printThermalHtmlOnly` → Android system print dialog.

**Best recovery source for this fix:** commit `a2e1caef33752d8639f384898ac88909884361ec` (targeted apply into integrate; do not replace newer integrate report list thermal code).

## Scope guardrails

- Lemon Mandi only  
- No RateCAD / RateBolo Construction  
- No secrets  
- No App Store / TestFlight submit  
- No production Android/iOS build until recovery verification passes  

## Executed recovery actions

1. Applied individual-driver `requireBluetooth` fix from `a2e1cae` into `thermalPrintDriverReport` (removed `preferHtml` / web system-print path for Print only; Share unchanged).  
2. Extended `verify-reports-thermal-print.ts` + added `verify-release-preflight.ts` so the individual path cannot silently regress.  
3. Wrote `docs/FEATURE_INVENTORY.md` and `docs/RELEASE_CHECKLIST.md`.  
4. Did **not** apply `2ddc980` wholesale — integrate already has stronger Dashboard/Reports `source` gates for SET DRIVER.  
5. Vendor bill QR cut already present on baseline (`cutAfterLastContent`).  

### Automated verify results (this recovery)

- `verify-reports-thermal-print.ts`: **70 passed**  
- `verify-ocr-farmer-name-snapshot.ts`: **14 passed**  
- `verify-physical-keyboard.ts`: OK  
- `verify-vendor-purchase-chart.ts`: PASS  
- `verify-chart-vendor-print.ts`: ALL OK  
- `verify-vendor-bill-no-bags.ts`: ALL OK  
- `verify-set-driver-nav.js`: ALL OK  
- `verify-release-preflight.ts`: **9 passed**  

### Physical Bluetooth printer

**Not performed** in this environment (no connected thermal printer). Code-path and automated checks only.  
