import { LedgerDetail, Patti, ShopProfile, VendorBill } from "@/src/api";
import { EscPosBuilder, rupees, slipText } from "@/src/utils/escpos";
import { pattiDisplayAmount, pattiDisplayRate } from "@/src/utils/print-document";
import { thermalBaseCss, thermalMetrics } from "@/src/utils/thermal-print";

export type CashBookLine = { side: "JAMMA" | "KHAR"; amount: number; details: string };
export type CashBookDoc = {
  title?: string;
  date: string;
  jamma: CashBookLine[];
  khar: CashBookLine[];
};

/**
 * ESC/POS Farmer Patti — shared layout engine (EscPosBuilder helpers).
 * Structure mirrors on-screen preview + `renderThermalPattiHtml`.
 * Calculations unchanged. STATUS / app buttons never printed.
 */
export function encodeFarmerPattiEscPos(
  p: Patti,
  profile: ShopProfile,
  paperMm: number,
  qrToken?: string,
  detailed: boolean = false,
): string {
  const b = new EscPosBuilder(paperMm);
  const date = new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

  b.shopHeader(profile);
  b.docTitleAndNo("PATTI / BILL", p.patti_no);
  b.hr();

  b.infoRow("FARMER", p.farmer_name || "-");
  b.infoRow("DATE", date, { valueBold: false });
  if (p.driver_name) {
    const drv = p.driver_place ? `${p.driver_name} - ${p.driver_place}` : p.driver_name;
    b.infoRow("DRIVER", drv);
  }

  b.hr().tableHeader3().hr("-");
  for (const lot of p.lots) {
    lot.sales.forEach((s, i) => {
      const lotNo = i === 0 ? String(lot.lot_no || `${lot.lot_serial_no}/${lot.total_bags}`) : "";
      const mid = `${s.bags} x ${rupees(pattiDisplayRate(s.rate_per_bag, p.payment_factor))}`;
      b.itemRowLotEmph(lotNo, mid, rupees(pattiDisplayAmount(s.bags, s.rate_per_bag, p.payment_factor)));
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
    .bold(true)
    .kv("Total deduction", `- ${rupees(p.deductions_total)}`)
    .bold(false);

  b.majorTotalBox("NET PAYABLE", rupees(p.net_payable));
  b.infoRow("RECEIVER", p.receiver_name || "-");

  const token = (qrToken || p.qr_token || "").trim();
  if (token) b.qrSection(token, paperMm);

  b.cut();
  return b.toBase64();
}

/**
 * ESC/POS Vendor Bill — same shared layout engine as Farmer Patti.
 * Structure mirrors on-screen Vendor Bill preview (4-col table, Lemon, GRAND TOTAL).
 * No QR. Calculations unchanged.
 */
export function encodeVendorBillEscPos(bill: VendorBill, profile: ShopProfile, paperMm: number): string {
  const b = new EscPosBuilder(paperMm);

  b.shopHeader(profile);
  b.docTitleAndNo("VENDOR BILL", bill.bill_code, "BILL");
  b.hr();

  b.infoRow("VENDOR", bill.vendor_name || "-");
  if (bill.vendor_details) b.infoRow("DETAILS", bill.vendor_details, { valueBold: false });
  b.infoRow("DATE", bill.date || "-", { valueBold: false });

  b.hr().tableHeader4().hr("-");
  for (const l of bill.lines) {
    b.itemRow4(l.lot_no, l.farmer_name, `${l.bags} x ${rupees(l.vendor_rate)}`, rupees(l.amount));
  }

  b.hr()
    .kv("Lemon", rupees(bill.goods_total))
    .kv("Commission", rupees(bill.commission_total))
    .kv("Hamali", rupees(bill.hamali));
  if (bill.cess > 0) b.kv("Cess / Other", rupees(bill.cess));

  b.majorTotalBox("GRAND TOTAL", rupees(bill.grand_total));

  b.kv("Paid", rupees(bill.paid));
  b.bold(true).kv("Balance Due", rupees(bill.balance)).bold(false);

  const bank: string[] = [];
  if (profile.bank_account_holder) bank.push(`A/c Name: ${profile.bank_account_holder}`);
  if (profile.bank_account_number) bank.push(`A/c No: ${profile.bank_account_number}`);
  if (profile.bank_ifsc) bank.push(`IFSC: ${profile.bank_ifsc}`);
  if (profile.bank_name) bank.push(`Bank: ${profile.bank_name}`);
  if (bank.length) {
    b.hr().align("left").bold(true).size("normal").line("BANK DETAILS").bold(false);
    bank.forEach((x) => b.size("normal").wrapped(slipText(x)));
  }
  if (bill.notes) {
    b.hr().align("left").size("normal").wrapped(slipText(bill.notes));
  }
  b.cut();
  return b.toBase64();
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
  for (const x of doc.jamma) b.kv(x.details || "-", rupees(x.amount));
  b.kv("TOTAL", rupees(jammaTot)).hr().bold(true).line("KHAR").bold(false);
  for (const x of doc.khar) b.kv(x.details || "-", rupees(x.amount));
  b.kv("TOTAL", rupees(kharTot)).hr().cut();
  return b.toBase64();
}

export function encodeCashBookHtml(doc: CashBookDoc, paperMm: number): string {
  const m = thermalMetrics(paperMm);
  const jammaTot = doc.jamma.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const kharTot = doc.khar.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const rupee = (n: number) =>
    "₹" + (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const escape = (s: string) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  const rows = (xs: CashBookLine[]) =>
    xs.map((x) => `<div class="kv"><span class="wrap">${escape(x.details || "—")}</span><span>${rupee(x.amount)}</span></div>`).join("");
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
