# Lemon Mandi — Permanent Feature Recovery Report

**Authoritative branch:** `cursor/permanent-feature-recovery-80c6`  
**Candidate → verified tip (this revision):** see `git rev-parse HEAD` after push  
**Prior tip verified as baseline:** `7e4347d6a4efac8008348d8163bdaaf175bcb65a`  
**Umbrella parent:** `6333ed4076aa5d69ff5dba1ef5aa82f2dde465b6` (`50e5fe9` + pako)  
**Reference parity commit:** `50e5fe9390b1f04fc7d79dd48d8d6def6ca0d3c2`

## Phase 1 — Baseline verification

| Check | Result |
|---|---|
| Full SHA of `7e4347d` | `7e4347d6a4efac8008348d8163bdaaf175bcb65a` |
| Parent | `6333ed4076aa5d69ff5dba1ef5aa82f2dde465b6` |
| Branch exists + pushed | YES (`origin/cursor/permanent-feature-recovery-80c6`) |
| `50e5fe9` ancestor | YES |
| Force-push / destructive reset | NOT used |
| Working tree before this revision | Clean at `7e4347d` |

### Provenance of recent builds

| Artifact | Commit | Features note |
|---|---|---|
| Latest known FINISHED APK `e2fe065d-…` | EAS reported `50e5fe9` | Has integrate features; **REGRESSED** individual driver PRINT (system dialog); has pako in upload |
| iOS production | Never queued | Apple team missing |
| Preview currently running | **UNKNOWN** (no live preview provenance in this agent) | Must print SHA before start |

## Phase 3 — Root causes (with evidence)

| ID | Root cause | Affected features | Evidence |
|---|---|---|---|
| R1 | Feature commits never merged to `main` | Cash Book, Chart, UPI, OCR exact, physical Enter, report list thermal, vendor details thermal | `main` lacks cash-book routes, chart-print, ocr-party-match exact, etc. Open PR #55 |
| R2 | Integrate tip still had obsolete individual-driver handler | Individual Driver Details PRINT | `thermalPrintDriverReport` used `preferHtml: true` on `50e5fe9`/`6333ed4`; fixed from `a2e1cae` |
| R3 | APK/preview built from older or non-recovery SHA | Any feature only on recovery/integrate | EAS `gitCommitHash` `50e5fe9` for last APK; not `7e4347d` |
| R4 | Partial cherry-pick / dual print stacks historically | Driver PRINT vs list PRINT | List used `requireBluetooth`; individual used HTML/system path |
| R5 | PartyPicker keyboard util present but unwired on integrate | OCR/Directory PartyPicker IME sizing | `party-picker-keyboard.ts` on tip; PartyPicker lacked `useKeyboardState` until recovered from `combine` |
| R6 | Backend model lag vs frontend optional field | `upi_name` PARTIAL | Frontend sends `upi_name`; backend ShopProfile has only `upi_id` / `upi_qr_base64` |
| R7 | Missing declared dependency broke EAS | png-mono / QR raster | Metro “Unable to resolve pako” until `6333ed4` |
| R8 | No release gate / CI historically | All regressions | No workflow before this recovery; `main` has zero `verify-*` scripts |

## Recoveries applied

1. **Individual driver Bluetooth PRINT** (`a2e1cae` → `7e4347d`): `requireBluetooth: true`, no `preferHtml`.  
2. **PartyPicker dynamic keyboard** (from `combine-save-latest-cash-book`): `useKeyboardState` + maxHeight helpers.  
3. **Verify scripts restored** from combine + adapted to current integrate design (not obsolete netbox/upi_name backend strings).  
4. **Release gate** `npm run verify:release` + GitHub Actions workflow (no secrets).  
5. **Docs:** FEATURE_INVENTORY, RELEASE_CHECKLIST, BUILD_PROVENANCE, this report.

## Automated gate result (this revision)

```
npm run verify:release
→ 15 automated PASS, 0 FAIL, 2 PHYSICAL TEST REQUIRED
```

## Capacity / OCR concurrency integration (2026-10-12)

| Item | Value |
|---|---|
| Source PR | #58 `cursor/capacity-ocr-cashbook-audit-80c6` |
| Review tip | `e68ac16096ba83abfbcda76efbb965851bc51642` |
| Merge commit | `613681e160df840298294d42c596cd6dbf86635c` |
| Recovery tip (docs) | `64fe3a8d475b5794a975212193a8ee358d9d2972` |
| Review | Diff vs recovery tip clean; no intervening recovery commits lost |
| Cash Book ↔ OCR incident causality | **UNKNOWN** (no historical logs); Cash Book has **no** backend API |
| OCR semaphore scope | **Process-local** (`OCR_MAX_CONCURRENT`, default 2) — not fleet-wide |
| Fix | Provider slot released during retry backoff; queue wait timeout; structured metrics |
| Fallback chain | `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-3.5-flash-lite` preserved |
| OCR vendor exact / AAM≠AAMG | Preserved (27 PASS) |
| Backend mocked OCR tests | 38 PASS |
| Release gate on recovery tip | **15 PASS / 0 FAIL / 2 PHYSICAL** |
| Production load test | **NOT RUN** |
| APK | Not built (build pause) |

## Scope confirmations

- RATECAD: NO  
- RateBolo Construction: NO  
- Secrets: NO  
- No APK/iOS production build in this recovery pass  
- No App Store / TestFlight submit


## OCR vendor exact-match integration (2026-10-12)

| Item | Value |
|---|---|
| Source PR | #57 `cursor/fix-ocr-vendor-exact-match-80c6` |
| Fix commit | `be5d4213d533fb7e0d96126f9e25300fe4eaed5c` |
| Merged into | `cursor/permanent-feature-recovery-80c6` |
| Merge commit | `0278b00fc1c51777039178c0f04e97d7d2b812e3` |
| Docs tip (pre-final) | `781d969aa514451a44b9c89c950dfefa3b8e6838` |
| BB ≠ JBB auto-link | PASS (verify-ocr-farmer-name-snapshot) |
| AAM ≠ AAMG farmer | PASS (same suite) |
| `fuzzyMatchVendorId` on tip | Removed from OCR path |
| Release gate | 13 PASS / 0 FAIL / 2 PHYSICAL TEST REQUIRED |
| APK | Not built (build pause) |
