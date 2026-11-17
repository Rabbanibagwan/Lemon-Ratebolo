/**
 * Vendor Bill bag totals — sum lot/farmer line bags (never hardcoded).
 * No React Native / API runtime imports (safe for Node verify scripts).
 */

type BagLine = { bags?: number | null };

/** Sum bag quantities from all lot rows on the bill. Empty lines → 0. */
export function vendorBillNoBags(
  b: { lines?: BagLine[] | null; total_bags?: number | null },
): number {
  const lines = b?.lines || [];
  if (lines.length > 0) {
    let sum = 0;
    for (const l of lines) {
      const n = Number(l?.bags);
      sum += Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
    return sum;
  }
  const stored = Number(b?.total_bags);
  return Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0;
}

/**
 * Vendor Bill selling rate (Vendor Bill only — never Farmer Patti):
 * auction_rate × vendor_factor + margin_per_bag + extra_per_bag
 * Extra is additive to margin and applied once per bag.
 */
export function vendorBillSellingRate(
  auctionRate: number,
  vendorFactor: number,
  marginPerBag: number,
  extraPerBag: number = 0,
): number {
  const a = Number(auctionRate) || 0;
  const f = Number(vendorFactor) || 1;
  const m = Number(marginPerBag) || 0;
  const e = Number(extraPerBag) || 0;
  return a * f + m + e;
}

/** Total Extra / Bag charge for a bill (extra × bags). Legacy bills → 0. */
export function vendorBillExtraTotal(
  bags: number,
  extraPerBag: number | null | undefined,
): number {
  const b = Number(bags) || 0;
  const e = Number(extraPerBag) || 0;
  return b * e;
}
