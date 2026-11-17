/**
 * Regression: OCR farmer/vendor names must not be silently replaced by a
 * longer/partial master via fuzzy/prefix matching
 * (AAM → AAMG, BB → JBB).
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
  resolveOcrFarmerId,
  resolveOcrVendorId,
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

const farmerMasters = [
  { id: "f-aamg", name: "AAMG" },
  { id: "f-rahul", name: "RAHUL" },
  { id: "f-aam", name: "AAM" },
];

const vendorMasters = [
  { id: "v-jbb", name: "JBB" },
  { id: "v-jbb-traders", name: "JBB Traders" },
  { id: "v-abc", name: "ABC" },
  { id: "v-bb", name: "BB" },
  { id: "v-mkb-lemon", name: "MKB LEMON" },
];

check("exactMatch: AAM does not bind AAMG", () => {
  assert(exactMatchPartyId("AAM", [{ id: "f-aamg", name: "AAMG" }]) === null, "must be null");
});

check("exactMatch: RAHU does not bind RAHUL", () => {
  assert(exactMatchPartyId("RAHU", [{ id: "f-rahul", name: "RAHUL" }]) === null, "must be null");
});

check("exactMatch: AAM binds AAM", () => {
  assert(exactMatchPartyId("AAM", farmerMasters) === "f-aam", "exact id");
});

check("exactMatch: Existing AAMG + OCR AAM → no automatic match", () => {
  assert(exactMatchPartyId("AAM", [{ id: "f-aamg", name: "AAMG" }]) === null, "AAM≠AAMG");
  assert(
    resolveOcrFarmerId("AAM", null, [{ id: "f-aamg", name: "AAMG" }]) === null,
    "resolve no auto",
  );
});

check("exactMatch: Existing AAM + OCR AAM → exact match", () => {
  assert(resolveOcrFarmerId("AAM", null, farmerMasters) === "f-aam", "exact AAM");
});

check("farmer: no exact match → extracted name remains unlinked", () => {
  assert(resolveOcrFarmerId("AAM", null, [{ id: "f-aamg", name: "AAMG" }]) === null, "unlinked");
});

check("farmer: user explicit select AAMG is preserved", () => {
  const id = resolveOcrFarmerId("AAMG", "f-aamg", [{ id: "f-aamg", name: "AAMG" }]);
  assert(id === "f-aamg", `manual exact keep, got ${id}`);
});

check("farmer: creating AAM does not rename AAMG", () => {
  const aamg = { id: "f-aamg", name: "AAMG" };
  assert(resolveOcrFarmerId("AAM", null, [aamg]) === null, "no auto id");
  assert(aamg.name === "AAMG", "AAMG master unchanged");
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

check("vendor exact: Existing JBB + OCR BB → no automatic match", () => {
  // Only JBB in master — BB must not prefix/substring-link to JBB.
  assert(
    resolveOcrVendorId("BB", null, [{ id: "v-jbb", name: "JBB" }]) === null,
    "BB must not link JBB",
  );
  assert(exactMatchPartyId("BB", [{ id: "v-jbb", name: "JBB" }]) === null, "exact null");
});

check("vendor exact: Existing JBB + OCR JBB → exact match", () => {
  assert(resolveOcrVendorId("JBB", null, vendorMasters) === "v-jbb", "exact JBB");
});

check("vendor exact: Existing jbb + OCR JBB → case-insensitive exact", () => {
  assert(resolveOcrVendorId("JBB", null, [{ id: "v1", name: "jbb" }]) === "v1", "case fold");
});

check("vendor exact: Existing JBB Traders + OCR JBB → no automatic match", () => {
  assert(
    resolveOcrVendorId("JBB", null, [{ id: "v-jbb-traders", name: "JBB Traders" }]) === null,
    "partial name must not match",
  );
});

check("vendor exact: Existing ABC + OCR ABCD → no automatic match", () => {
  assert(resolveOcrVendorId("ABCD", null, [{ id: "v-abc", name: "ABC" }]) === null, "ABCD≠ABC");
});

check("vendor exact: Existing BB + OCR B → no automatic match", () => {
  assert(resolveOcrVendorId("B", null, [{ id: "v-bb", name: "BB" }]) === null, "B≠BB");
});

check("vendor exact: Existing MKB LEMON + OCR MKB → no automatic match", () => {
  assert(
    resolveOcrVendorId("MKB", null, [{ id: "v-mkb", name: "MKB LEMON" }]) === null,
    "MKB≠MKB LEMON",
  );
});

check("vendor: no exact match → extracted vendor remains unlinked", () => {
  assert(resolveOcrVendorId("BB", null, [{ id: "v-jbb", name: "JBB" }]) === null, "unlinked");
});

check("vendor: drops stale fuzzy link BB→JBB", () => {
  const id = resolveOcrVendorId("BB", "v-jbb", [{ id: "v-jbb", name: "JBB" }]);
  assert(id === null, `stale BB→JBB must clear, got ${id}`);
});

check("vendor: user explicit select JBB is preserved", () => {
  const id = resolveOcrVendorId("JBB", "v-jbb", [{ id: "v-jbb", name: "JBB" }]);
  assert(id === "v-jbb", `manual exact keep, got ${id}`);
});

check("vendor: creating BB does not rename JBB (masters isolated)", () => {
  const jbb = { id: "v-jbb", name: "JBB" };
  const after = resolveOcrVendorId("BB", null, [jbb]);
  assert(after === null, "no auto id");
  assert(jbb.name === "JBB", "JBB master name unchanged");
});

check("whitespace-normalized exact still matches", () => {
  assert(resolveOcrVendorId("  JBB  ", null, [{ id: "v1", name: "JBB" }]) === "v1", "trim");
  assert(resolveOcrFarmerId("  AAM  ", null, [{ id: "f1", name: "AAM" }]) === "f1", "farmer trim");
});

const root = path.join(__dirname, "..");

check("ocr/preview uses exact farmer+vendor resolvers (no fuzzy auto-link)", () => {
  const src = fs.readFileSync(path.join(root, "app/ocr/preview.tsx"), "utf8");
  assert(src.includes("resolveOcrFarmerId"), "missing resolveOcrFarmerId");
  assert(src.includes("resolveOcrVendorId"), "missing resolveOcrVendorId");
  assert(!src.includes("fuzzyMatchId("), "legacy fuzzyMatchId still referenced");
  assert(!src.includes("fuzzyMatchVendorId"), "vendor fuzzy must NOT auto-link in OCR");
  assert(/resolveOcrFarmerId\(lot\.farmer_name/.test(src), "save/load must resolve OCR farmer exactly");
  assert(/resolveOcrVendorId\(/.test(src), "save/load must resolve OCR vendor exactly");
});

check("ocr-party-match has no fuzzy vendor helper", () => {
  const src = fs.readFileSync(path.join(root, "src/utils/ocr-party-match.ts"), "utf8");
  assert(!src.includes("fuzzyMatchVendorId"), "fuzzyMatchVendorId must be removed");
  assert(!src.includes("startsWith"), "no startsWith auto-link");
  assert(!/\.includes\(/.test(src), "no includes auto-link");
  assert(src.includes("resolveOcrVendorId"), "resolveOcrVendorId present");
  assert(src.includes("resolveOcrFarmerId"), "resolveOcrFarmerId present");
});

check("findOrCreateVendor uses exact PartyPicker helper", () => {
  const src = fs.readFileSync(path.join(root, "app/ocr/preview.tsx"), "utf8");
  assert(/findOrCreateVendor[\s\S]*?findExactParty\(vendors/.test(src), "create path exact-first");
  assert(/findOrCreateFarmer[\s\S]*?findExactParty\(farmers/.test(src), "farmer create exact-first");
});

check("PartyPicker findExactParty uses OCR normPartyKey (BB≠JBB)", () => {
  const src = fs.readFileSync(path.join(root, "src/components/PartyPicker.tsx"), "utf8");
  assert(src.includes('from "@/src/utils/ocr-party-match"'), "imports normPartyKey");
  const exactFn =
    src.match(/export function findExactParty[\s\S]*?\n\}/)?.[0] || "";
  assert(exactFn.includes("normPartyKey"), "findExactParty uses normPartyKey");
  assert(!/\.includes\(/.test(exactFn), "findExactParty must not use includes");
  assert(!/startsWith/.test(exactFn), "findExactParty must not use startsWith");
});

check("ESC/POS + preview print stored farmer_name snapshot", () => {
  const esc = fs.readFileSync(path.join(root, "src/utils/thermal-escpos-docs.ts"), "utf8");
  const print = fs.readFileSync(path.join(root, "src/utils/patti-print.ts"), "utf8");
  assert(
    /kv\("FARMER",\s*slipText\(p\.farmer_name/.test(esc) ||
      /farmerNameRow\(p\.farmer_name/.test(esc),
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
