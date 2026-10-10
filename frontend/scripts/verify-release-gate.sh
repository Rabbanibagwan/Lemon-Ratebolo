#!/usr/bin/env bash
# Lemon Mandi release gate — fails if any critical automated check fails.
# Run from frontend/:  bash scripts/verify-release-gate.sh
# Or: npm run verify:release
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
SKIP=0

run() {
  local name="$1"
  shift
  echo ""
  echo "======== $name ========"
  if "$@"; then
    echo "GATE PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "GATE FAIL: $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "LEMON MANDI RELEASE GATE"
echo "cwd=$ROOT"
echo "git_sha=$(git -C "$ROOT/.." rev-parse HEAD 2>/dev/null || echo UNKNOWN)"
echo "git_branch=$(git -C "$ROOT/.." rev-parse --abbrev-ref HEAD 2>/dev/null || echo UNKNOWN)"

run "release-preflight" npx --yes tsx scripts/verify-release-preflight.ts
run "reports-thermal-print" npx --yes tsx scripts/verify-reports-thermal-print.ts
run "thermal-print-patti-bill" npx --yes tsx scripts/verify-thermal-print.ts
run "print-document" npx --yes tsx scripts/verify-print-document.ts
run "chart-vendor-print" npx --yes tsx scripts/verify-chart-vendor-print.ts
run "vendor-purchase-chart" npx --yes tsx scripts/verify-vendor-purchase-chart.ts
run "vendor-bill-no-bags" npx --yes tsx scripts/verify-vendor-bill-no-bags.ts
run "merchant-upi" npx --yes tsx scripts/verify-merchant-upi.ts
run "merchant-qr-upload" npx --yes tsx scripts/verify-merchant-qr-upload.ts
run "ocr-farmer-name-snapshot" npx --yes tsx scripts/verify-ocr-farmer-name-snapshot.ts
run "physical-keyboard" npx --yes tsx scripts/verify-physical-keyboard.ts
run "party-picker-keyboard" npx --yes tsx scripts/verify-party-picker-keyboard.ts
run "set-driver-nav" node scripts/verify-set-driver-nav.js

echo ""
echo "======== PHYSICAL TESTS ========"
echo "PHYSICAL TEST REQUIRED: Individual Driver Bluetooth thermal print on device"
echo "PHYSICAL TEST REQUIRED: Farmer Patti / Vendor Bill / Chart on connected printer"
SKIP=$((SKIP + 2))

echo ""
echo "GATE SUMMARY: pass=$PASS fail=$FAIL physical_required=$SKIP"
if [ "$FAIL" -gt 0 ]; then
  echo "RELEASE GATE: FAILED — do not mark VERIFIED / do not build release"
  exit 1
fi
echo "RELEASE GATE: AUTOMATED CHECKS PASSED"
echo "NOTE: Physical printer checks are still PHYSICAL TEST REQUIRED (not PASS)."
exit 0
