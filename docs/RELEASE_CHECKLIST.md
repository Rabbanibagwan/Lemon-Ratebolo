# Lemon Mandi — Release Checklist

**Authoritative branch (pre-merge):** `cursor/permanent-feature-recovery-80c6`  
**After merge:** `main` becomes authoritative; always record the release SHA.

A clean Git tree alone does **not** prove features are present.  
A successful EAS build alone does **not** prove features work.

## Single release command (required)

```bash
cd frontend
npm run verify:release
```

This runs all automated verifies and **fails the release** if any critical check fails.  
Physical Bluetooth printer checks are labeled **PHYSICAL TEST REQUIRED** (not false PASS).

CI: `.github/workflows/lemon-mandi-verify.yml` runs the same gate on PRs touching `frontend/` / docs (no secrets).

## Before every preview / APK / iOS build

- [ ] On authoritative branch (`git branch --show-current`)
- [ ] Record full SHA: `git rev-parse HEAD`
- [ ] Working tree documented: `git status --porcelain`
- [ ] No RateCAD / Construction / unrelated diffs
- [ ] `docs/FEATURE_INVENTORY.md` reviewed (no open MISSING/REGRESSED for release scope)
- [ ] `npm run verify:release` **PASS**
- [ ] Print branch + SHA in the preview/build log
- [ ] Stop if SHA, inventory, or gate disagree

## During build

- [ ] Use existing EAS profiles only
- [ ] Build from the **committed** SHA that passed the gate (no “mystery” uncommitted app changes)
- [ ] Do not force-push
- [ ] Do not randomly cherry-pick into the release tip

## After build

- [ ] Fill `docs/BUILD_PROVENANCE.md` tables (branch, SHA, version, EAS ID/URL, gate result)
- [ ] Confirm EAS status is **FINISHED**
- [ ] Confirm EAS `gitCommitHash` matches the intended SHA (or document intentional variance)
- [ ] Physical printer: mark PHYSICAL TEST REQUIRED until device-tested
- [ ] Do not App Store / TestFlight submit unless explicitly approved

## Critical features that must stay green in the gate

- Individual Driver thermal PRINT (`requireBluetooth`, no system dialog)
- Driver list + Vendor Details thermal PRINT
- Farmer Patti / Vendor Bill ESC/POS widths 58/80/100
- Vendor Chart thermal PRINT
- Merchant UPI + uploaded QR
- OCR farmer-name snapshot
- SET DRIVER source gate
- Physical keyboard helpers
- PartyPicker keyboard sizing
- pako declared

## Preview start snippet

```bash
echo "PREVIEW_BRANCH=$(git branch --show-current)"
echo "PREVIEW_SHA=$(git rev-parse HEAD)"
cd frontend && npm run verify:release
# then start Expo / tunnel only if gate passed
```
