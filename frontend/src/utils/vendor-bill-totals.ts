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
