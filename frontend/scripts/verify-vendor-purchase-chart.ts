/**
 * Vendor Purchase Chart — weighted average + layout helpers.
 * Run: npx --yes tsx scripts/verify-vendor-purchase-chart.ts
 */
import type { Lot } from "../src/api";
import {
  buildVendorPurchaseChart,
  filterVendorPurchaseChart,
  formatChartPurchaseLine,
  formatChartRate,
} from "../src/utils/vendor-purchase-chart";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
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
    date: "2026-09-27",
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
    created_at: "2026-09-27T10:00:00.000Z",
  } as Lot;
}

// Spec example — Vendor A / Vendor B
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

const chart = buildVendorPurchaseChart(lots, "2026-09-27");
assert(chart.total_vendors === 2, "2 vendors");
assert(chart.vendors[0].vendor_name === "VENDOR A", "sorted A first");
assert(chart.vendors[1].vendor_name === "VENDOR B", "B second");

const a = chart.vendors[0];
assert(a.total_bags === 4, `A bags ${a.total_bags}`);
assert(a.total_amount === 8000, `A amount ${a.total_amount}`);
assert(a.avg_rate === 2000, `A avg weighted 2000 got ${a.avg_rate}`);
// Must NOT be simple average (1500+2500+1500)/3 = 1833.33
assert(a.avg_rate !== Math.round(((1500 + 2500 + 1500) / 3) * 100) / 100, "not simple avg");

const b = chart.vendors[1];
assert(b.total_bags === 2, `B bags ${b.total_bags}`);
assert(b.total_amount === 1900, `B amount ${b.total_amount}`);
assert(b.avg_rate === 950, `B avg 950 got ${b.avg_rate}`);

assert(chart.total_bags === 6, "day bags");
assert(chart.total_amount === 9900, "day amount");
assert(chart.overall_avg_rate === 1650, `overall weighted 9900/6=1650 got ${chart.overall_avg_rate}`);
// Must NOT average vendor avgs: (2000+950)/2 = 1475
assert(chart.overall_avg_rate !== 1475, "overall not mean of avgs");

assert(a.rows.every((r) => r.farmer_name !== "VENDOR A"), "farmer ≠ vendor");
assert(a.rows.some((r) => r.farmer_name === "RMBG"), "farmer RMBG");
assert(a.rows.some((r) => r.farmer_name === "SBAG"), "farmer SBAG");
assert(a.rows.some((r) => r.farmer_name === "SMDG"), "farmer SMDG");

const line = formatChartPurchaseLine(a.rows[0], { includeLot: true });
assert(/^\d+×\d+/.test(line), `line format ${line}`);
assert(line.includes("RMBG") || a.rows[0].farmer_name !== "RMBG", "farmer in line");

assert(formatChartRate(2000) === "2000", "int rate");
assert(formatChartRate(2166.666) === "2166.67", "decimal avg");

// Date filter: other-day lots ignored
const mixed = buildVendorPurchaseChart(
  [...lots, { ...lots[0], id: "other", date: "2026-09-26" }],
  "2026-09-27",
);
assert(mixed.total_bags === 6, "other date excluded");

// Search filter
const onlyA = filterVendorPurchaseChart(chart, "VENDOR A");
assert(onlyA.total_vendors === 1 && onlyA.vendors[0].vendor_name === "VENDOR A", "filter vendor");
const byFarmer = filterVendorPurchaseChart(chart, "SMK");
assert(byFarmer.total_vendors === 1 && byFarmer.vendors[0].vendor_name === "VENDOR B", "filter farmer");

// Empty
const empty = buildVendorPurchaseChart([], "2026-09-27");
assert(empty.total_vendors === 0 && empty.overall_avg_rate === 0, "empty chart");

console.log("Vendor A: 4 Avg", formatChartRate(a.avg_rate));
console.log("Vendor B: 2 Avg", formatChartRate(b.avg_rate));
console.log("Overall:", chart.total_bags, "bags", "Avg", formatChartRate(chart.overall_avg_rate));
console.log("PASS");
