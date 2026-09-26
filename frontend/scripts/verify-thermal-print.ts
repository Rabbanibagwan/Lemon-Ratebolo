/**
 * Layout verification for Farmer Patti + Vendor Bill ESC/POS at 58/80/100 mm.
 * Tests EscPosBuilder directly (no RN/Expo imports).
 * Run: npx --yes tsx scripts/verify-thermal-print.ts
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  EscPosBuilder,
  escposCols,
  escposPrintDots,
  rupees,
  slipText,
  thermalWidthConfig,
} from "../src/utils/escpos";

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
function encodePatti(paperMm: number): { b64: string; builder: EscPosBuilder } {
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
  b.normalState();
  b.majorTotalBox("NET PAYABLE", rupees(p.net_payable));
  b.normalState();
  b.infoRow("RECEIVER", p.receiver_name);
  b.normalState();
  b.qrSection(p.qr_token, paperMm);
  b.cut();
  return { b64: b.toBase64(), builder: b };
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
      // ESC a / ESC E / ESC - / ESC M / GS ! / GS B — 3 bytes
      if (
        (b === 0x1b && (bin[i + 1] === 0x61 || bin[i + 1] === 0x45 || bin[i + 1] === 0x2d || bin[i + 1] === 0x4d)) ||
        (b === 0x1d && (bin[i + 1] === 0x21 || bin[i + 1] === 0x42))
      ) {
        i += 3;
        continue;
      }
      // GS V m  OR  GS V m n (feed-and-cut when m >= 65)
      if (b === 0x1d && bin[i + 1] === 0x56) {
        const m = bin[i + 2];
        i += m >= 65 ? 4 : 3;
        continue;
      }
      // GS W nL nH / GS L nL nH
      if (b === 0x1d && (bin[i + 1] === 0x57 || bin[i + 1] === 0x4c)) {
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

/** Scan raw ESC/POS for reverse ON (GS B 1) near NET PAYABLE and for cut/feed. */
function analyzeEscPos(b64: string): {
  hasCut: boolean;
  cutIsFeedAndCut: boolean;
  reverseOnCount: number;
  reverseOffCount: number;
  boldOnCount: number;
  lfAfterQrPrint: number;
  gsWDots: number | null;
  netPayableUsesReverse: boolean;
} {
  const bin = Buffer.from(b64, "base64");
  let reverseOnCount = 0;
  let reverseOffCount = 0;
  let boldOnCount = 0;
  let hasCut = false;
  let cutIsFeedAndCut = false;
  let gsWDots: number | null = null;
  let qrPrintAt = -1;
  let reverseState = false;
  let reverseOnDuringNet = false;
  let i = 0;
  while (i < bin.length) {
    const b = bin[i];
    if (b === 0x1d && bin[i + 1] === 0x42) {
      if (bin[i + 2] === 1) {
        reverseOnCount++;
        reverseState = true;
      } else {
        reverseOffCount++;
        reverseState = false;
      }
      i += 3;
      continue;
    }
    if (b === 0x1b && bin[i + 1] === 0x45 && bin[i + 2] === 1) {
      boldOnCount++;
      i += 3;
      continue;
    }
    if (b === 0x1d && bin[i + 1] === 0x57) {
      gsWDots = bin[i + 2] + (bin[i + 3] << 8);
      i += 4;
      continue;
    }
    if (b === 0x1d && bin[i + 1] === 0x56) {
      hasCut = true;
      cutIsFeedAndCut = bin[i + 2] >= 65;
      i += cutIsFeedAndCut ? 4 : 3;
      continue;
    }
    // QR print command: GS ( k 03 00 31 51 30
    if (
      b === 0x1d &&
      bin[i + 1] === 0x28 &&
      bin[i + 2] === 0x6b &&
      bin[i + 3] === 0x03 &&
      bin[i + 4] === 0x00 &&
      bin[i + 5] === 0x31 &&
      bin[i + 6] === 0x51
    ) {
      qrPrintAt = i;
      i += 8;
      continue;
    }
    if (b === 0x1d && bin[i + 1] === 0x28 && bin[i + 2] === 0x6b) {
      const plen = bin[i + 3] + (bin[i + 4] << 8);
      i += 5 + plen;
      continue;
    }
    // Detect "NET PAYABLE" ASCII while reverse is on
    if (b === 0x4e && bin.slice(i, i + 11).toString("ascii") === "NET PAYABLE") {
      if (reverseState) reverseOnDuringNet = true;
      i += 11;
      continue;
    }
    i++;
  }

  let lfAfterQrPrint = 0;
  if (qrPrintAt >= 0) {
    for (let j = qrPrintAt; j < bin.length; j++) {
      if (bin[j] === 0x0a) lfAfterQrPrint++;
      if (bin[j] === 0x1d && bin[j + 1] === 0x56) break;
    }
  }

  return {
    hasCut,
    cutIsFeedAndCut,
    reverseOnCount,
    reverseOffCount,
    boldOnCount,
    lfAfterQrPrint,
    gsWDots,
    netPayableUsesReverse: reverseOnDuringNet,
  };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const widths = [58, 80, 100] as const;
const expectedDots: Record<number, number> = { 58: 384, 80: 576, 100: 720 };
const expectedCols: Record<number, number> = { 58: 32, 80: 48, 100: 60 };
const results: Record<string, string> = {};

for (const mm of widths) {
  const cfg = thermalWidthConfig(mm);
  assert(cfg.dots === expectedDots[mm], `${mm}mm dots`);
  assert(cfg.columns === expectedCols[mm], `${mm}mm cols cfg`);
  assert(cfg.contentDots === cfg.dots - cfg.leftMarginDots - cfg.rightMarginDots, `${mm} contentDots`);
  assert(escposCols(mm) === expectedCols[mm], `${mm}mm cols`);
  assert(escposPrintDots(mm) === cfg.contentDots, `${mm}mm printDots`);

  const builder = new EscPosBuilder(mm);
  assert(builder.cols === cfg.columns, `${mm} builder cols`);
  assert(builder.printDots === cfg.contentDots, `${mm} builder dots`);
  const [l, m, a] = builder.lineWidths();
  assert(l + m + a === cfg.columns, `${mm} 3-col`);
  const w4 = builder.lineWidths4();
  assert(w4[0] + w4[1] + w4[2] + w4[3] === cfg.columns, `${mm} 4-col`);

  // QR module fits content width
  const mod = builder.qrModuleSize(mm);
  assert(mod * 49 <= cfg.contentDots, `${mm} QR width <= printable`);

  const { b64: pattiB64 } = encodePatti(mm);
  const pattiText = decodeEscPosText(pattiB64);
  for (const line of pattiText.split("\n")) {
    if (line && line.length > cfg.columns) throw new Error(`Patti ${mm} overflow: ${line.length} "${line}"`);
  }
  assert(pattiText.includes("TEST MANDI"), "shop");
  assert(pattiText.includes("PATTI / BILL"), "title");
  assert(pattiText.includes("NET PAYABLE"), "net");
  assert(pattiText.includes("RECEIVER"), "receiver");
  assert(pattiText.includes("SCAN AT COUNTER"), "qr");
  assert(pattiText.includes(slipText("Gross total")) || pattiText.includes("Gross total"), "gross");

  const analysis = analyzeEscPos(pattiB64);
  assert(analysis.hasCut, `${mm} has CUT`);
  assert(analysis.cutIsFeedAndCut, `${mm} uses feed-and-cut (GS V 65)`);
  assert(!analysis.netPayableUsesReverse, `${mm} NET PAYABLE must not use inverse`);
  assert(analysis.reverseOnCount === 0, `${mm} no GS B 1 (reverse ON) in Patti`);
  assert(analysis.boldOnCount > 0, `${mm} uses bold`);
  assert(analysis.gsWDots === cfg.contentDots, `${mm} GS W dots=${analysis.gsWDots} expected ${cfg.contentDots}`);
  // QR clearance (6/8/10) + SCAN/hint lines + cut feed(3) → well above old feed(2)
  const minLf = builder.qrClearanceFeed() + 3;
  assert(analysis.lfAfterQrPrint >= minLf, `${mm} feed after QR: ${analysis.lfAfterQrPrint} < ${minLf}`);

  const billText = decodeEscPosText(encodeBill(mm));
  for (const line of billText.split("\n")) {
    if (line && line.length > cfg.columns) throw new Error(`Bill ${mm} overflow: ${line.length} "${line}"`);
  }
  assert(billText.includes("Lemon"), "Lemon");
  assert(!billText.includes("Goods"), "no Goods");
  assert(billText.includes("GRAND TOTAL"), "grand");
  assert(billText.includes("Cess / Other"), "cess");
  assert(billText.includes("FARMER"), "farmer col");

  const billAnalysis = analyzeEscPos(encodeBill(mm));
  assert(!billAnalysis.netPayableUsesReverse && billAnalysis.reverseOnCount === 0, `${mm} bill no inverse`);

  results[`${mm}mm`] = `PASS cols=${cfg.columns} dots=${cfg.dots} qrMod=${mod} lfAfterQr=${analysis.lfAfterQrPrint}`;
  console.log(`\n=== PATTI ${mm}mm (${cfg.columns} cols / ${cfg.dots} dots) ===\n${pattiText}`);
  console.log(`\n=== VENDOR ${mm}mm (${cfg.columns} cols) ===\n${billText}`);
}

// Source wiring checks
const docs = readFileSync(join(__dirname, "../src/utils/thermal-escpos-docs.ts"), "utf8");
assert(docs.includes("shopHeader"), "docs use shopHeader");
assert(docs.includes("majorTotalBox"), "docs use majorTotalBox");
assert(docs.includes("tableHeader4"), "docs use tableHeader4");
assert(docs.includes('kv("Lemon"'), "docs Lemon");
assert(docs.includes("GRAND TOTAL"), "docs GRAND TOTAL");
assert(docs.includes("qrSection"), "docs qrSection");
assert(docs.includes("normalState"), "docs normalState");

const escposSrc = readFileSync(join(__dirname, "../src/utils/escpos.ts"), "utf8");
assert(escposSrc.includes("thermalWidthConfig"), "thermalWidthConfig exported");
assert(escposSrc.includes("normalState"), "normalState present");
assert(!/reverse\(true\)/.test(escposSrc.match(/majorTotalBox[\s\S]*?^  \}/m)?.[0] || ""), "majorTotalBox no reverse(true)");

const thermalCss = readFileSync(join(__dirname, "../src/utils/thermal-print.ts"), "utf8");
assert(thermalCss.includes("#slip.patti .netbox"), "patti netbox css");
assert(/#slip\.patti \.netbox \{[\s\S]*?background:\s*#fff/m.test(thermalCss), "patti netbox white bg");

const pattiUi = readFileSync(join(__dirname, "../app/patti/[id].tsx"), "utf8");
assert(/netBox:\s*\{[\s\S]*?backgroundColor:\s*colors\.surface/m.test(pattiUi), "preview netBox white");

const btMod = readFileSync(
  join(__dirname, "../modules/thermal-bluetooth/android/src/main/java/expo/modules/thermalbluetooth/ThermalBluetoothModule.kt"),
  "utf8",
);
assert(btMod.includes("chunkSize"), "BT write is chunked");

const vendorPrint = readFileSync(join(__dirname, "../src/utils/vendor-bill-print.ts"), "utf8");
assert(vendorPrint.includes('class="farm"'), "thermal HTML 4-col");
assert(vendorPrint.includes("GRAND TOTAL"), "thermal HTML grand");
assert(vendorPrint.includes("Lemon"), "thermal HTML Lemon");

const idSrc = readFileSync(join(__dirname, "../app/vendor-bill/[id].tsx"), "utf8");
assert(idSrc.includes('label="Lemon"'), "UI Lemon");
assert(!idSrc.includes("Goods (×"), "UI no Goods calc");

console.log("\nRESULTS:");
for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${v}`);
console.log("  Net Payable inverse: PASS (disabled)");
console.log("  Net Payable bold black / white bg: PASS");
console.log("  QR clearance + feed-and-cut: PASS");
console.log("  BT chunked write: PASS");
console.log("ALL WIDTHS OK");
