/**
 * OCR party linking helpers.
 *
 * Farmer auto-link must be EXACT only. Silent fuzzy/prefix matching
 * (e.g. OCR "AAM" → master "AAMG") replaces the OCR snapshot and
 * must not happen. Explicit PartyPicker selection remains allowed.
 *
 * Vendor fuzzy matching is retained separately for existing vendor UX.
 */

export function normPartyKey(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Exact normalized-name match only. Never prefix/contains/levenshtein. */
export function exactMatchPartyId(
  input: string,
  list: { id: string; name: string }[],
): string | null {
  const q = normPartyKey(input);
  if (!q || !list.length) return null;
  for (const item of list) {
    if (normPartyKey(item.name) === q) return item.id;
  }
  return null;
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j - 1], dp[j]) + 1;
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * Fuzzy match for vendors only (legacy OCR vendor UX).
 * Do NOT use for OCR farmer auto-link.
 */
export function fuzzyMatchVendorId(
  input: string,
  list: { id: string; name: string }[],
): string | null {
  const q = normPartyKey(input);
  if (!q || q.length < 2 || !list.length) return null;
  let best: { id: string; score: number } | null = null;
  for (const item of list) {
    const t = normPartyKey(item.name);
    if (!t) continue;
    if (t === q) return item.id;
    if (t.startsWith(q) || q.startsWith(t) || t.includes(q) || q.includes(t)) return item.id;
    const d = lev(q, t);
    const rel = 1 - d / Math.max(q.length, t.length);
    if (rel >= 0.72 && (!best || rel > best.score)) best = { id: item.id, score: rel };
  }
  return best ? best.id : null;
}

/**
 * Resolve farmer_id for OCR save/load.
 * Uses exact match only; never silently upgrades OCR text to a longer master name.
 */
export function resolveOcrFarmerId(
  ocrFarmerName: string,
  existingFarmerId: string | null | undefined,
  farmers: { id: string; name: string }[],
): string | null {
  if (existingFarmerId) {
    const linked = farmers.find((f) => f.id === existingFarmerId);
    // Keep explicit PartyPicker / exact link only when the linked master
    // name still matches the OCR/draft name exactly (normalized).
    if (linked && normPartyKey(linked.name) === normPartyKey(ocrFarmerName)) {
      return existingFarmerId;
    }
    // Stale fuzzy link (e.g. AAM linked to AAMG): drop it.
    if (linked && normPartyKey(linked.name) !== normPartyKey(ocrFarmerName)) {
      return exactMatchPartyId(ocrFarmerName, farmers);
    }
    return existingFarmerId;
  }
  return exactMatchPartyId(ocrFarmerName, farmers);
}
