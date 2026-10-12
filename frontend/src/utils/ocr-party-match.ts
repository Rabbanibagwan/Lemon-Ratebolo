/**
 * OCR party linking helpers.
 *
 * Automatic OCR farmer AND vendor linking must be EXACT only.
 * Silent fuzzy/prefix matching (e.g. OCR "AAM" → master "AAMG",
 * OCR "BB" → master "JBB") replaces the OCR snapshot and must not happen.
 * Explicit PartyPicker selection remains allowed.
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

/**
 * Resolve vendor_id for OCR save/load.
 * Exact match only — never auto-link OCR "BB" to master "JBB".
 */
export function resolveOcrVendorId(
  ocrVendorName: string,
  existingVendorId: string | null | undefined,
  vendors: { id: string; name: string }[],
): string | null {
  if (existingVendorId) {
    const linked = vendors.find((v) => v.id === existingVendorId);
    if (linked && normPartyKey(linked.name) === normPartyKey(ocrVendorName)) {
      return existingVendorId;
    }
    // Stale fuzzy/prefix link (e.g. BB linked to JBB): drop it.
    if (linked && normPartyKey(linked.name) !== normPartyKey(ocrVendorName)) {
      return exactMatchPartyId(ocrVendorName, vendors);
    }
    return existingVendorId;
  }
  return exactMatchPartyId(ocrVendorName, vendors);
}
