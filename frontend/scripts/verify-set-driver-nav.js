#!/usr/bin/env node
/**
 * Verifies Auction Driver Day Setup auto-open gate:
 * open only when editDrivers=1 AND source is dashboard|reports.
 */
function shouldAutoOpenDriverDaySetup(editDrivers, source) {
  if (editDrivers !== "1") return false;
  return source === "dashboard" || source === "reports";
}

const cases = [
  { editDrivers: "", source: "", expect: false, name: "normal auction (no params)" },
  { editDrivers: "1", source: "", expect: false, name: "stale editDrivers without source" },
  { editDrivers: "1", source: "dashboard", expect: true, name: "Dashboard SET DRIVER" },
  { editDrivers: "1", source: "reports", expect: true, name: "Reports DRIVERS" },
  { editDrivers: "1", source: "auction", expect: false, name: "wrong source" },
  { editDrivers: "0", source: "dashboard", expect: false, name: "editDrivers off" },
  { editDrivers: "", source: "dashboard", expect: false, name: "source alone" },
];

let failed = 0;
for (const c of cases) {
  const got = shouldAutoOpenDriverDaySetup(c.editDrivers, c.source);
  if (got !== c.expect) {
    console.error(`FAIL: ${c.name} — expected ${c.expect}, got ${got}`);
    failed += 1;
  } else {
    console.log(`PASS: ${c.name}`);
  }
}

if (failed) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log("\nAll set-driver nav gate checks passed.");
