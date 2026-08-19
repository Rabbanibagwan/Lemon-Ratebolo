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

function shopHead(b: EscPosBuilder, profile: ShopProfile | { shop_name?: string } | null) {
  const shop = (profile?.shop_name || "").trim().toUpperCase();
  b.init().align("center").bold(true).size("tall").line(shop || "LEMON MANDI").size("normal").bold(false);
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

export function encodeFarmerPattiEscPos(
  p: Patti,
  profile: ShopProfile,
  paperMm: number,
  qrToken?: string,
  detailed: boolean = false,
): string {
  const b = new EscPosBuilder(paperMm);
  const addr = [profile.address, profile.village, profile.taluk, profile.district, profile.state].filter(Boolean).join(", ");
  const date = new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  shopHead(b, profile);
  if (addr) b.wrapped(slipText(addr));
  if (profile.mobile) b.line(`Mobile: ${profile.mobile}`);
  b.align("left").hr()
    .kv("PATTI / BILL", `NO. ${p.patti_no}`)
    .hr();
  // Farmer name printed large (bold + tall) to match the prominent farmerFs in the HTML preview.
  // size("tall") halves the column count, so wrap at half the normal cols.
  b.bold(true).size("tall");
  const farmerLabel = "FARMER: ";
  const farmerName = slipText(p.farmer_name);
  const halfCols = Math.floor(b.cols / 2);
  const farmerFull = farmerLabel + farmerName;
  if (farmerFull.length <= halfCols) {
    b.line(farmerFull);
  } else {
    b.line(farmerLabel + farmerName.slice(0, Math.max(0, halfCols - farmerLabel.length)));
    const rest = farmerName.slice(Math.max(0, halfCols - farmerLabel.length));
    for (let i = 0; i < rest.length; i += halfCols) b.line("  " + rest.slice(i, i + halfCols));
  }
  b.size("normal").bold(false);
  b.kv("DATE", date);
  const drv = p.driver_name
    ? (p.driver_place ? `${p.driver_name} - ${p.driver_place}` : p.driver_name)
    : "-";
  b.kv("DRIVER", slipText(drv));
  b.hr().bold(true).itemRow("LOT", "BAGS x RATE", "AMOUNT").bold(false);
  for (const lot of p.lots) {
    lot.sales.forEach((s, i) => {
      const lotNo = i === 0 ? String(lot.lot_no || `${lot.lot_serial_no}/${lot.total_bags}`) : "";
      const mid = `${s.bags} x ${rupees(s.rate_per_bag * p.payment_factor)}`;
      // Bold lot number and bags count to match emphFs emphasis in HTML.
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
    .bold(true).kv("Total deduction", `- ${rupees(p.deductions_total)}`).bold(false)
    .hr()
    .bold(true)
    .size("tall")
    .kv("NET PAYABLE", rupees(p.net_payable))
    .size("normal")
    .bold(false);
  b.kv("RECEIVER", slipText(p.receiver_name || "-"))
    .kv("STATUS", p.status === "received" ? "RECEIVED" : "PENDING");
  const token = (qrToken || p.qr_token || "").trim();
  if (token) {
    b.align("center").feed(1).qr(token, paperMm <= 58 ? 3 : 4).line("Scan at counter").align("left");
  }
  b.cut();
  return b.toBase64();
}

export function encodeVendorBillEscPos(bill: VendorBill, profile: ShopProfile, paperMm: number): string {
  const b = new EscPosBuilder(paperMm);
  const addr = [profile.address, profile.village, profile.taluk, profile.district, profile.state].filter(Boolean).join(", ");
  shopHead(b, profile);
  if (addr) b.wrapped(addr);
  if (profile.mobile) b.line(profile.mobile);
  b.bold(true).line("VENDOR BILL").bold(false).align("left").hr()
    .kv("Bill", bill.bill_code)
    .kv("Date", bill.date)
    .kv("Vendor", bill.vendor_name);
  if (bill.vendor_details) b.wrapped(bill.vendor_details);
  b.hr().itemRow("LOT", "DETAIL", "AMT");
  for (const l of bill.lines) {
    b.itemRow(l.lot_no, `${l.farmer_name}`, rupees(l.amount));
    b.itemRow("", `${l.bags} x ${rupees(l.vendor_rate)}`, "");
  }
  b.hr()
    .kv("Bags", String(bill.total_bags))
    .kv("Goods", rupees(bill.goods_total))
    .kv("Commission", rupees(bill.commission_total))
    .kv("Hamali", rupees(bill.hamali));
  if (bill.cess > 0) b.kv("Cess", rupees(bill.cess));
  b.hr().bold(true).size("tall").kv("TOTAL", rupees(bill.grand_total)).size("normal").bold(false)
    .kv("Paid", rupees(bill.paid))
    .kv("Balance", rupees(bill.balance));
  const bank: string[] = [];
  if (profile.bank_account_holder) bank.push(`A/c Name: ${profile.bank_account_holder}`);
  if (profile.bank_account_number) bank.push(`A/c No: ${profile.bank_account_number}`);
  if (profile.bank_ifsc) bank.push(`IFSC: ${profile.bank_ifsc}`);
  if (profile.bank_name) bank.push(`Bank: ${profile.bank_name}`);
  if (bank.length) {
    b.hr().align("center").bold(true).line("BANK DETAILS").bold(false).align("left");
    bank.forEach((x) => b.wrapped(x));
  }
  if (bill.notes) b.wrapped(bill.notes);
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
