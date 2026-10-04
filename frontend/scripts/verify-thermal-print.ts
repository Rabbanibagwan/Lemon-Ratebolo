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
import { buildMerchantUpiPayUrl } from "../src/utils/merchant-upi";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Test-only Merchant UPI VPA — not for production use. */
const TEST_MERCHANT_UPI = "test-merchant@upi";

const profile = {
  shop_name: "Test Mandi",
  address: "Market Road",
  village: "Village",
  taluk: "Taluk",
  district: "District",
  state: "KA",
  mobile: "9999999999",
  upi_id: TEST_MERCHANT_UPI,
  upi_name: "Test Mandi",
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
  b.applyPrintArea();
  b.docTitleAndNo("PATTI / BILL", p.patti_no);
  b.hr();
  b.farmerNameRow(p.farmer_name);
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
    .hr("-")
    .kv("Hamali", `- ${rupees(p.hamali_total)}`)
    .kv("Bhada", `- ${rupees(p.bhada_total)}`)
    .kv("Stationery", `- ${rupees(p.stationery_total)}`)
    .hr("-")
    .bold(true)
    .kv("Total deduction", `- ${rupees(p.deductions_total)}`)
    .bold(false);
  b.normalState();
  b.farmerNetPayableBox(rupees(p.net_payable));
  b.normalState();
  b.infoRow("RECEIVER", p.receiver_name);
  b.normalState();
  b.qrSection(p.qr_token, paperMm);
  b.cut();
  return { b64: b.toBase64(), builder: b };
}

/** Mirrors encodeVendorBillEscPos — bankLines drive document length before cut. */
function encodeBill(paperMm: number, bankLines: string[]): { b64: string; builder: EscPosBuilder } {
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
  b.vendorNameRow(bill.vendor_name);
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
  b.normalState();
  b.vendorGrandTotalBox(rupees(bill.grand_total));
  b.normalState();
  b.kv("Paid", rupees(bill.paid));
  b.bold(true).kv("Balance Due", rupees(bill.balance)).bold(false);
  b.bankDetailsSection(bankLines);
  const upiPayload = buildMerchantUpiPayUrl({
    upiId: TEST_MERCHANT_UPI,
    merchantName: profile.shop_name,
    amount: bill.balance,
  });
  if (upiPayload) b.merchantUpiQrSection(upiPayload, TEST_MERCHANT_UPI, paperMm);
  b.cutAfterLastContent();
  return { b64: b.toBase64(), builder: b };
}

const SHORT_BANK = ["A/c Name: MKB CO.", "A/c No: 1234567895"];
const LONG_BANK = [
  "A/c Name: MKB CO.",
  "A/c No: 1234567895",
  "IFSC: HDFC0001234",
  "Bank: HDFC Bank",
  "Branch: Vijayapura",
];

/** Count trailing LF bytes between the last printable ASCII char and the first CUT. */
function trailingBlankLfBeforeCut(b64: string): number {
  const bin = Buffer.from(b64, "base64");
  let cutAt = bin.length;
  for (let i = 0; i < bin.length - 1; i++) {
    if (bin[i] === 0x1d && bin[i + 1] === 0x56) {
      cutAt = i;
      break;
    }
  }
  let lastPrintable = -1;
  for (let i = 0; i < cutAt; i++) {
    const c = bin[i];
    if (c >= 32 && c < 127) lastPrintable = i;
  }
  if (lastPrintable < 0) return cutAt;
  let lf = 0;
  for (let i = lastPrintable + 1; i < cutAt; i++) {
    if (bin[i] === 0x0a) lf++;
  }
  return lf;
}

/** True when every needle appears in decoded text before the first CUT in the buffer. */
function contentBeforeCut(b64: string, needles: string[]): boolean {
  const bin = Buffer.from(b64, "base64");
  let cutAt = bin.length;
  for (let i = 0; i < bin.length - 1; i++) {
    if (bin[i] === 0x1d && bin[i + 1] === 0x56) {
      cutAt = i;
      break;
    }
  }
  const slice = bin.slice(0, cutAt);
  let out = "";
  let i = 0;
  while (i < slice.length) {
    const b = slice[i];
    if (b === 0x0a) {
      out += "\n";
      i++;
      continue;
    }
    if (b === 0x1b || b === 0x1d) {
      if (b === 0x1b && slice[i + 1] === 0x40) {
        i += 2;
        continue;
      }
      if (
        (b === 0x1b && (slice[i + 1] === 0x61 || slice[i + 1] === 0x45 || slice[i + 1] === 0x2d || slice[i + 1] === 0x4d)) ||
        (b === 0x1d && (slice[i + 1] === 0x21 || slice[i + 1] === 0x42))
      ) {
        i += 3;
        continue;
      }
      if (b === 0x1d && (slice[i + 1] === 0x57 || slice[i + 1] === 0x4c)) {
        i += 4;
        continue;
      }
      if (b === 0x1d && slice[i + 1] === 0x28 && slice[i + 2] === 0x6b) {
        const plen = slice[i + 3] + (slice[i + 4] << 8);
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
    i++;
  }
  // No printable content after CUT either.
  const after = bin.slice(cutAt + (bin[cutAt + 2] >= 65 ? 4 : 3));
  const afterHasText = [...after].some((c) => c >= 32 && c < 127);
  return !afterHasText && needles.every((n) => out.includes(n));
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
  gsLDots: number | null;
  gsWCount: number;
  netPayableUsesReverse: boolean;
  shopHeaderCentered: boolean;
} {
  const bin = Buffer.from(b64, "base64");
  let reverseOnCount = 0;
  let reverseOffCount = 0;
  let boldOnCount = 0;
  let hasCut = false;
  let cutIsFeedAndCut = false;
  let gsWDots: number | null = null;
  let gsLDots: number | null = null;
  let gsWCount = 0;
  let qrPrintAt = -1;
  let reverseState = false;
  let reverseOnDuringNet = false;
  let alignState: 0 | 1 | 2 = 0;
  let shopHeaderCentered = false;
  let i = 0;
  while (i < bin.length) {
    const b = bin[i];
    if (b === 0x1b && bin[i + 1] === 0x61) {
      alignState = (bin[i + 2] === 1 ? 1 : bin[i + 2] === 2 ? 2 : 0) as 0 | 1 | 2;
      i += 3;
      continue;
    }
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
    if (b === 0x1d && bin[i + 1] === 0x4c) {
      gsLDots = bin[i + 2] + (bin[i + 3] << 8);
      i += 4;
      continue;
    }
    if (b === 0x1d && bin[i + 1] === 0x57) {
      gsWDots = bin[i + 2] + (bin[i + 3] << 8);
      gsWCount++;
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
    // Shop name printed while center-aligned
    if (b === 0x54 && bin.slice(i, i + 10).toString("ascii") === "TEST MANDI") {
      if (alignState === 1) shopHeaderCentered = true;
      i += 10;
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
    gsLDots,
    gsWCount,
    netPayableUsesReverse: reverseOnDuringNet,
    shopHeaderCentered,
  };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const widths = [58, 80, 100] as const;
const expectedDots: Record<number, number> = { 58: 384, 80: 576, 100: 720 };
const expectedCols: Record<number, number> = { 58: 32, 80: 48, 100: 60 };
const expectedPaperDots: Record<number, number> = { 58: 464, 80: 640, 100: 800 };
const expectedLeftMargin: Record<number, number> = { 58: 0, 80: 0, 100: 40 };
const results: Record<string, string> = {};

for (const mm of widths) {
  const cfg = thermalWidthConfig(mm);
  assert(cfg.dots === expectedDots[mm], `${mm}mm dots`);
  assert(cfg.contentDots === expectedDots[mm], `${mm}mm contentDots`);
  assert(cfg.columns === expectedCols[mm], `${mm}mm cols cfg`);
  assert(cfg.paperDots === expectedPaperDots[mm], `${mm}mm paperDots`);
  assert(cfg.leftMarginDots === expectedLeftMargin[mm], `${mm}mm leftMargin`);
  assert(
    cfg.leftMarginDots + cfg.contentDots + cfg.rightMarginDots === cfg.paperDots,
    `${mm}mm paper = left+content+right`,
  );
  // 100mm must not silently fall back to 80mm values.
  if (mm === 100) {
    assert(cfg.contentDots !== 576 && cfg.columns !== 48, "100mm not using 80mm width");
    assert(cfg.leftMarginDots === Math.floor((800 - 720) / 2), "100mm center offset");
  }
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

  const { b64: pattiB64, builder: pattiBuilder } = encodePatti(mm);
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

  // Board-style NET PAYABLE: continuous full-width rules above and below the row.
  const pattiLines = pattiText.split("\n");
  const netIdx = pattiLines.findIndex((ln) => ln.includes("NET PAYABLE"));
  assert(netIdx > 0, `${mm} NET PAYABLE row present`);
  const topRule = pattiLines[netIdx - 1] || "";
  const botRule = pattiLines[netIdx + 1] || "";
  assert(/^-+$/.test(topRule) && topRule.length === cfg.columns, `${mm} NET top rule width ${topRule.length}`);
  assert(/^-+$/.test(botRule) && botRule.length === cfg.columns, `${mm} NET bottom rule width ${botRule.length}`);
  // Amount stays on the same line (no wrap). Decoded text is logical chars (big size is ESC, not extra chars).
  assert((pattiLines[netIdx] || "").length <= cfg.columns, `${mm} NET row overflow`);
  assert(/\bRs\s/.test(pattiLines[netIdx] || "") || /[\d,]+\.\d{2}/.test(pattiLines[netIdx] || ""), `${mm} NET amount on row`);

  // Gross total → full-width rule → Hamali…Stationery → full-width rule → Total deduction
  const grossIdx = pattiLines.findIndex((ln) => ln.includes("Gross total"));
  assert(grossIdx >= 0, `${mm} Gross total present`);
  assert(/^-+$/.test(pattiLines[grossIdx + 1] || "") && (pattiLines[grossIdx + 1] || "").length === cfg.columns, `${mm} line below Gross total`);
  const dedIdx = pattiLines.findIndex((ln) => ln.includes("Total deduction"));
  assert(dedIdx > 0, `${mm} Total deduction present`);
  assert(/^-+$/.test(pattiLines[dedIdx - 1] || "") && (pattiLines[dedIdx - 1] || "").length === cfg.columns, `${mm} line above Total deduction`);
  assert(pattiText.includes("FARMER") && pattiText.includes("MMMD"), `${mm} large farmer name row`);

  const analysis = analyzeEscPos(pattiB64);
  assert(analysis.hasCut, `${mm} has CUT`);
  assert(analysis.cutIsFeedAndCut, `${mm} uses feed-and-cut (GS V 65)`);
  assert(analysis.shopHeaderCentered, `${mm} merchant header center-aligned`);
  assert(!analysis.netPayableUsesReverse, `${mm} NET PAYABLE must not use inverse`);
  assert(analysis.reverseOnCount === 0, `${mm} no GS B 1 (reverse ON) in Patti`);
  assert(analysis.boldOnCount > 0, `${mm} uses bold`);
  assert(analysis.gsWDots === cfg.contentDots, `${mm} GS W dots=${analysis.gsWDots} expected ${cfg.contentDots}`);
  assert(analysis.gsLDots === cfg.leftMarginDots, `${mm} GS L dots=${analysis.gsLDots} expected ${cfg.leftMarginDots}`);
  // Print area must be applied more than once (init + re-assert after header size change).
  assert(analysis.gsWCount >= 2, `${mm} print area re-asserted (gsWCount=${analysis.gsWCount})`);
  // QR clearance + SCAN/hint lines + cut feed(2)
  const minLf = pattiBuilder.qrClearanceFeed() + 2;
  assert(analysis.lfAfterQrPrint >= minLf, `${mm} feed after QR: ${analysis.lfAfterQrPrint} < ${minLf}`);
  // ~6 inches (152 mm); allow band for 1-lot sample (content must fit, not a blank flag)
  const lengthMm = pattiBuilder.estimateLengthMm();
  assert(lengthMm >= 110 && lengthMm <= 190, `${mm} length ~6in: ${lengthMm.toFixed(1)}mm out of 110–190`);

  // Large Net Payable still fits inside the framed row at this paper width.
  const large = new EscPosBuilder(mm);
  large.farmerNetPayableBox(rupees(12_345_678.9));
  const largeText = decodeEscPosText(large.toBase64());
  const largeLines = largeText.split("\n").filter(Boolean);
  const largeNet = largeLines.find((ln) => ln.includes("NET PAYABLE")) || "";
  assert(largeNet.length <= cfg.columns, `${mm} large NET overflow: ${largeNet.length}`);
  const li = largeLines.indexOf(largeNet);
  assert(li > 0 && /^-+$/.test(largeLines[li - 1] || "") && (largeLines[li - 1] || "").length === cfg.columns, `${mm} large NET top rule`);
  assert(/^-+$/.test(largeLines[li + 1] || "") && (largeLines[li + 1] || "").length === cfg.columns, `${mm} large NET bottom rule`);

  const shortEnc = encodeBill(mm, SHORT_BANK);
  const longEnc = encodeBill(mm, LONG_BANK);
  const billText = decodeEscPosText(longEnc.b64);
  for (const line of billText.split("\n")) {
    if (line && line.length > cfg.columns) throw new Error(`Bill ${mm} overflow: ${line.length} "${line}"`);
  }
  // Separators / full-width rows must reach the right content boundary
  const hrLine = billText.split("\n").find((ln) => /^-+$/.test(ln));
  assert(!!hrLine && hrLine!.length === cfg.columns, `${mm} vendor hr width ${hrLine?.length} != ${cfg.columns}`);

  assert(billText.includes("Lemon"), "Lemon");
  assert(!billText.includes("Goods"), "no Goods");
  assert(billText.includes("GRAND TOTAL"), "grand");
  assert(billText.includes("Cess / Other"), "cess");
  assert(billText.includes("FARMER"), "farmer col");
  assert(billText.includes("VENDOR"), "vendor label");
  assert(billText.includes("Vendor One") || billText.includes("VENDOR ONE") || /Vendor One/i.test(billText), "vendor name");
  assert(billText.includes("BANK DETAILS"), "bank title");
  for (const row of LONG_BANK) assert(billText.includes(row), `long bank: ${row}`);

  // Merchant UPI QR section at bottom (after bank details).
  assert(billText.includes("PAY VIA UPI"), `${mm} PAY VIA UPI`);
  assert(billText.includes("SCAN TO PAY"), `${mm} SCAN TO PAY`);
  assert(billText.includes(`Merchant UPI: ${TEST_MERCHANT_UPI}`), `${mm} Merchant UPI caption`);
  const upiPayload = buildMerchantUpiPayUrl({
    upiId: TEST_MERCHANT_UPI,
    merchantName: profile.shop_name,
    amount: 50190,
  }) || "";
  assert(upiPayload.includes("upi://pay?"), `${mm} upi payload scheme`);
  assert(
    upiPayload.includes(`pa=${encodeURIComponent(TEST_MERCHANT_UPI)}`) || upiPayload.includes(`pa=${TEST_MERCHANT_UPI}`),
    `${mm} upi pa`,
  );
  assert(/am=50190(\.00)?(&|$)/.test(upiPayload), `${mm} upi am=balance`);
  assert(upiPayload.includes("cu=INR"), `${mm} upi cu=INR`);
  // Order: Balance Due → BANK DETAILS → PAY VIA UPI → CUT
  const balIdx = billText.indexOf("Balance Due");
  const upiIdx = billText.indexOf("PAY VIA UPI");
  const bankIdx = billText.indexOf("BANK DETAILS");
  assert(balIdx >= 0 && bankIdx > balIdx && upiIdx > bankIdx, `${mm} UPI after bank details`);
  assert(contentBeforeCut(longEnc.b64, ["BANK DETAILS", ...LONG_BANK, "PAY VIA UPI"]), `${mm} bank+UPI before CUT`);

  // GRAND TOTAL framed with continuous full-width rules (this.cols).
  // Same-row BIG on wide paper; stacked BIG label/amount on narrow (58mm) still framed.
  const gLines = billText.split("\n");
  const gi = gLines.findIndex((ln) => ln.includes("GRAND TOTAL"));
  assert(gi > 0, `${mm} GRAND TOTAL row present`);
  const grandLine = gLines[gi] || "";
  assert(/^-+$/.test(gLines[gi - 1] || "") && (gLines[gi - 1] || "").length === cfg.columns, `${mm} GRAND TOTAL top rule`);
  const amountOnGrand = /Rs\s*[\d,]+\.?\d*/.test(grandLine);
  const amountNext = /Rs\s*[\d,]+\.?\d*/.test(gLines[gi + 1] || "");
  assert(amountOnGrand || amountNext, `${mm} GRAND TOTAL amount present (same or next line)`);
  const ruleAfter = amountOnGrand ? gi + 1 : gi + 2;
  assert(
    /^-+$/.test(gLines[ruleAfter] || "") && (gLines[ruleAfter] || "").length === cfg.columns,
    `${mm} GRAND TOTAL bottom rule`,
  );
  // Merchant-class size: GS ! 0x11 (big) must appear in Vendor Bill ESC/POS.
  const billBin = Buffer.from(longEnc.b64, "base64");
  let bigSizeCount = 0;
  for (let i = 0; i < billBin.length - 2; i++) {
    if (billBin[i] === 0x1d && billBin[i + 1] === 0x21 && billBin[i + 2] === 0x11) bigSizeCount++;
  }
  assert(bigSizeCount >= 2, `${mm} vendor ESC/POS uses GS ! big (≥2: shop + vendor/total), got ${bigSizeCount}`);

  const billAnalysis = analyzeEscPos(longEnc.b64);
  assert(billAnalysis.lfAfterQrPrint > 0, `${mm} vendor ESC/POS contains QR print (GS ( k)`);
  assert(billAnalysis.shopHeaderCentered, `${mm} vendor merchant header centered`);
  assert(!billAnalysis.netPayableUsesReverse && billAnalysis.reverseOnCount === 0, `${mm} bill no inverse`);
  // Vendor Bill: GS V 0 immediately after Merchant QR (not feed-and-cut GS V 65).
  assert(billAnalysis.hasCut && !billAnalysis.cutIsFeedAndCut, `${mm} vendor cut after QR (GS V 0)`);
  assert(trailingBlankLfBeforeCut(longEnc.b64) <= 2, `${mm} vendor minimal blank before cut: ${trailingBlankLfBeforeCut(longEnc.b64)}`);
  assert(billAnalysis.gsWDots === cfg.contentDots, `${mm} vendor GS W`);
  assert(billAnalysis.gsLDots === cfg.leftMarginDots, `${mm} vendor GS L`);
  assert(contentBeforeCut(longEnc.b64, ["BANK DETAILS", ...LONG_BANK]), `${mm} long bank before CUT`);
  assert(contentBeforeCut(shortEnc.b64, ["BANK DETAILS", ...SHORT_BANK]), `${mm} short bank before CUT`);
  // Long bank doc must be taller than short (content-driven, not fixed height)
  assert(
    longEnc.builder.estimateLengthMm() > shortEnc.builder.estimateLengthMm(),
    `${mm} long bank taller than short`,
  );

  const [vl, vf, vb, va] = longEnc.builder.lineWidths4();
  assert(vl + vf + vb + va === cfg.columns, `${mm} vendor 4-col fill`);

  results[`${mm}mm`] =
    `PASS cols=${cfg.columns} content=${cfg.contentDots} paper=${cfg.paperDots} leftMargin=${cfg.leftMarginDots} qrMod=${mod} lfAfterQr=${analysis.lfAfterQrPrint} len≈${lengthMm.toFixed(0)}mm centerHeader=YES vendorBank=COMPLETE`;
  console.log(`\n=== PATTI ${mm}mm (${cfg.columns} cols / ${cfg.dots} dots, ~${lengthMm.toFixed(0)}mm) ===\n${pattiText}`);
  console.log(`\n=== VENDOR ${mm}mm LONG BANK (${cfg.columns} cols) ===\n${billText}`);
}

// Source wiring checks
const docs = readFileSync(join(__dirname, "../src/utils/thermal-escpos-docs.ts"), "utf8");
assert(docs.includes("shopHeader"), "docs use shopHeader");
assert(docs.includes("farmerNetPayableBox"), "docs use farmerNetPayableBox for Patti");
assert(docs.includes("vendorGrandTotalBox"), "docs use vendorGrandTotalBox");
assert(/farmerNetPayableBox\(rupees\(p\.net_payable\)\)/.test(docs), "Patti NET uses farmerNetPayableBox");
assert(/vendorGrandTotalBox\(rupees\(bill\.grand_total\)\)/.test(docs), "Vendor GRAND TOTAL uses vendorGrandTotalBox");
assert(!/majorTotalBox\("GRAND TOTAL"/.test(docs), "Vendor no longer uses majorTotalBox for GRAND TOTAL");
assert(!/majorTotalBox\("NET PAYABLE"/.test(docs), "Patti no longer uses majorTotalBox for NET");
assert(docs.includes("farmerNameRow"), "docs use farmerNameRow");
assert(docs.includes("vendorNameRow"), "docs use vendorNameRow");
assert(!/infoRow\("FARMER"/.test(docs), "Patti FARMER uses farmerNameRow not infoRow");
assert(!/infoRow\("VENDOR"/.test(docs), "Vendor VENDOR uses vendorNameRow not infoRow");
const vendorPrintSrc = readFileSync(join(__dirname, "../src/utils/vendor-bill-print.ts"), "utf8");
assert(vendorPrintSrc.includes("encodeVendorBillEscPos"), "thermalPrintVendorBill wires ESC/POS encoder");
assert(vendorPrintSrc.includes("escposBase64"), "Bluetooth path receives escposBase64");
assert(docs.includes("merchantUpiQrSection"), "Vendor Bill ESC/POS emits merchant UPI QR");
assert(docs.includes("merchantUploadedQrSection"), "Vendor Bill ESC/POS emits uploaded merchant QR");
assert(docs.includes("buildMerchantUpiPayUrl"), "Vendor Bill builds UPI deep-link");
assert(vendorPrintSrc.includes("MERCHANT QR CODE") || vendorPrintSrc.includes("SCAN TO PAY"), "Vendor Bill HTML shows merchant QR");
assert(vendorPrintSrc.includes("renderMerchantQrThermalHtml") || vendorPrintSrc.includes("upiBox"), "Vendor Bill thermal HTML has QR box");
const shopUi = readFileSync(join(__dirname, "../app/shop-profile.tsx"), "utf8");
assert(shopUi.includes("Payment / UPI QR"), "Shop Profile Payment / UPI QR section");
assert(shopUi.includes("ImagePicker"), "Shop Profile can upload QR image");
assert(shopUi.includes("upi_qr_base64"), "Shop Profile saves uploaded QR");
assert(shopUi.includes("isValidUpiId"), "Shop Profile validates UPI ID");
assert(shopUi.includes("upi_name"), "Shop Profile optional UPI display name");
const billUi = readFileSync(join(__dirname, "../app/vendor-bill/[id].tsx"), "utf8");
assert(billUi.includes("MERCHANT QR CODE") || billUi.includes("SCAN TO PAY"), "Vendor Bill screen shows merchant QR");
assert(billUi.includes("imageDataUri") || billUi.includes("upi_qr_base64"), "Vendor Bill prefers uploaded QR");
assert(docs.includes('.hr("-")'), "docs have hr separators in Patti totals");
assert(docs.includes("tableHeader4"), "docs use tableHeader4");
assert(docs.includes('kv("Lemon"'), "docs Lemon");
assert(docs.includes("GRAND TOTAL"), "docs GRAND TOTAL");
assert(docs.includes("qrSection"), "docs qrSection");
assert(docs.includes("normalState"), "docs normalState");
assert(docs.includes("bankDetailsSection"), "docs bankDetailsSection");
assert(docs.includes("cutAfterLastContent"), "Vendor Bill cuts immediately after Merchant QR");
assert(
  !/encodeVendorBillEscPos[\s\S]*?feed\(\s*b\.contentClearanceFeed\(\)/.test(docs),
  "Vendor Bill must not stack contentClearanceFeed after QR",
);
assert(/encodeVendorBillEscPos[\s\S]*cutAfterLastContent\(\)/.test(docs), "Vendor Bill calls cutAfterLastContent");
assert(docs.includes("bank_branch"), "docs bank_branch");

const escposSrc = readFileSync(join(__dirname, "../src/utils/escpos.ts"), "utf8");
assert(escposSrc.includes("thermalWidthConfig"), "thermalWidthConfig exported");
assert(escposSrc.includes("normalState"), "normalState present");
assert(escposSrc.includes("farmerNetPayableBox"), "farmerNetPayableBox present");
assert(escposSrc.includes("vendorGrandTotalBox"), "vendorGrandTotalBox present");
assert(escposSrc.includes("farmerNameRow"), "farmerNameRow present");
assert(escposSrc.includes("vendorNameRow"), "vendorNameRow present");
assert(escposSrc.includes("framedMajorTotal"), "framedMajorTotal present");
assert(escposSrc.includes("merchantUpiQrSection"), "EscPosBuilder.merchantUpiQrSection present");
assert(escposSrc.includes("merchantUploadedQrSection"), "EscPosBuilder.merchantUploadedQrSection present");
assert(escposSrc.includes("cutAfterLastContent"), "EscPosBuilder.cutAfterLastContent present");
assert(escposSrc.includes("rasterBitmap"), "EscPosBuilder.rasterBitmap present");
const cutAfterSrc = escposSrc.match(/cutAfterLastContent\(\):\s*this\s*\{[\s\S]*?^  \}/m)?.[0] || "";
assert(/0x1d,\s*0x56,\s*0x00/.test(cutAfterSrc), "cutAfterLastContent uses GS V 0 (no feed-and-cut units)");
assert(!/qrClearanceFeed/.test(escposSrc.match(/merchantUploadedQrSection\(imageBase64[\s\S]*?^  \}/m)?.[0] || ""), "uploaded QR section has no qrClearanceFeed");
assert(!/qrClearanceFeed/.test(escposSrc.match(/merchantUpiQrSection\(payload[\s\S]*?^  \}/m)?.[0] || ""), "UPI QR section has no qrClearanceFeed");
assert(!/reverse\(true\)/.test(escposSrc.match(/majorTotalBox[\s\S]*?^  \}/m)?.[0] || ""), "majorTotalBox no reverse(true)");
assert(!/reverse\(true\)/.test(escposSrc.match(/framedMajorTotal[\s\S]*?^  \}/m)?.[0] || ""), "framedMajorTotal no reverse(true)");
const framedSrc = escposSrc.match(/framedMajorTotal[\s\S]*?^  \}/m)?.[0] || "";
assert(/sizeKind/.test(framedSrc) || /\.size\("big"\)/.test(framedSrc) || /\.size\("tall"\)/.test(framedSrc), "framedMajorTotal uses big/tall");
assert(/font\("A"\)/.test(framedSrc), "framed totals stay Font A (no Times on ESC/POS)");
const itemLotSrc = escposSrc.match(/itemRowLotEmph[\s\S]*?^  \}/m)?.[0] || "";
assert(/bold\(true\)\.text\(midCell\)/.test(itemLotSrc), "Bags×Rate + Amount bold in itemRowLotEmph");

const thermalCss = readFileSync(join(__dirname, "../src/utils/thermal-print.ts"), "utf8");
assert(thermalCss.includes("#slip.patti .netbox"), "patti netbox css");
assert(/#slip\.patti \.netbox \{[\s\S]*?background:\s*#fff/m.test(thermalCss), "patti netbox white bg");
assert(/#slip\.patti \.netbox \{[\s\S]*?border-top:\s*2px solid #000/m.test(thermalCss), "patti netbox top rule");
assert(/#slip\.patti \.netbox \{[\s\S]*?border-bottom:\s*2px solid #000/m.test(thermalCss), "patti netbox bottom rule");
assert(/#slip\.vendor \.netbox \{[\s\S]*?background:\s*#fff/m.test(thermalCss), "vendor netbox white bg");
assert(/#slip\.vendor \.netbox \{[\s\S]*?border-top:\s*2px solid #000/m.test(thermalCss), "vendor netbox top rule");
assert(/#slip\.vendor \.netbox \{[\s\S]*?border-bottom:\s*2px solid #000/m.test(thermalCss), "vendor netbox bottom rule");
assert(/vendorFs:\s*shopFs/.test(thermalCss), "vendor name uses shopFs hierarchy");

const pattiUi = readFileSync(join(__dirname, "../app/patti/[id].tsx"), "utf8");
assert(/netBox:\s*\{[\s\S]*?backgroundColor:\s*colors\.surface/m.test(pattiUi), "preview netBox white");
assert(/netBox:\s*\{[\s\S]*?borderTopWidth:\s*2/m.test(pattiUi), "preview netBox top rule");
assert(/netBox:\s*\{[\s\S]*?borderBottomWidth:\s*2/m.test(pattiUi), "preview netBox bottom rule");
assert(pattiUi.includes("merchantHead"), "preview merchant head centered");
assert(pattiUi.includes("lineBagsRate"), "preview Bags×Rate bold style");
assert(pattiUi.includes("lineAmount"), "preview Amount bold style");
assert(/serif|Times New Roman/.test(pattiUi), "preview NET uses Times/serif");

const pattiPrint = readFileSync(join(__dirname, "../src/utils/patti-print.ts"), "utf8");
assert(pattiPrint.includes('class="merchant-head"'), "thermal HTML merchant-head");
assert(pattiPrint.includes("Gross total"), "thermal HTML gross");
// Gross total then hr then Hamali; Stationery path then hr then Total deduction
assert(
  /Gross total[\s\S]*?<div class="hr"><\/div>[\s\S]*?Hamali/.test(pattiPrint),
  "HTML line below Gross total",
);
assert(
  /Stationery[\s\S]*?<div class="hr"><\/div>[\s\S]*?deduct-total/.test(pattiPrint),
  "HTML line above Total deduction",
);

const btMod = readFileSync(
  join(__dirname, "../modules/thermal-bluetooth/android/src/main/java/expo/modules/thermalbluetooth/ThermalBluetoothModule.kt"),
  "utf8",
);
assert(btMod.includes("chunkSize"), "BT write is chunked");
assert(btMod.includes("settleMs"), "BT settle after full payload");

const vendorPrint = readFileSync(join(__dirname, "../src/utils/vendor-bill-print.ts"), "utf8");
assert(vendorPrint.includes('class="farm"'), "thermal HTML 4-col");
assert(vendorPrint.includes("GRAND TOTAL"), "thermal HTML grand");
assert(vendorPrint.includes("Lemon"), "thermal HTML Lemon");
assert(vendorPrint.includes('class="merchant-head"'), "vendor HTML merchant-head");
assert(vendorPrint.includes("bankRow"), "vendor HTML bankRow");
assert(vendorPrint.includes("bank_branch"), "vendor HTML bank_branch");

const idSrc = readFileSync(join(__dirname, "../app/vendor-bill/[id].tsx"), "utf8");
assert(idSrc.includes('label="Lemon"'), "UI Lemon");
assert(!idSrc.includes("Goods (×"), "UI no Goods calc");
assert(idSrc.includes("merchantHead"), "UI merchantHead");

// Driver Detail Print — must use Bluetooth ESC/POS, never preferHtml / system Print.
const reportsExport = readFileSync(join(__dirname, "../src/utils/reports-export.ts"), "utf8");
const driverPrintFn = reportsExport.match(/export async function thermalPrintDriverReport[\s\S]*?^}/m)?.[0] || "";
assert(driverPrintFn.includes("requireBluetooth: true"), "Driver Detail Print requires Bluetooth");
assert(!/preferHtml:\s*true/.test(driverPrintFn), "Driver Detail Print must not preferHtml");
assert(!/Print\.printAsync\s*\(/.test(driverPrintFn), "Driver Detail Print must not call Print.printAsync");
assert(/printThermalDocument\s*\(/.test(driverPrintFn), "Driver Detail Print uses printThermalDocument");
assert(reportsExport.includes("encodeDriverReportEscPos"), "Driver ESC/POS encoder present");
assert(/encodeDriverReportEscPos[\s\S]*contentClearanceFeed/.test(reportsExport), "Driver report feeds before cut");
const connSrc = readFileSync(join(__dirname, "../src/utils/thermal-connection.ts"), "utf8");
assert(connSrc.includes("requireBluetooth"), "printThermalDocument supports requireBluetooth");
assert(connSrc.includes("writeEscPos"), "BT writeEscPos path present");
const reportsUi = readFileSync(join(__dirname, "../app/(tabs)/reports.tsx"), "utf8");
assert(reportsUi.includes("thermalPrintDriverReport"), "Reports UI calls thermalPrintDriverReport");
assert(reportsUi.includes("connected thermal printer"), "Reports UI success copy is thermal, not preview");

/** Mirror encodeDriverReportEscPos layout for width/overflow/cut checks (no RN imports). */
function encodeDriverReportMirror(paperMm: number): { b64: string; builder: EscPosBuilder } {
  const b = new EscPosBuilder(paperMm);
  const c = b.cols;
  const wPt = Math.max(3, Math.floor(c * 0.1));
  const wLot = Math.max(4, Math.floor(c * 0.14));
  const wPay = Math.max(8, Math.floor(c * 0.22));
  const wRecv = Math.max(6, Math.floor(c * 0.22));
  const wFarm = Math.max(6, c - wPt - wLot - wPay - wRecv);
  const clip = (s: string, n: number) => {
    const t = String(s || "");
    return t.length <= n ? t.padEnd(n, " ") : t.slice(0, Math.max(0, n - 1)) + ".";
  };
  const row5 = (pt: string, lot: string, farm: string, pay: string, recv: string) => {
    const payCell = pay.length > wPay ? pay.slice(-wPay) : pay.padStart(wPay, " ");
    return clip(pt, wPt) + clip(lot, wLot) + clip(farm, wFarm) + payCell + clip(recv, wRecv);
  };
  b.init().align("center").bold(true).size("big").line("MKB LEMON CO.").size("normal")
    .bold(true).line("DRIVER DETAILS").bold(false).hr().align("left").applyPrintArea()
    .kv("Driver", "SHABBIR-2").kv("Date", "2026-09-27").kv("Lots", "153/1 - 155/3")
    .hr().bold(true).line(row5("PT", "LOT", "FARMER", "NET PAY", "RECV")).bold(false).hr("-");
  b.line(row5("#153", "153/1", "Long Farmer Name Example", rupees(12345.5), "DRIVER"));
  b.line(row5("#154", "154/2", "RAMU", rupees(2000), "-"));
  b.hr().kv("TOTAL BAGS", "4").kv("TOTAL BHADA", rupees(100))
    .bold(true).kv("TOTAL NET PAYABLE", rupees(14345.5)).kv("DRV NET RECVD", rupees(12345.5)).bold(false);
  b.normalState();
  b.feed(b.contentClearanceFeed());
  b.cut();
  return { b64: b.toBase64(), builder: b };
}

for (const mm of widths) {
  const cfg = thermalWidthConfig(mm);
  const enc = encodeDriverReportMirror(mm);
  const text = decodeEscPosText(enc.b64);
  for (const line of text.split("\n")) {
    if (line && line.length > cfg.columns) {
      throw new Error(`Driver ${mm} overflow: ${line.length} "${line}"`);
    }
  }
  assert(text.includes("DRIVER DETAILS"), `${mm} driver title`);
  assert(text.includes("SHABBIR-2"), `${mm} driver name`);
  assert(text.includes("TOTAL NET PAYABLE"), `${mm} driver totals`);
  const analysis = analyzeEscPos(enc.b64);
  assert(analysis.hasCut && analysis.cutIsFeedAndCut, `${mm} driver cut`);
  assert(analysis.gsWDots === cfg.contentDots, `${mm} driver GS W = ${cfg.contentDots}`);
  assert(analysis.gsLDots === cfg.leftMarginDots, `${mm} driver GS L`);
  const hr = text.split("\n").find((ln) => /^-+$/.test(ln));
  assert(!!hr && hr!.length === cfg.columns, `${mm} driver hr width`);
  console.log(`\n=== DRIVER ${mm}mm (${cfg.columns} cols) ===\n${text}`);
}

console.log("\nRESULTS:");
for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${v}`);
console.log("  Merchant header centered (Patti + Vendor): PASS");
console.log("  Net Payable framed (full-width top/bottom rules): PASS");
console.log("  Vendor GRAND TOTAL framed (full-width top/bottom rules): PASS");
console.log("  Net Payable / Grand Total inverse: PASS (disabled)");
console.log("  Net Payable / Grand Total bold black / white bg: PASS");
console.log("  Vendor name merchant-class (vendorNameRow): PASS");
console.log("  Vendor Bill GRAND TOTAL vendorGrandTotalBox: PASS");
console.log("  Short + long Bank Details before CUT: PASS");
console.log("  Content-driven Vendor Bill length: PASS");
console.log("  QR clearance + feed-and-cut: PASS");
console.log("  BT chunked write + settle: PASS");
console.log("  Driver Detail Print requireBluetooth (no system dialog): PASS");
console.log("  Driver Detail ESC/POS 58/80/100 width: PASS");
console.log("  Merchant UPI QR on Vendor Bill (ESC/POS + preview wiring): PASS");
console.log("ALL WIDTHS OK");
