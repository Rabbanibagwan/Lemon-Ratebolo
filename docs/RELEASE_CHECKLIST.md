# Lemon Mandi — Release Checklist

**Authoritative branch:** `cursor/permanent-feature-recovery-80c6` (until merged to `main`)  
**After merge:** `main` becomes authoritative; tag each release with the verified SHA.

A clean Git tree alone does **not** prove features are present.  
A successful EAS build alone does **not** prove features work.

## Before every preview / APK / iOS build

- [ ] On authoritative branch (`git branch --show-current`)
- [ ] Record exact SHA: `git rev-parse HEAD`
- [ ] Working tree clean **or** intentional uncommitted deps documented: `git status --porcelain`
- [ ] No unexpected RateCAD / Construction / unrelated diffs: `git diff --stat`
- [ ] Feature inventory reviewed: `docs/FEATURE_INVENTORY.md` (no open REGRESSED/MISSING for release scope)
- [ ] Run verify scripts (from `frontend/`):

```bash
npx --yes tsx scripts/verify-reports-thermal-print.ts
npx --yes tsx scripts/verify-ocr-farmer-name-snapshot.ts
npx --yes tsx scripts/verify-physical-keyboard.ts
npx --yes tsx scripts/verify-vendor-purchase-chart.ts
npx --yes tsx scripts/verify-chart-vendor-print.ts
npx --yes tsx scripts/verify-vendor-bill-no-bags.ts
node scripts/verify-set-driver-nav.js
```

- [ ] Local Android JS export (when shipping APK): `npx expo export --platform android`
- [ ] Required deps present (`pako` declared) if using png-mono / QR raster
- [ ] Stop if SHA, inventory, or verifies disagree

## During build

- [ ] Use existing EAS profiles only (`preview` APK / `production` as configured)
- [ ] Do not force-push
- [ ] Do not cherry-pick random commits into the release commit
- [ ] Do not start production build until verifies pass

## After build

- [ ] Record actual commit SHA EAS reports (`gitCommitHash`)
- [ ] Record app version + build number / versionCode
- [ ] Record EAS build ID + URL
- [ ] Record verify results (pass/fail counts)
- [ ] Confirm EAS status is **FINISHED** before calling the build successful
- [ ] Update `docs/FEATURE_INVENTORY.md` if behavior findings change
- [ ] Do **not** submit to App Store / TestFlight unless explicitly approved

## Preview provenance

| Field | Value |
|---|---|
| Branch | |
| Commit SHA | |
| Started at | |
| Preview URL | |
| Notes | |

## Android APK provenance

| Field | Value |
|---|---|
| Branch | |
| Commit SHA | |
| EAS build ID | |
| EAS URL | |
| APK URL | |
| Version / versionCode | |
| Verify scripts | |

## iOS IPA provenance

| Field | Value |
|---|---|
| Branch | |
| Commit SHA | |
| EAS build ID | |
| EAS URL | |
| IPA URL | |
| Bundle ID | |
| Version / build | |
| Apple team linked | YES/NO |
| Verify scripts | |

## Integration rules

1. Feature branches must be reviewed and verified before they are part of a release.  
2. Prefer merge/cherry-pick of the **best verified** implementation; never overwrite newer fixes with obsolete code.  
3. One Bluetooth thermal pipeline — do not add a second printer stack.  
4. Thermal Print actions must use `requireBluetooth: true` (no system dialog fallback).  
5. Share/Save/PDF paths may still use expo-print / file share.  
