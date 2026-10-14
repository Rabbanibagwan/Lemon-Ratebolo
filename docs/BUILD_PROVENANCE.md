# Lemon Mandi — Build Provenance

**Authoritative release branch (until merge to main):** `cursor/permanent-feature-recovery-80c6`  
**Feature inventory revision:** see `docs/FEATURE_INVENTORY.md` (commit that last updated it)  
**Release gate:** `cd frontend && npm run verify:release`

A successful EAS build does **not** prove features work.  
A clean Git tree does **not** prove features are present.  
Record the **exact SHA** used for every preview and store build.

## How to record a build

Before starting preview or EAS:

```bash
git branch --show-current
git rev-parse HEAD
git status --porcelain
cd frontend && npm run verify:release
```

Stop if the gate fails. Physical printer items remain `PHYSICAL TEST REQUIRED`.

After EAS finishes, copy fields from the EAS JSON/`build:view` output into the tables below.

## Known historical builds (evidence)

| Build | Platform | Profile | EAS ID | Status | gitCommitHash (as reported) | Notes |
|---|---|---|---|---|---|---|
| Preview APK (pako fix upload) | Android | preview | `e2fe065d-5219-42f5-a20a-f9bd6597de09` | FINISHED | `50e5fe9390b1f04fc7d79dd48d8d6def6ca0d3c2` | Working tree also included undeclared→declared pako; branch tip later `6333ed4`. **Missing** individual-driver `requireBluetooth` fix (`7e4347d`). |
| Prior failed APKs | Android | preview | `d7a3562b…`, `141f2214…`, `11a799b5…` | ERRORED | `50e5fe9` | Metro: unable to resolve `pako` |
| Final iOS production attempt | iOS | production | N/A (never queued) | FAILED credentials | Attempted at `50e5fe9` | No Apple team linked to Expo account |
| Current recovery tip | — | — | not built yet | — | `7e4347d6a4efac8008348d8163bdaaf175bcb65a` | Includes individual driver Bluetooth fix + gate/CI |
| OCR exact-match + staff/QR tip APK | Android | preview | `ec743a5d-70c3-4aa1-8f5d-b960c72bcead` | FINISHED | `8f5a085238c5d0040e715db3a4de33bd632ed80f` | OCR exact-only (33 PASS), staff driver print, vendor QR/bags/cut, Cash Book live API code |
| Login OCR isolation APK | Android | preview | `cbd082ec-c3ea-4b67-bce0-57bdaef57475` | FINISHED | `1b9aea214bd776b2242f2d3ddabaa5b97bc0e73b` | Login no longer shows OCR timeout; authErrorMessage + 120s AUTH timeout |

## Preview provenance (fill per run)

| Field | Value |
|---|---|
| Branch | `cursor/permanent-feature-recovery-80c6` |
| Full commit SHA | `8f5a085238c5d0040e715db3a4de33bd632ed80f` |
| Started at (UTC) | 2026-10-13 |
| Preview URL | (prior Cloudflare tunnel; restart if needed) |
| Inventory revision SHA | `8f5a085` |
| `npm run verify:release` | 16 PASS / 0 FAIL / 2 PHYSICAL |
| Notes | Backend `https://lemon-ratebolo.onrender.com` |

## Android APK provenance (fill per build)

| Field | Value |
|---|---|
| Branch | `cursor/permanent-feature-recovery-80c6` |
| Full commit SHA | `1b9aea214bd776b2242f2d3ddabaa5b97bc0e73b` |
| App version | 1.0.1 |
| versionCode | 3 |
| EAS build ID | `cbd082ec-c3ea-4b67-bce0-57bdaef57475` |
| EAS URL | https://expo.dev/accounts/rabanibagawan/projects/lemon-ratebolo/builds/cbd082ec-c3ea-4b67-bce0-57bdaef57475 |
| APK URL | https://expo.dev/artifacts/eas/Crfr9w0o-nF4p0Qs1csQvTTIvZPyyzfPHwTNMRnSnL4.apk |
| Inventory revision SHA | `1b9aea2` |
| Release gate | 17 PASS / 0 FAIL / 2 PHYSICAL |
| Physical printer | PHYSICAL TEST REQUIRED |

## iOS IPA provenance (fill per build)

| Field | Value |
|---|---|
| Branch | |
| Full commit SHA | |
| App version | 1.0.1 |
| ios.buildNumber | undefined in app.json (set before store) |
| Bundle ID | `com.emergent.lemonauctionhub.n49a6j` |
| EAS build ID | |
| EAS URL | |
| IPA URL | |
| Apple team linked | YES/NO |
| Release gate | |
| Physical printer | PHYSICAL TEST REQUIRED / PASS |

## Why older previews/APKs looked “missing features”

1. **Wrong source SHA:** builds from `main` or partial feature branches omit Cash Book / Chart / UPI / OCR exact / report list thermal.  
2. **Integrate SHA without driver fix:** `50e5fe9` / `6333ed4` still used `preferHtml` for **individual** Driver PRINT → Android system dialog.  
3. **EAS gitCommitHash** records the last commit; uncommitted dependency fixes may still be in the upload tarball — always prefer building from a **committed** tip after the release gate.  
