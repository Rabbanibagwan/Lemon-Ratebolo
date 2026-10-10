/**
 * Merchant UPI helpers for Vendor Bill payment QR.
 * Stores/uses only public VPA + display name — never PIN/OTP/secrets.
 */

/** Basic UPI VPA: local@handle (e.g. merchant@upi, shop.name@okaxis). */
const UPI_VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,63}$/;

export function normalizeUpiId(raw: string | null | undefined): string {
  return String(raw || "").trim().toLowerCase();
}

export function isValidUpiId(raw: string | null | undefined): boolean {
  const id = normalizeUpiId(raw);
  if (!id || id.length > 120) return false;
  return UPI_VPA_RE.test(id);
}

/** Format amount for UPI `am=` — no currency symbol, no commas. */
export function formatUpiAmount(amount: number): string | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const n = Math.round(amount * 100) / 100;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

export type MerchantUpiPayOpts = {
  upiId: string;
  /** Prefer upi_name, else shop_name. */
  merchantName: string;
  /** Vendor Bill Balance Due when amount-specific QR is desired. */
  amount?: number | null;
};

/**
 * Build UPI deep-link payload for QR encoding:
 * upi://pay?pa=...&pn=...&am=...&cu=INR
 *
 * Omits `am` when amount is missing/invalid so the payer can enter it.
 * Returns null when UPI ID is missing/invalid (do not invent a VPA).
 */
export function buildMerchantUpiPayUrl(opts: MerchantUpiPayOpts): string | null {
  const pa = normalizeUpiId(opts.upiId);
  if (!isValidUpiId(pa)) return null;
  const pn = String(opts.merchantName || "").trim() || "Merchant";
  const params = new URLSearchParams();
  params.set("pa", pa);
  params.set("pn", pn);
  const am = opts.amount == null ? null : formatUpiAmount(Number(opts.amount));
  if (am != null) params.set("am", am);
  params.set("cu", "INR");
  // URLSearchParams encodes spaces as +; UPI apps expect %20 for pn.
  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
}

export function merchantUpiDisplayName(
  profile: { upi_name?: string | null; shop_name?: string | null } | null | undefined,
): string {
  const named = String(profile?.upi_name || "").trim();
  if (named) return named;
  return String(profile?.shop_name || "").trim() || "Merchant";
}
