/**
 * Layout verification for Farmer Patti + Vendor Bill ESC/POS at 58/80/100 mm.
 * Tests EscPosBuilder directly (no RN/Expo imports).
 * Run: npx --yes tsx scripts/verify-thermal-print.ts
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { EscPosBuilder, escposCols, rupees, slipText } from "../src/utils/escpos";

const __dirname = dirname(fileURLToPath(import.meta.url));

const profile = {
  shop_name: "Test Mandi",
  address: "Market Road",
  village: "Village",
  taluk: "Taluk",
  district: "District",
  state: "KA",
  mobile: "9999999999",
};

/** Mirrors encodeFarmerPattiEscPos using the shared layout helpers. */
function encodePatti(paperMm: number): string {
  const b = new EscPosBuilder(paperMm);
  const p = {
    patti_no: 42,
    farmer_name: "MMMD",
    driver_name: "BHIG",
    receiver_name: "BHIG",
    created_at: "2026-09-25T10:00:00.000Z",
    payment_factor: 1,
    total_bags: 1,
    hamali_per_bag: 10,
    hamali_total: 10,
    bhada_total: 500,
    stationery_total: 5,
    deductions_total: 515,
    farmer_gross: 45000,
    net_payable: 44485,
    qr_token: "https://example.com/patti/qr/test-token-abc",
    lots: [{ lot_no: "7/1", lot_serial_no: 7, total_bags: 1, sales: [{ bags: 1, rate_per_bag: 45000 }] }],
  };
  const date = new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  b.shopHeader(profile);
  b.docTitleAndNo("PATTI / BILL", p.patti_no);
  b.hr();
  b.infoRow("FARMER", p.farmer_name);
  b.infoRow("DATE", date, { valueBold: false });
  b.infoRow("DRIVER", p.driver_name);
  b.hr().tableHeader3().hr("-");
  for (const lot of p.lots) {
    lot.sales.forEach((s, i) => {
      const lotNo = i === 0 ? lot.lot_no : "";
      const mid = `${s.bags} x ${rupees(s.rate_per_bag * p.payment_factor)}`;
      b.itemRowLotEmph(lotNo, mid, rupees(s.bags * s.rate_per_bag * p.payment_factor));
    });
  }
  b.hr()
    .kv("Gross total", rupees(p.farmer_gross))
    .kv("Hamali", `- ${rupees(p.hamali_total)}`)
    .kv("Bhada", `- ${rupees(p.bhada_total)}`)
    .kv("Stationery", `- ${rupees(p.stationery_total)}`)
    .bold(true)
    .kv("Total deduction", `- ${rupees(p.deductions_total)}`)
    .bold(false);
  b.majorTotalBox("NET PAYABLE", rupees(p.net_payable));
  b.infoRow("RECEIVER", p.receiver_name);
  b.qrSection(p.qr_token, paperMm);
  b.cut();
  return b.toBase64();
}

/** Mirrors encodeVendorBillEscPos using the shared layout helpers. */
function encodeBill(paperMm: number): string {
  const b = new EscPosBuilder(paperMm);
  const bill = {
    bill_code: "VB-001",
    vendor_name: "Vendor One",
    date: "2026-09-25",
    goods_total: 50030,
    commission_total: 10,
    hamali: 0,
    cess: 150,
    grand_total: 50190,
    paid: 0,
    balance: 50190,
    lines: [{ lot_no: "7/1", farmer_name: "MMMD", bags: 1, vendor_rate: 50030, amount: 50030 }],
  };
  b.shopHeader(profile);
  b.docTitleAndNo("VENDOR BILL", bill.bill_code, "BILL");
  b.hr();
  b.infoRow("VENDOR", bill.vendor_name);
  b.infoRow("DATE", bill.date, { valueBold: false });
  b.hr().tableHeader4().hr("-");
  for (const l of bill.lines) {
    b.itemRow4(l.lot_no, l.farmer_name, `${l.bags} x ${rupees(l.vendor_rate)}`, rupees(l.amount));
  }
  b.hr()
    .kv("Lemon", rupees(bill.goods_total))
    .kv("Commission", rupees(bill.commission_total))
    .kv("Hamali", rupees(bill.hamali))
    .kv("Cess / Other", rupees(bill.cess));
  b.majorTotalBox("GRAND TOTAL", rupees(bill.grand_total));
  b.kv("Paid", rupees(bill.paid));
  b.bold(true).kv("Balance Due", rupees(bill.balance)).bold(false);
  b.cut();
  return b.toBase64();
}

function decodeEscPosText(b64: string): string {
  const bin = Buffer.from(b64, "base64");
  let out = "";
  let i = 0;
  while (i < bin.length) {
    const b = bin[i];
    if (b === 0x0a) {
      out += "\n";
      i++;
      continue;
    }
    if (b === 0x1b || b === 0x1d) {
      if (b === 0x1b && bin[i + 1] === 0x40) {
        i += 2;
        continue;
      }
      if ((b === 0x1b && bin[i + 1] === 0x61) || (b === 0x1b && bin[i + 1] === 0x45) || (b === 0x1d && bin[i + 1] === 0x21) || (b === 0x1d && bin[i + 1] === 0x42) || (b === 0x1d && bin[i + 1] === 0x56)) {
        i += 3;
        continue;
      }
      if (b === 0x1d && bin[i + 1] === 0x57) {
        i += 4;
        continue;
      }
      if (b === 0x1d && bin[i + 1] === 0x28 && bin[i + 2] === 0x6b) {
        const plen = bin[i + 3] + (bin[i + 4] << 8);
        i += 5 + plen;
        continue;
      }
      i += 2;
      continue;
    }
    if (b >= 32 && b < 127) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    if (b >= 0xc0) {
      const len = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      out += bin.slice(i, i + len).toString("utf8");
      i += len;
      continue;
    }
    i++;
  }
  return out;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const widths = [58, 80, 100] as const;
const results: Record<string, string> = {};

for (const mm of widths) {
  const cols = escposCols(mm);
  const expected = mm <= 58 ? 32 : mm <= 80 ? 48 : 60;
  assert(cols === expected, `${mm}mm cols`);
  const builder = new EscPosBuilder(mm);
  const [l, m, a] = builder.lineWidths();
  assert(l + m + a === cols, `${mm} 3-col`);
  const w4 = builder.lineWidths4();
  assert(w4[0] + w4[1] + w4[2] + w4[3] === cols, `${mm} 4-col`);

  const pattiText = decodeEscPosText(encodePatti(mm));
  for (const line of pattiText.split("\n")) {
    if (line && line.length > cols) throw new Error(`Patti ${mm} overflow: ${line.length} "${line}"`);
  }
  assert(pattiText.includes("TEST MANDI"), "shop");
  assert(pattiText.includes("PATTI / BILL"), "title");
  assert(pattiText.includes("NET PAYABLE"), "net");
  assert(pattiText.includes("RECEIVER"), "receiver");
  assert(pattiText.includes("SCAN AT COUNTER"), "qr");
  assert(pattiText.includes(slipText("Gross total")) || pattiText.includes("Gross total"), "gross");

  const billText = decodeEscPosText(encodeBill(mm));
  for (const line of billText.split("\n")) {
    if (line && line.length > cols) throw new Error(`Bill ${mm} overflow: ${line.length} "${line}"`);
  }
  assert(billText.includes("Lemon"), "Lemon");
  assert(!billText.includes("Goods"), "no Goods");
  assert(billText.includes("GRAND TOTAL"), "grand");
  assert(billText.includes("Cess / Other"), "cess");
  assert(billText.includes("FARMER"), "farmer col");

  results[`${mm}mm`] = `PASS cols=${cols}`;
  console.log(`\n=== PATTI ${mm}mm (${cols} cols) ===\n${pattiText}`);
  console.log(`\n=== VENDOR ${mm}mm (${cols} cols) ===\n${billText}`);
}

// Source wiring checks
const docs = readFileSync(join(__dirname, "../src/utils/thermal-escpos-docs.ts"), "utf8");
assert(docs.includes("shopHeader"), "docs use shopHeader");
assert(docs.includes("majorTotalBox"), "docs use majorTotalBox");
assert(docs.includes("tableHeader4"), "docs use tableHeader4");
assert(docs.includes('kv("Lemon"'), "docs Lemon");
assert(docs.includes("GRAND TOTAL"), "docs GRAND TOTAL");
assert(docs.includes("qrSection"), "docs qrSection");

const vendorPrint = readFileSync(join(__dirname, "../src/utils/vendor-bill-print.ts"), "utf8");
assert(vendorPrint.includes('class="farm"'), "thermal HTML 4-col");
assert(vendorPrint.includes("GRAND TOTAL"), "thermal HTML grand");
assert(vendorPrint.includes("Lemon"), "thermal HTML Lemon");

const idSrc = readFileSync(join(__dirname, "../app/vendor-bill/[id].tsx"), "utf8");
assert(idSrc.includes('label="Lemon"'), "UI Lemon");
assert(!idSrc.includes("Goods (×"), "UI no Goods calc");

console.log("\nRESULTS:");
for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${v}`);
console.log("ALL WIDTHS OK");
