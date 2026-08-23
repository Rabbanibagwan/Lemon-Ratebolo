import { LedgerDetail, Patti, ShopProfile, VendorBill } from "@/src/api";
import { EscPosBuilder, rupees } from "@/src/utils/escpos";
import { thermalBaseCss, thermalMetrics } from "@/src/utils/thermal-print";

export type CashBookLine = { side: "JAMMA" | "KHAR"; amount: number; details: string };
export type CashBookDoc = {
  title?: string;
  date: string;
  jamma: CashBookLine[];
  khar: CashBookLine[];
};

function shopHead(b: EscPosBuilder, profile: ShopProfile | { shop_name?: string; address?: string; village?: string; taluk?: string; district?: string; state?: string; mobile?: string } | null) {
  const shop = (profile?.shop_name || "").trim().toUpperCase();
  // Merchant name: double-size bold — Preview .shop hierarchy. Printer cannot load Times New Roman.
  b.init().align("center").bold(true).size("big").line(shop || "LEMON MANDI").size("normal").bold(false);
  const addr = [profile?.address, profile?.village, profile?.taluk, profile?.district, profile?.state].filter(Boolean).join(", ");
  // Address / mobile: smaller than merchant (Preview .addr).
  if (addr) b.align("center").bold(false).size("normal").wrapped(slipText(addr));
  if (profile?.mobile) b.align("center").bold(false).size("normal").line(`Mobile: ${slipText(profile.mobile)}`);
}

export function encodeTestPrint(paperMm: number, printerName?: string): string {
  const b = new EscPosBuilder(paperMm);
  b.init()
    .align("center")
    .bold(true)
    .size("tall")
    .line("LEMON MANDI")
    .size("normal")
    .bold(false)
    .hr()
    .line("BLUETOOTH TEST PRINT")
    .line("Printer Connected")
    .hr();
  if (printerName) b.wrapped(printerName);
  b.line("TEST PRINT SUCCESSFUL").hr().cut();
  return b.toBase64();
}

/** ASCII-safe slip text — thermal printers often cannot render × / · / ₹ / em-dash. */
function slipText(s: string): string {
  return String(s || "")
    .replace(/₹/g, "Rs ")
    .replace(/×/g, "x")
    .replace(/·/g, " - ")
    .replace(/…/g, "...")
    .replace(/—/g, "-")
    .replace(/–/g, "-");
}

/** Large name block matching Preview farmer/vendor prominence (size big + bold). */
function printProminentName(b: EscPosBuilder, label: string, name: string): void {
  b.align("left").bold(false).size("normal").line(label);
  b.bold(true).size("big");
  const text = slipText(name);
  const halfCols = Math.max(8, Math.floor(b.cols / 2));
  if (text.length <= halfCols) {
    b.align("right").line(text);
  } else {
    b.align("left");
    for (let i = 0; i < text.length; i += halfCols) {
      b.line(text.slice(i, i + halfCols));
    }
  }
  b.size("normal").bold(false).align("left");
}

/**
 * ESC/POS Farmer Patti — presentation mirrors Preview `renderThermalPattiHtml`.
 * Amounts/fields are unchanged; only size/alignment/emphasis differ for hardware.
 * STATUS is never printed.
 */
export function encodeFarmerPattiEscPos(
  p: Patti,
  profile: ShopProfile,
  paperMm: number,
  qrToken?: string,
  detailed: boolean = false,
): string {
  const b = new EscPosBuilder(paperMm);
  const date = new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  shopHead(b, profile);

  b.align("left").hr();
  // Patti number clearly visible (Preview PATTI / BILL · NO.).
  b.bold(true).kv("PATTI / BILL", `NO. ${p.patti_no}`).bold(false);
  b.hr();

  printProminentName(b, "FARMER", p.farmer_name || "-");

  b.size("normal").bold(false);
  b.kv("DATE", date);
  if (p.driver_name) {
    const drv = p.driver_place ? `${p.driver_name} - ${p.driver_place}` : p.driver_name;
    b.kv("DRIVER", slipText(drv));
  }

  // Full paper width 3-col table (Preview LOT | BAGS x RATE | AMOUNT).
  b.hr().bold(true).itemRow("LOT", "BAGS x RATE", "AMOUNT").bold(false);
  for (const lot of p.lots) {
    lot.sales.forEach((s, i) => {
      const lotNo = i === 0 ? String(lot.lot_no || `${lot.lot_serial_no}/${lot.total_bags}`) : "";
      const mid = `${s.bags} x ${rupees(s.rate_per_bag * p.payment_factor)}`;
      b.bold(true).itemRow(lotNo, mid, rupees(s.bags * s.rate_per_bag * p.payment_factor)).bold(false);
    });
  }

  const hamaliLabel = detailed
    ? `Hamali (${p.total_bags} x ${rupees(p.hamali_per_bag)})`
    : "Hamali";
  b.hr()
    .kv("Gross total", rupees(p.farmer_gross))
    .kv(hamaliLabel, `- ${rupees(p.hamali_total)}`)
    .kv("Bhada", `- ${rupees(p.bhada_total)}`)
    .kv("Stationery", `- ${rupees(p.stationery_total)}`)
    .bold(true).kv("Total deduction", `- ${rupees(p.deductions_total)}`).bold(false);

  // Preview .netbox — strong box + tall text (no CSS black fill on ESC/POS).
  b.emphasizedTotalBox("NET PAYABLE", rupees(p.net_payable));

  // Receiver: bold + readable (Preview RECEIVER is bold wrap, not farmer-sized). Never print STATUS.
  b.bold(true).size("normal").kv("RECEIVER", slipText(p.receiver_name || "-")).bold(false);

  const token = (qrToken || p.qr_token || "").trim();
  if (token) {
    b.align("center").feed(1).qr(token, paperMm <= 58 ? 3 : paperMm <= 80 ? 4 : 5);
    b.size("normal").bold(false).line("Scan at counter").align("left");
  }
  b.cut();
  return b.toBase64();
}

/**
 * ESC/POS Vendor Bill — presentation mirrors Preview `renderThermalVendorBillHtml`.
 * No QR (Preview thermal has none). Calculations unchanged.
 */
export function encodeVendorBillEscPos(bill: VendorBill, profile: ShopProfile, paperMm: number): string {
  const b = new EscPosBuilder(paperMm);
  shopHead(b, profile);

  b.align("center").bold(true).size("tall").line("VENDOR BILL").size("normal").bold(false);
  b.align("left").hr();
  b.bold(true).kv("Bill", slipText(bill.bill_code)).bold(false);
  b.kv("Date", slipText(bill.date));

  printProminentName(b, "VENDOR", bill.vendor_name || "-");
  if (bill.vendor_details) {
    b.size("normal").bold(false).kv("Details", slipText(bill.vendor_details));
  }

  // Preview columns: LOT | DETAIL | AMOUNT — use full width; wrap detail when needed.
  b.hr().bold(true).itemRow("LOT", "DETAIL", "AMOUNT").bold(false);
  for (const l of bill.lines) {
    const detail = slipText(`${l.farmer_name} - ${l.bags} x ${rupees(l.vendor_rate)}`);
    const [, mw] = b.lineWidths();
    if (detail.length <= mw) {
      b.itemRow(l.lot_no, detail, rupees(l.amount));
    } else {
      // Narrow paper: farmer on first row, bags x rate on second (still aligned).
      b.itemRow(l.lot_no, slipText(l.farmer_name), rupees(l.amount));
      b.itemRow("", `${l.bags} x ${rupees(l.vendor_rate)}`, "");
    }
  }

  b.hr()
    .kv("Bags", String(bill.total_bags))
    .kv("Goods", rupees(bill.goods_total))
    .kv("Commission", rupees(bill.commission_total))
    .kv("Hamali", rupees(bill.hamali));
  if (bill.cess > 0) b.kv("Cess", rupees(bill.cess));

  // Preview TOTAL .netbox equivalent.
  b.emphasizedTotalBox("TOTAL", rupees(bill.grand_total));

  b.kv("Paid", rupees(bill.paid));
  b.bold(true).kv("Balance", rupees(bill.balance)).bold(false);

  const bank: string[] = [];
  if (profile.bank_account_holder) bank.push(`A/c Name: ${profile.bank_account_holder}`);
  if (profile.bank_account_number) bank.push(`A/c No: ${profile.bank_account_number}`);
  if (profile.bank_ifsc) bank.push(`IFSC: ${profile.bank_ifsc}`);
  if (profile.bank_name) bank.push(`Bank: ${profile.bank_name}`);
  if (bank.length) {
    b.hr().align("center").bold(true).size("normal").line("BANK DETAILS").bold(false).align("left");
    bank.forEach((x) => b.size("normal").wrapped(slipText(x)));
  }
  if (bill.notes) {
    b.hr().align("center").size("normal").wrapped(slipText(bill.notes)).align("left");
  }
  b.cut();
  return b.toBase64();
}

export function encodeLedgerEscPos(d: LedgerDetail, paperMm: number): string {
  const b = new EscPosBuilder(paperMm);
  const kind = d.account_type === "FARMER" ? "FARMER" : "VENDOR";
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.date || "");
  const dateLbl = m ? `${m[3]} ${months[Number(m[2]) - 1]} ${m[1]}` : d.date;
  const dash = (n: number) => (n > 0.0001 ? rupees(n) : "-");
  b.init().align("center").bold(true).size("tall").line("ACCOUNT LEDGER").size("normal").line(kind).bold(false).hr()
    .align("left")
    .kv(kind === "FARMER" ? "Farmer" : "Vendor", d.party_name)
    .kv("Date", dateLbl)
    .hr()
    .line("DATE DETAILS        CR / DR / BAL");
  for (const r of d.rows) {
    const day = (r.date || "").slice(8).replace(/^0/, "") || r.date;
    b.wrapped(`${day} ${r.description}`);
    b.kv(`  CR ${dash(r.credit)}  DR ${dash(r.debit)}`, rupees(r.balance));
  }
  if (d.account_type === "VENDOR") {
    for (const bill of d.bills || []) {
      b.hr()
        .kv("Vendor Bill", bill.bill_code)
        .kv("Paid Amount", rupees(bill.paid))
        .kv("Balance", rupees(bill.balance));
    }
  }
  b.hr()
    .kv("TOTAL CREDIT", rupees(d.total_credit))
    .kv("TOTAL DEBIT", rupees(d.total_debit))
    .bold(true)
    .size("tall")
    .kv("BALANCE", rupees(d.balance))
    .size("normal")
    .bold(false)
    .cut();
  return b.toBase64();
}

export function encodeCashBookEscPos(doc: CashBookDoc, paperMm: number): string {
  const b = new EscPosBuilder(paperMm);
  const jammaTot = doc.jamma.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const kharTot = doc.khar.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  b.init().align("center").bold(true).size("tall").line(doc.title || "CASH BOOK").size("normal").bold(false)
    .line(doc.date).hr().align("left").bold(true).line("JAMMA").bold(false);
  for (const x of doc.jamma) b.kv(x.details || "—", rupees(x.amount));
  b.kv("TOTAL", rupees(jammaTot)).hr().bold(true).line("KHAR").bold(false);
  for (const x of doc.khar) b.kv(x.details || "—", rupees(x.amount));
  b.kv("TOTAL", rupees(kharTot)).hr().cut();
  return b.toBase64();
}

export function encodeCashBookHtml(doc: CashBookDoc, paperMm: number): string {
  const m = thermalMetrics(paperMm);
  const jammaTot = doc.jamma.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const kharTot = doc.khar.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const rupee = (n: number) =>
    "₹" + (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rows = (xs: CashBookLine[]) =>
    xs.map((x) => `<div class="kv"><span class="wrap">${escape(x.details || "—")}</span><span>${rupee(x.amount)}</span></div>`).join("");
  const escape = (s: string) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  return `<!doctype html><html><head><meta charset="utf-8"/><style>${thermalBaseCss(m)}</style></head><body>
  <div id="slip">
    <div class="center big bold">${escape(doc.title || "CASH BOOK")}</div>
    <div class="center">${escape(doc.date)}</div>
    <div class="hr"></div>
    <div class="center bold">JAMMA</div>
    ${rows(doc.jamma) || `<div class="center">—</div>`}
    <div class="kv bold"><span>TOTAL</span><span>${rupee(jammaTot)}</span></div>
    <div class="hr"></div>
    <div class="center bold">KHAR</div>
    ${rows(doc.khar) || `<div class="center">—</div>`}
    <div class="kv bold"><span>TOTAL</span><span>${rupee(kharTot)}</span></div>
  </div></body></html>`;
}
