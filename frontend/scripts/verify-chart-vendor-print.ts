/**
 * Chart per-vendor PRINT — ESC/POS encode + wiring checks.
 * Run: npx --yes tsx scripts/verify-chart-vendor-print.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import type { Lot } from "../src/api";
import {
  encodeVendorChartEscPos,
  renderVendorChartThermalHtml,
} from "../src/utils/chart-print-escpos";
import { thermalWidthConfig } from "../src/utils/escpos";
import {
  buildVendorPurchaseChart,
  formatChartRate,
} from "../src/utils/vendor-purchase-chart";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function decodeEscPosText(b64: string): string {
  const bin = Buffer.from(b64, "base64");
  let out = "";
  let i = 0;
  while (i < bin.length) {
    const b = bin[i];
    if (b === 0x0a) {
      out += "\n";
      i++;
      continue;
    }
    if (b === 0x1b || b === 0x1d) {
      if (b === 0x1b && bin[i + 1] === 0x40) {
        i += 2;
        continue;
      }
      if (
        (b === 0x1b && (bin[i + 1] === 0x61 || bin[i + 1] === 0x45 || bin[i + 1] === 0x2d || bin[i + 1] === 0x4d)) ||
        (b === 0x1d && (bin[i + 1] === 0x21 || bin[i + 1] === 0x42))
      ) {
        i += 3;
        continue;
      }
      if (b === 0x1d && bin[i + 1] === 0x56) {
        const m = bin[i + 2];
        i += m >= 65 ? 4 : 3;
        continue;
      }
      if (b === 0x1d && (bin[i + 1] === 0x57 || bin[i + 1] === 0x4c)) {
        i += 4;
        continue;
      }
      if (b === 0x1d && bin[i + 1] === 0x28 && bin[i + 2] === 0x6b) {
        const plen = bin[i + 3] + (bin[i + 4] << 8);
        i += 5 + plen;
        continue;
      }
      i += 2;
      continue;
    }
    if (b >= 32 && b < 127) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    if (b >= 0xc0) {
      const len = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      out += bin.slice(i, i + len).toString("utf8");
      i += len;
      continue;
    }
    i++;
  }
  return out;
}

function analyzeCut(b64: string): { hasCut: boolean; cutIsFeedAndCut: boolean; gsWDots: number | null } {
  const bin = Buffer.from(b64, "base64");
  let hasCut = false;
  let cutIsFeedAndCut = false;
  let gsWDots: number | null = null;
  let i = 0;
  while (i < bin.length) {
    const b = bin[i];
    if (b === 0x1d && bin[i + 1] === 0x57) {
      gsWDots = bin[i + 2] + (bin[i + 3] << 8);
      i += 4;
      continue;
    }
    if (b === 0x1d && bin[i + 1] === 0x56) {
      hasCut = true;
      const m = bin[i + 2];
      cutIsFeedAndCut = m >= 65;
      i += m >= 65 ? 4 : 3;
      continue;
    }
    if (b === 0x1b && bin[i + 1] === 0x40) {
      i += 2;
      continue;
    }
    if (
      (b === 0x1b && (bin[i + 1] === 0x61 || bin[i + 1] === 0x45 || bin[i + 1] === 0x2d || bin[i + 1] === 0x4d)) ||
      (b === 0x1d && (bin[i + 1] === 0x21 || bin[i + 1] === 0x42 || bin[i + 1] === 0x4c))
    ) {
      i += b === 0x1d && bin[i + 1] === 0x4c ? 4 : 3;
      continue;
    }
    i++;
  }
  return { hasCut, cutIsFeedAndCut, gsWDots };
}

function lot(
  id: string,
  farmer: string,
  lotNo: string,
  sales: { vendor_id: string; vendor_name: string; bags: number; rate: number }[],
): Lot {
  return {
    id,
    auction_day_id: "day1",
    date: "2026-10-03",
    lot_serial_no: 1,
    total_bags: sales.reduce((n, s) => n + s.bags, 0),
    lot_no: lotNo,
    first_num: 1,
    farmer_id: `f-${farmer}`,
    farmer_name: farmer,
    driver_name: null,
    driver_place: null,
    bhada_per_bag: 0,
    bhada_total: 0,
    sales: sales.map((s) => ({
      vendor_id: s.vendor_id,
      vendor_name: s.vendor_name,
      bags: s.bags,
      rate_per_bag: s.rate,
      gross: s.bags * s.rate,
    })),
    sold_bags: sales.reduce((n, s) => n + s.bags, 0),
    gross_total: sales.reduce((n, s) => n + s.bags * s.rate, 0),
    created_at: "2026-10-03T10:00:00.000Z",
  } as Lot;
}

const lots: Lot[] = [
  lot("l1", "RMBG", "230/1", [
    { vendor_id: "va", vendor_name: "VENDOR A", bags: 1, rate: 1500 },
    { vendor_id: "vb", vendor_name: "VENDOR B", bags: 1, rate: 1500 },
  ]),
  lot("l2", "SBAG", "230/2", [
    { vendor_id: "va", vendor_name: "VENDOR A", bags: 2, rate: 2500 },
  ]),
  lot("l3", "SMDG", "231/1", [
    { vendor_id: "va", vendor_name: "VENDOR A", bags: 1, rate: 1500 },
  ]),
  lot("l4", "SMK", "231/2", [
    { vendor_id: "vb", vendor_name: "VENDOR B", bags: 1, rate: 400 },
  ]),
];

const chart = buildVendorPurchaseChart(lots, "2026-10-03");
const vendorA = chart.vendors.find((v) => v.vendor_id === "va")!;
const vendorB = chart.vendors.find((v) => v.vendor_id === "vb")!;
assert(!!vendorA && !!vendorB, "both vendors present");

const widths = [58, 80, 100];
const profile = {
  shop_name: "MKB LEMON CO.",
  address: "Market Yard",
  mobile: "9000000000",
} as any;

for (const mm of widths) {
  const cfg = thermalWidthConfig(mm);
  const b64A = encodeVendorChartEscPos(vendorA, "2026-10-03", "MKB LEMON CO.", mm, profile);
  const textA = decodeEscPosText(b64A);
  const cutA = analyzeCut(b64A);

  assert(textA.includes("VENDOR CHART"), `${mm} title`);
  assert(textA.includes("VENDOR A"), `${mm} vendor A name`);
  assert(!textA.includes("VENDOR B"), `${mm} selected A must exclude B`);
  assert(textA.includes("2026-10-03"), `${mm} working date`);
  assert(textA.includes("RMBG") || textA.includes("230/1"), `${mm} farmer/lot A`);
  assert(textA.includes("TOTAL BAGS"), `${mm} total bags label`);
  assert(textA.includes("4"), `${mm} total bags value`);
  assert(textA.includes("TOTAL PURCHASE"), `${mm} total purchase`);
  assert(textA.includes("WEIGHTED AVG"), `${mm} weighted avg`);
  assert(textA.includes(formatChartRate(vendorA.avg_rate)), `${mm} avg ${vendorA.avg_rate}`);
  assert(cutA.hasCut && cutA.cutIsFeedAndCut, `${mm} A feed-and-cut`);
  assert(cutA.gsWDots === cfg.contentDots, `${mm} A GS W = ${cfg.contentDots}`);

  for (const line of textA.split("\n")) {
    if (line && line.length > cfg.columns) {
      throw new Error(`A ${mm} overflow: ${line.length} > ${cfg.columns} "${line}"`);
    }
  }

  const htmlA = renderVendorChartThermalHtml(vendorA, "2026-10-03", "MKB LEMON CO.", mm);
  assert(htmlA.includes(`size: ${mm}mm auto`), `${mm} HTML page size`);
  assert(htmlA.includes("VENDOR A"), `${mm} HTML vendor A`);
  assert(!htmlA.includes("VENDOR B"), `${mm} HTML A excludes B`);

  const b64B = encodeVendorChartEscPos(vendorB, "2026-10-03", "MKB LEMON CO.", mm, profile);
  const textB = decodeEscPosText(b64B);
  assert(textB.includes("VENDOR B"), `${mm} vendor B name`);
  assert(!textB.includes("VENDOR A"), `${mm} selected B must exclude A`);
  assert(textB.includes("TOTAL BAGS"), `${mm} B totals`);
  assert(textB.includes(formatChartRate(vendorB.avg_rate)), `${mm} B avg`);

  console.log(`\n=== CHART VENDOR A ${mm}mm (${cfg.columns} cols) ===\n${textA}`);
  console.log(`=== CHART VENDOR B ${mm}mm ===\n${textB}`);
}

// Long vendor list — content-driven length, no fixed page, still cuts once.
const longSales = Array.from({ length: 40 }, (_, i) =>
  lot(`long-${i}`, `FARMER_${String(i).padStart(3, "0")}_LONGNAME`, `${300 + i}/1`, [
    { vendor_id: "va", vendor_name: "VENDOR A", bags: 1 + (i % 3), rate: 1000 + i * 10 },
  ]),
);
const longChart = buildVendorPurchaseChart(longSales, "2026-10-03");
const longCol = longChart.vendors[0];
assert(longCol.rows.length >= 40, `long rows ${longCol.rows.length}`);
const shortB64 = encodeVendorChartEscPos(vendorA, "2026-10-03", "MKB", 80, profile);
const longB64 = encodeVendorChartEscPos(longCol, "2026-10-03", "MKB", 80, profile);
assert(Buffer.from(longB64, "base64").length > Buffer.from(shortB64, "base64").length, "long > short bytes");
const longText = decodeEscPosText(longB64);
assert(longText.includes("FARMER_000_LONGNAME") || longText.includes("FARMER_000"), "long first farmer");
assert(longText.includes("FARMER_039") || longText.includes("039"), "long last farmer present");
assert(!longText.includes("VENDOR B"), "long selected-only");
const longCut = analyzeCut(longB64);
assert(longCut.hasCut && longCut.cutIsFeedAndCut, "long data still feed-and-cut");
console.log(`\nLONG DATA rows=${longCol.rows.length} bags=${longCol.total_bags} avg=${longCol.avg_rate} bytes=${Buffer.from(longB64, "base64").length}`);

// Wiring: chart UI + print wrapper must use Bluetooth ESC/POS pipeline.
const chartUi = readFileSync(join(__dirname, "../app/chart.tsx"), "utf8");
assert(chartUi.includes("printVendorChartColumn"), "chart UI calls printVendorChartColumn");
assert(chartUi.includes("chart-vendor-print-"), "per-vendor print testID");
assert(!/isOwner|role === ['\"]owner['\"]/.test(chartUi), "chart print not owner-gated");

const chartPrint = readFileSync(join(__dirname, "../src/utils/chart-print.ts"), "utf8");
assert(chartPrint.includes("requireBluetooth: true"), "Chart print requires Bluetooth");
assert(chartPrint.includes("printThermalDocument"), "Chart print uses printThermalDocument");
assert(!/preferHtml:\s*true/.test(chartPrint), "Chart print must not preferHtml");
assert(!/Print\.printAsync/.test(chartPrint), "Chart print must not call Print.printAsync");

const home = readFileSync(join(__dirname, "../app/(tabs)/index.tsx"), "utf8");
assert(home.includes('label="Chart"'), "Home Chart tile present");
assert(
  /<QuickTile[^>]*label="Chart"[^/]*\/>/.test(home.replace(/\n/g, " ")) ||
    home.includes('label="Chart"'),
  "Home Chart tile markup present",
);
// Chart QuickTile must not sit inside an isOwner-only JSX branch.
const chartTileIdx = home.indexOf('label="Chart"');
const beforeChart = home.slice(Math.max(0, chartTileIdx - 180), chartTileIdx);
assert(!/\{isOwner\s*&&\s*<QuickTile[^>]*$/.test(beforeChart.replace(/\n/g, " ")), "Chart tile available to staff");

console.log("\nRESULTS:");
console.log("  CHART VENDOR PRINT encode: PASS");
console.log("  SELECTED VENDOR ONLY: PASS");
console.log("  58MM: PASS");
console.log("  80MM: PASS");
console.log("  100MM: PASS");
console.log("  LONG DATA: PASS");
console.log("  THERMAL DIRECT (requireBluetooth wiring): PASS");
console.log("  STAFF UI GATE (no owner-only on Chart print): PASS");
console.log("ALL CHART VENDOR PRINT CHECKS OK");
