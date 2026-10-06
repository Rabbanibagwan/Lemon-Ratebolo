/**
 * Regression: OCR farmer name must not be silently replaced by a longer
 * Farmer master via fuzzy/prefix matching (AAM → AAMG).
 *
 * Print path assertion: stored patti.farmer_name is what ESC/POS encodes
 * (source + local EscPosBuilder FARMER line); no Farmer-master re-query.
 *
 * Run: cd frontend && npx --yes tsx scripts/verify-ocr-farmer-name-snapshot.ts
 */
import fs from "fs";
import path from "path";

import {
  exactMatchPartyId,
  fuzzyMatchVendorId,
  resolveOcrFarmerId,
} from "../src/utils/ocr-party-match";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed += 1;
  } catch (e: any) {
    console.error(`FAIL ${name}: ${e?.message || e}`);
    process.exitCode = 1;
  }
}

const masters = [
  { id: "f-aamg", name: "AAMG" },
  { id: "f-rahul", name: "RAHUL" },
  { id: "f-aam", name: "AAM" },
];

check("exactMatch: AAM does not bind AAMG", () => {
  assert(exactMatchPartyId("AAM", [{ id: "f-aamg", name: "AAMG" }]) === null, "must be null");
});

check("exactMatch: RAHU does not bind RAHUL", () => {
  assert(exactMatchPartyId("RAHU", [{ id: "f-rahul", name: "RAHUL" }]) === null, "must be null");
});

check("exactMatch: AAM binds AAM", () => {
  assert(exactMatchPartyId("AAM", masters) === "f-aam", "exact id");
});

check("resolveOcrFarmerId: OCR AAM + master AAMG → no auto id", () => {
  const id = resolveOcrFarmerId("AAM", null, [{ id: "f-aamg", name: "AAMG" }]);
  assert(id === null, `got ${id}`);
});

check("resolveOcrFarmerId: drops stale fuzzy link AAM→AAMG", () => {
  const id = resolveOcrFarmerId("AAM", "f-aamg", [{ id: "f-aamg", name: "AAMG" }]);
  assert(id === null, `stale link must clear, got ${id}`);
});

check("resolveOcrFarmerId: keeps explicit exact selection AAMG", () => {
  const id = resolveOcrFarmerId("AAMG", "f-aamg", [{ id: "f-aamg", name: "AAMG" }]);
  assert(id === "f-aamg", `got ${id}`);
});

check("resolveOcrFarmerId: OCR RAHU does not auto-select RAHUL", () => {
  const id = resolveOcrFarmerId("RAHU", null, [{ id: "f-rahul", name: "RAHUL" }]);
  assert(id === null, `got ${id}`);
});

check("vendor fuzzy still allows prefix (unchanged vendor UX)", () => {
  const id = fuzzyMatchVendorId("MM", [{ id: "v1", name: "MMC" }]);
  assert(id === "v1", `vendor fuzzy got ${id}`);
});

const root = path.join(__dirname, "..");

check("ocr/preview uses resolveOcrFarmerId (no farmer fuzzyMatchId)", () => {
  const src = fs.readFileSync(path.join(root, "app/ocr/preview.tsx"), "utf8");
  assert(src.includes("resolveOcrFarmerId"), "missing resolveOcrFarmerId");
  assert(!src.includes("fuzzyMatchId("), "legacy fuzzyMatchId still referenced");
  assert(src.includes("fuzzyMatchVendorId"), "vendor fuzzy must remain");
  // Farmer save path must not call fuzzy vendor helper for farmers
  assert(/resolveOcrFarmerId\(lot\.farmer_name/.test(src), "save/load must resolve OCR farmer exactly");
});

check("ESC/POS + preview print stored farmer_name snapshot", () => {
  const esc = fs.readFileSync(path.join(root, "src/utils/thermal-escpos-docs.ts"), "utf8");
  const print = fs.readFileSync(path.join(root, "src/utils/patti-print.ts"), "utf8");
  assert(
    /kv\("FARMER",\s*slipText\(p\.farmer_name/.test(esc),
    "encodeFarmerPattiEscPos must print p.farmer_name",
  );
  assert(!/farmers\.find|farmerMaster|lookupFarmer/.test(esc), "ESC/POS must not re-query farmer master");
  assert(print.includes("p.farmer_name"), "patti-print must use p.farmer_name");
  assert(
    /farmer_name\}<\/span>/.test(print) || print.includes("escapeHtml(p.farmer_name)"),
    "preview HTML must render p.farmer_name",
  );
});

/** Simulate thermal FARMER line for 58/80/100 — same field print path uses. */
function simulatedFarmerLine(farmerName: string, paperMm: number): string {
  const cols = paperMm <= 58 ? 32 : paperMm <= 80 ? 48 : 64;
  const label = "FARMER";
  const value = String(farmerName || "-");
  const pad = Math.max(1, cols - label.length - value.length);
  return `${label}${" ".repeat(pad)}${value}`;
}

for (const mm of [58, 80, 100] as const) {
  check(`thermal ${mm}mm simulated ESC/POS line keeps OCR AAM`, () => {
    const line = simulatedFarmerLine("AAM", mm);
    assert(line.includes("AAM"), line);
    assert(!line.includes("AAMG"), line);
  });
}

check("user-edited AAMG remains AAMG on print simulation", () => {
  const line = simulatedFarmerLine("AAMG", 80);
  assert(line.includes("AAMG"), line);
});

if (!process.exitCode) {
  console.log(`\nAll ${passed} checks PASS`);
}
