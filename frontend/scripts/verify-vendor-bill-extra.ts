/**
 * Vendor Bill Extra / Bag — formula + wiring checks (Vendor Bill only).
 * No RN runtime imports.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  vendorBillExtraTotal,
  vendorBillSellingRate,
} from "../src/utils/vendor-bill-totals";

const root = join(__dirname, "..");
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("OK:", msg);
  }
}

// --- Formula (matches product examples; factor=1 for clarity) ---
assert(vendorBillSellingRate(2000, 1, 30, 0) === 2030, "extra=0 → auction+margin only");
assert(vendorBillSellingRate(2000, 1, 30, 50) === 2080, "2000+30+50=2080");
assert(vendorBillSellingRate(2000, 1.06, 30, 50) === 2000 * 1.06 + 30 + 50, "factor preserved + extra once");
assert(vendorBillExtraTotal(10, 50) === 500, "10 bags × ₹50 = ₹500");
assert(vendorBillExtraTotal(8, 50) === 400, "8 bags × ₹50 = ₹400");

// Multi-line example from spec
const line1 = 5 * vendorBillSellingRate(2000, 1, 30, 50);
const line2 = 3 * vendorBillSellingRate(1500, 1, 30, 50);
assert(line1 === 10400, "line1 goods 10400");
assert(line2 === 4740, "line2 goods 4740");
assert(line1 + line2 === 15140, "multi-line goods 15140");

// --- Source wiring: form field between cess and Lines ---
const newSrc = readFileSync(join(root, "app/vendor-bill/new.tsx"), "utf8");
assert(newSrc.includes('label="+ Extra / bag ₹"'), "form has + Extra / bag field");
assert(newSrc.includes('testID="bill-extra"'), "form testID bill-extra");
assert(newSrc.includes("extra_per_bag"), "save payload includes extra_per_bag");
assert(newSrc.includes("vendorBillSellingRate"), "form uses shared selling-rate helper");
const cessIdx = newSrc.indexOf('label="Cess / Other (total) ₹"');
const extraIdx = newSrc.indexOf('label="+ Extra / bag ₹"');
const linesIdx = newSrc.indexOf("<Text style={styles.section}>Lines</Text>");
assert(cessIdx > 0 && extraIdx > cessIdx && linesIdx > extraIdx, "Extra field between Cess and Lines");

// Detail / print surfaces show Extra when > 0; rates already include it in Lemon total
const idSrc = readFileSync(join(root, "app/vendor-bill/[id].tsx"), "utf8");
assert(idSrc.includes("+ Extra / Bag"), "detail preview shows Extra / Bag");
const printSrc = readFileSync(join(root, "src/utils/vendor-bill-print.ts"), "utf8");
assert(printSrc.includes("+ Extra / Bag"), "PDF/thermal HTML shows Extra / Bag");
const escSrc = readFileSync(join(root, "src/utils/thermal-escpos-docs.ts"), "utf8");
assert(escSrc.includes("+ Extra / Bag"), "ESC/POS thermal shows Extra / Bag");

// Farmer Patti must not reference extra_per_bag
const pattiFiles = [
  "app/patti/[id].tsx",
  "src/utils/print-document.ts",
  "src/utils/thermal-escpos-docs.ts",
];
for (const rel of pattiFiles) {
  const src = readFileSync(join(root, rel), "utf8");
  if (rel.includes("thermal-escpos-docs")) {
    // Vendor Bill section may mention Extra; Farmer Patti encode fn must not.
    const pattiFn = src.match(/export function encodeFarmerPattiEscPos[\s\S]*?^export /m)?.[0] || "";
    assert(!pattiFn.includes("extra_per_bag") && !pattiFn.includes("Extra / Bag"), "Farmer Patti ESC/POS untouched");
  } else if (rel.includes("print-document")) {
    const pattiBuild = src.match(/export function buildFarmerPattiPrintDocument[\s\S]*?^export /m)?.[0] || "";
    assert(!pattiBuild.includes("extra_per_bag"), "Farmer Patti print document untouched");
  } else {
    assert(!src.includes("extra_per_bag"), `${rel} has no extra_per_bag`);
  }
}

const apiSrc = readFileSync(join(root, "src/api.ts"), "utf8");
assert(apiSrc.includes("extra_per_bag"), "VendorBill type has extra_per_bag");

if (failed) {
  console.error(`\nFAILED checks: ${failed}`);
  process.exit(1);
}
console.log("\nALL VENDOR BILL EXTRA / BAG CHECKS OK");
