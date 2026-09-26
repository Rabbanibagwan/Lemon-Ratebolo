/**
 * Canonical print document models for Farmer Patti + Vendor Bill.
 *
 * Screen preview, thermal HTML, and ESC/POS must consume these values
 * (not independently recompute business totals). Typography may differ
 * (₹ vs Rs, × vs x) for thermal hardware limits.
 */
import type { Patti, ShopProfile, VendorBill } from "@/src/api";

export type PrintDocLine = {
  lot_no: string;
  mid: string;
  farmer_name?: string;
  bags: number;
  rate: number;
  amount: number;
};

export type FarmerPattiPrintDocument = {
  type: "FARMER_PATTI";
  patti_id: string;
  patti_number: number;
  date: string;
  farmer: string;
  driver: string | null;
  lines: PrintDocLine[];
  gross: number;
  hamali: number;
  hamali_label: string;
  bhada: number;
  stationery: number;
  deduction: number;
  net_payable: number;
  receiver: string;
  qr_token: string;
  shop_name: string;
  shop_address: string;
  shop_mobile: string;
  paper_mm?: number;
};

export type VendorBillPrintDocument = {
  type: "VENDOR_BILL";
  bill_id: string;
  bill_number: string;
  vendor: string;
  vendor_details: string | null;
  date: string;
  lines: PrintDocLine[];
  lemon_amount: number;
  commission: number;
  hamali: number;
  cess: number;
  grand_total: number;
  paid: number;
  balance_due: number;
  shop_name: string;
  shop_address: string;
  shop_mobile: string;
  paper_mm?: number;
};

export function shopAddressLine(profile: ShopProfile | null | undefined): string {
  if (!profile) return "";
  return [profile.address, profile.village, profile.taluk, profile.district, profile.state]
    .filter((p) => p && String(p).trim())
    .join(", ");
}

/** Line rate shown to farmer = auction rate × payment_factor (same as screen preview). */
export function pattiDisplayRate(ratePerBag: number, paymentFactor: number): number {
  return (Number(ratePerBag) || 0) * (Number(paymentFactor) || 0);
}

/** Line amount = bags × display rate (same as screen preview). */
export function pattiDisplayAmount(bags: number, ratePerBag: number, paymentFactor: number): number {
  return (Number(bags) || 0) * pattiDisplayRate(ratePerBag, paymentFactor);
}

export function buildFarmerPattiPrintDocument(
  p: Patti,
  profile: ShopProfile,
  opts?: { detailed?: boolean; paperMm?: number },
): FarmerPattiPrintDocument {
  const detailed = !!opts?.detailed;
  const date = new Date(p.created_at).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const driver =
    p.driver_name
      ? p.driver_place
        ? `${p.driver_name} - ${p.driver_place}`
        : p.driver_name
      : null;
  const lines: PrintDocLine[] = [];
  for (const lot of p.lots || []) {
    (lot.sales || []).forEach((s, i) => {
      const rate = pattiDisplayRate(s.rate_per_bag, p.payment_factor);
      const amount = pattiDisplayAmount(s.bags, s.rate_per_bag, p.payment_factor);
      lines.push({
        lot_no: i === 0 ? String(lot.lot_no || `${lot.lot_serial_no}/${lot.total_bags}`) : "",
        mid: `${s.bags} x ${rate}`,
        bags: s.bags,
        rate,
        amount,
      });
    });
  }
  return {
    type: "FARMER_PATTI",
    patti_id: p.id,
    patti_number: p.patti_no,
    date,
    farmer: p.farmer_name || "",
    driver,
    lines,
    gross: Number(p.farmer_gross) || 0,
    hamali: Number(p.hamali_total) || 0,
    hamali_label: detailed
      ? `Hamali (${p.total_bags} x ${Number(p.hamali_per_bag) || 0})`
      : "Hamali",
    bhada: Number(p.bhada_total) || 0,
    stationery: Number(p.stationery_total) || 0,
    deduction: Number(p.deductions_total) || 0,
    net_payable: Number(p.net_payable) || 0,
    receiver: p.receiver_name || "",
    qr_token: (p.qr_token || "").trim(),
    shop_name: (profile?.shop_name || "").trim().toUpperCase(),
    shop_address: shopAddressLine(profile),
    shop_mobile: (profile?.mobile || "").trim(),
    paper_mm: opts?.paperMm,
  };
}

export function buildVendorBillPrintDocument(
  b: VendorBill,
  profile: ShopProfile,
  opts?: { paperMm?: number },
): VendorBillPrintDocument {
  return {
    type: "VENDOR_BILL",
    bill_id: b.id,
    bill_number: b.bill_code,
    vendor: b.vendor_name || "",
    vendor_details: b.vendor_details || null,
    date: b.date || "",
    lines: (b.lines || []).map((l) => ({
      lot_no: l.lot_no,
      farmer_name: l.farmer_name,
      mid: `${l.bags} x ${l.vendor_rate}`,
      bags: l.bags,
      rate: Number(l.vendor_rate) || 0,
      amount: Number(l.amount) || 0,
    })),
    lemon_amount: Number(b.goods_total) || 0,
    commission: Number(b.commission_total) || 0,
    hamali: Number(b.hamali) || 0,
    cess: Number(b.cess) || 0,
    grand_total: Number(b.grand_total) || 0,
    paid: Number(b.paid) || 0,
    balance_due: Number(b.balance) || 0,
    shop_name: (profile?.shop_name || "").trim().toUpperCase(),
    shop_address: shopAddressLine(profile),
    shop_mobile: (profile?.mobile || "").trim(),
    paper_mm: opts?.paperMm,
  };
}

/** Dev-safe snapshot log — no tokens/passwords/API keys. */
export function logPrintDocument(doc: FarmerPattiPrintDocument | VendorBillPrintDocument): void {
  if (typeof __DEV__ !== "undefined" && !__DEV__) return;
  try {
    if (doc.type === "FARMER_PATTI") {
      // eslint-disable-next-line no-console
      console.log(
        [
          "PRINT DOCUMENT",
          `type: ${doc.type}`,
          `patti_id: ${doc.patti_id}`,
          `patti_number: ${doc.patti_number}`,
          `date: ${doc.date}`,
          `farmer: ${doc.farmer}`,
          `driver: ${doc.driver || ""}`,
          `lines: ${doc.lines.length}`,
          ...doc.lines.map(
            (l, i) => `  line[${i}]: lot=${l.lot_no} bags=${l.bags} rate=${l.rate} amount=${l.amount}`,
          ),
          `gross: ${doc.gross}`,
          `hamali: ${doc.hamali}`,
          `bhada: ${doc.bhada}`,
          `stationery: ${doc.stationery}`,
          `deduction: ${doc.deduction}`,
          `net_payable: ${doc.net_payable}`,
          `receiver: ${doc.receiver}`,
          `paper_mm: ${doc.paper_mm ?? ""}`,
          `qr: ${doc.qr_token ? "yes" : "no"}`,
        ].join("\n"),
      );
      return;
    }
    // eslint-disable-next-line no-console
    console.log(
      [
        "PRINT DOCUMENT",
        `type: ${doc.type}`,
        `bill_number: ${doc.bill_number}`,
        `vendor: ${doc.vendor}`,
        `date: ${doc.date}`,
        `lines: ${doc.lines.length}`,
        ...doc.lines.map(
          (l, i) =>
            `  line[${i}]: lot=${l.lot_no} farmer=${l.farmer_name || ""} bags=${l.bags} rate=${l.rate} amount=${l.amount}`,
        ),
        `lemon_amount: ${doc.lemon_amount}`,
        `commission: ${doc.commission}`,
        `hamali: ${doc.hamali}`,
        `cess: ${doc.cess}`,
        `grand_total: ${doc.grand_total}`,
        `paid: ${doc.paid}`,
        `balance_due: ${doc.balance_due}`,
        `paper_mm: ${doc.paper_mm ?? ""}`,
      ].join("\n"),
    );
  } catch {
    /* ignore logging failures */
  }
}
