/**
 * Vendor Bill — No. of Bags calculation + surface wiring (no RN / expo imports).
 * Run: npx --yes tsx scripts/verify-vendor-bill-no-bags.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import { vendorBillNoBags } from "../src/utils/vendor-bill-totals";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

type Line = { bags: number; rate: number };

function makeBill(lines: Line[], total_bags?: number) {
  const mapped = lines.map((l, i) => ({
    lot_id: `lot-${i}`,
    lot_no: `${i + 1}/1`,
    farmer_name: `F${i + 1}`,
    bags: l.bags,
    auction_rate: l.rate,
    vendor_rate: l.rate,
    amount: l.bags * l.rate,
  }));
  const sumBags = mapped.reduce((n, l) => n + l.bags, 0);
  const goods = mapped.reduce((n, l) => n + l.amount, 0);
  return {
    lines: mapped,
    total_bags: total_bags ?? sumBags,
    goods_total: goods,
    commission_total: sumBags * 10,
    hamali: 0,
    cess: 0,
    grand_total: goods + sumBags * 10,
  };
}

// Example: 4 × 1 bag → No. of Bags 4; Lemon 15770; Comm 40; Grand 15810
const ex = makeBill([
  { bags: 1, rate: 4830 },
  { bags: 1, rate: 4330 },
  { bags: 1, rate: 5330 },
  { bags: 1, rate: 1280 },
]);
assert(vendorBillNoBags(ex) === 4, `example no bags got ${vendorBillNoBags(ex)}`);
assert(ex.goods_total === 15770, `lemon ${ex.goods_total}`);
assert(ex.commission_total === 40, `comm ${ex.commission_total}`);
assert(ex.grand_total === 15810, `grand ${ex.grand_total}`);

// 2 + 1 + 3 = 6
const multi = makeBill([
  { bags: 2, rate: 1000 },
  { bags: 1, rate: 2000 },
  { bags: 3, rate: 1500 },
]);
assert(vendorBillNoBags(multi) === 6, `multi bags ${vendorBillNoBags(multi)}`);

// Prefer line sum over stale total_bags
assert(vendorBillNoBags(makeBill([{ bags: 2, rate: 100 }, { bags: 3, rate: 100 }], 99)) === 5, "line sum beats stale");

// Empty / zero
assert(vendorBillNoBags({ lines: [], total_bags: 0 }) === 0, "empty 0");
assert(vendorBillNoBags({ lines: [{ bags: 0 }, { bags: 0 }], total_bags: 0 }) === 0, "zero lines");
assert(vendorBillNoBags({ lines: null as any, total_bags: 3 }) === 3, "fallback stored");
assert(vendorBillNoBags({ lines: undefined, total_bags: undefined }) === 0, "undefined 0");

// Many lots
const many = makeBill(Array.from({ length: 12 }, (_, i) => ({ bags: 1 + (i % 3), rate: 1000 })));
assert(vendorBillNoBags(many) === many.lines.reduce((n, l) => n + l.bags, 0), "many lots sum");

const root = join(__dirname, "..");
const LABEL = "No. of Bags";
const ui = readFileSync(join(root, "app/vendor-bill/[id].tsx"), "utf8");
assert(ui.includes(LABEL), "preview No. of Bags");
assert(ui.includes("vendorBillNoBags"), "preview uses helper");
assert(ui.includes('label="Lemon"'), "preview Lemon");
assert(ui.indexOf(LABEL) < ui.indexOf('label="Lemon"'), "preview order");
assert(ui.includes("bill-upi-qr-missing"), "preview missing-QR message");

const newUi = readFileSync(join(root, "app/vendor-bill/new.tsx"), "utf8");
assert(newUi.includes(`label="${LABEL}"`), "new bill No. of Bags");
assert(newUi.includes('label="Lemon"'), "new bill Lemon");
assert(newUi.indexOf(`label="${LABEL}"`) < newUi.indexOf('label="Lemon"'), "new bill order");

const printSrc = readFileSync(join(root, "src/utils/vendor-bill-print.ts"), "utf8");
assert(printSrc.includes(LABEL), "print util No. of Bags");
assert(printSrc.includes("vendorBillNoBags"), "print util helper");
assert(printSrc.includes("<span>Lemon</span>"), "PDF/thermal Lemon");
const pdfBlock = printSrc.match(/export function renderVendorBillPdfHtml[\s\S]*?^export /m)?.[0] || "";
assert(pdfBlock.includes(LABEL), "PDF function No. of Bags");
assert(pdfBlock.indexOf(LABEL) < pdfBlock.indexOf("Lemon"), "PDF order");
const thermBlock = printSrc.match(/export function renderThermalVendorBillHtml[\s\S]*?^export /m)?.[0] || "";
assert(thermBlock.includes(LABEL), "thermal HTML No. of Bags");
assert(thermBlock.indexOf(LABEL) < thermBlock.indexOf("Lemon"), "thermal HTML order");

const docs = readFileSync(join(root, "src/utils/thermal-escpos-docs.ts"), "utf8");
assert(docs.includes(`kv("${LABEL}"`), "escpos kv No. of Bags");
assert(docs.includes("vendorBillNoBags"), "escpos uses helper");
const escFn = docs.match(/export function encodeVendorBillEscPos[\s\S]*?^export /m)?.[0] || docs;
assert(escFn.includes(LABEL), "escpos fn No. of Bags");
assert(escFn.indexOf(LABEL) < escFn.indexOf('kv("Lemon"'), "escpos source order");
assert(escFn.includes("cutAfterLastContent"), "escpos cuts after QR");
assert(escFn.includes("merchantUploadedQrSection"), "escpos uses saved merchant QR");

const totalsSrc = readFileSync(join(root, "src/utils/vendor-bill-totals.ts"), "utf8");
assert(!totalsSrc.includes('from "@/src/api"'), "totals has no api runtime import");
assert(totalsSrc.includes("export function vendorBillNoBags"), "helper exported");

console.log("example No. of Bags=", vendorBillNoBags(ex), "Lemon=", ex.goods_total, "Grand=", ex.grand_total);
console.log("multi No. of Bags=", vendorBillNoBags(multi));
console.log("\nRESULTS:");
console.log("  NO. OF BAGS CALCULATION: PASS");
console.log("  PREVIEW wiring: PASS");
console.log("  PDF/SHARE: PASS");
console.log("  THERMAL PRINT: PASS");
console.log("  MULTIPLE BAG QUANTITIES: PASS");
console.log("ALL VENDOR BILL NO. OF BAGS CHECKS OK");
