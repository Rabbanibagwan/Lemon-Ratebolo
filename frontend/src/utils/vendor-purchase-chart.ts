/**
 * Live Auction Vendor Purchase Chart — VIEW over Action Diary lots/sales.
 * Does not create purchase records. Weighted average: SUM(bags×rate) / SUM(bags).
 */
import type { Lot } from "@/src/api";

export type ChartPurchaseRow = {
  bags: number;
  rate: number;
  farmer_name: string;
  lot_no: string;
  lot_id: string;
  vendor_id: string;
  vendor_name: string;
};

export type ChartVendorColumn = {
  vendor_id: string;
  vendor_name: string;
  rows: ChartPurchaseRow[];
  total_bags: number;
  /** SUM(bags × auction rate) — purchase amount at auction rates. */
  total_amount: number;
  /** Weighted average rate: total_amount / total_bags (0 when no bags). */
  avg_rate: number;
};

export type VendorPurchaseChart = {
  date: string;
  vendors: ChartVendorColumn[];
  total_vendors: number;
  total_bags: number;
  total_amount: number;
  overall_avg_rate: number;
};

/** Format rate/avg for compact Chart cells (no ₹, no thousands separators). */
export function formatChartRate(n: number): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  const r = Math.round(v * 100) / 100;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return r.toFixed(2);
}

/** Compact purchase line: `1×1500 RMBG` or `1×1500 RMBG (230/2)` when lot fits. */
export function formatChartPurchaseLine(
  row: Pick<ChartPurchaseRow, "bags" | "rate" | "farmer_name" | "lot_no">,
  opts?: { includeLot?: boolean; maxLen?: number },
): string {
  const farmer = String(row.farmer_name || "").trim() || "—";
  const base = `${row.bags}×${formatChartRate(row.rate)} ${farmer}`;
  const maxLen = opts?.maxLen ?? 28;
  if (!opts?.includeLot) {
    return base.length <= maxLen ? base : base.slice(0, Math.max(1, maxLen - 1)) + ".";
  }
  const lot = String(row.lot_no || "").trim();
  if (!lot) return base.length <= maxLen ? base : base.slice(0, Math.max(1, maxLen - 1)) + ".";
  const withLot = `${base} (${lot})`;
  if (withLot.length <= maxLen) return withLot;
  return base.length <= maxLen ? base : base.slice(0, Math.max(1, maxLen - 1)) + ".";
}

function weightedAvg(amount: number, bags: number): number {
  if (!(bags > 0)) return 0;
  return Math.round((amount / bags) * 100) / 100;
}

/**
 * Build Chart columns from today's lots (Action Diary source of truth).
 * Includes pending and posted sales — Chart is monitoring, not billing.
 * Rate = auction rate_per_bag (as entered), not vendor-bill adjusted rate.
 */
export function buildVendorPurchaseChart(lots: Lot[], dateISO: string): VendorPurchaseChart {
  const map = new Map<string, ChartVendorColumn>();

  for (const lot of lots || []) {
    if (dateISO && lot.date && lot.date !== dateISO) continue;
    const farmer = String(lot.farmer_name || "").trim() || "—";
    const lotNo = String(lot.lot_no || "").trim();
    for (const s of lot.sales || []) {
      const vid = String(s.vendor_id || "").trim();
      if (!vid) continue;
      const bags = Math.max(0, Math.floor(Number(s.bags) || 0));
      const rate = Number(s.rate_per_bag) || 0;
      if (bags <= 0) continue;
      const amount = bags * rate;
      let col = map.get(vid);
      if (!col) {
        col = {
          vendor_id: vid,
          vendor_name: String(s.vendor_name || "").trim() || "Vendor",
          rows: [],
          total_bags: 0,
          total_amount: 0,
          avg_rate: 0,
        };
        map.set(vid, col);
      }
      col.rows.push({
        bags,
        rate,
        farmer_name: farmer,
        lot_no: lotNo,
        lot_id: lot.id,
        vendor_id: vid,
        vendor_name: col.vendor_name,
      });
      col.total_bags += bags;
      col.total_amount += amount;
    }
  }

  const vendors = [...map.values()]
    .map((c) => ({
      ...c,
      total_amount: Math.round(c.total_amount * 100) / 100,
      avg_rate: weightedAvg(c.total_amount, c.total_bags),
    }))
    .sort((a, b) => a.vendor_name.localeCompare(b.vendor_name, undefined, { sensitivity: "base" }));

  let total_bags = 0;
  let total_amount = 0;
  for (const v of vendors) {
    total_bags += v.total_bags;
    total_amount += v.total_amount;
  }
  total_amount = Math.round(total_amount * 100) / 100;

  return {
    date: dateISO,
    vendors,
    total_vendors: vendors.length,
    total_bags,
    total_amount,
    overall_avg_rate: weightedAvg(total_amount, total_bags),
  };
}

/** Filter Chart columns by vendor / farmer / lot search text. */
export function filterVendorPurchaseChart(
  chart: VendorPurchaseChart,
  query: string,
): VendorPurchaseChart {
  const s = query.trim().toLowerCase();
  if (!s) return chart;
  const vendors = chart.vendors
    .map((v) => {
      const vendorHit = v.vendor_name.toLowerCase().includes(s);
      const rows = vendorHit
        ? v.rows
        : v.rows.filter(
            (r) =>
              r.farmer_name.toLowerCase().includes(s) ||
              r.lot_no.toLowerCase().includes(s) ||
              String(r.rate).includes(s) ||
              String(r.bags).includes(s),
          );
      if (!vendorHit && !rows.length) return null;
      const total_bags = rows.reduce((n, r) => n + r.bags, 0);
      const total_amount = Math.round(rows.reduce((n, r) => n + r.bags * r.rate, 0) * 100) / 100;
      return {
        ...v,
        rows,
        total_bags,
        total_amount,
        avg_rate: weightedAvg(total_amount, total_bags),
      };
    })
    .filter((x): x is ChartVendorColumn => !!x);

  let total_bags = 0;
  let total_amount = 0;
  for (const v of vendors) {
    total_bags += v.total_bags;
    total_amount += v.total_amount;
  }
  total_amount = Math.round(total_amount * 100) / 100;
  return {
    ...chart,
    vendors,
    total_vendors: vendors.length,
    total_bags,
    total_amount,
    overall_avg_rate: weightedAvg(total_amount, total_bags),
  };
}
