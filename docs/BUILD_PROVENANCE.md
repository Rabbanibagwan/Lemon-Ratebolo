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

## Preview provenance (fill per run)

| Field | Value |
|---|---|
| Branch | |
| Full commit SHA | |
| Started at (UTC) | |
| Preview URL | |
| Inventory revision SHA | |
| `npm run verify:release` | |
| Notes | |

## Android APK provenance (fill per build)

| Field | Value |
|---|---|
| Branch | |
| Full commit SHA | |
| App version | 1.0.1 |
| versionCode | 3 |
| EAS build ID | |
| EAS URL | |
| APK URL | |
| Inventory revision SHA | |
| Release gate | |
| Physical printer | PHYSICAL TEST REQUIRED / PASS |

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
