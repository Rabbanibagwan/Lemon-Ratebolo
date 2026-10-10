/**
 * Merchant UPI payload + Vendor Bill amount-specific QR checks.
 * Uses EscPosBuilder directly (no RN/Expo imports).
 * Test-only VPA — never a production UPI ID.
 * Run: npx --yes tsx scripts/verify-merchant-upi.ts
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { EscPosBuilder, rupees } from "../src/utils/escpos";
import { buildVendorBillPrintDocument } from "../src/utils/print-document";
import {
  buildMerchantUpiPayUrl,
  formatUpiAmount,
  isValidUpiId,
  merchantUpiDisplayName,
  normalizeUpiId,
} from "../src/utils/merchant-upi";
import type { ShopProfile, VendorBill } from "../src/api";

const __dirname = dirname(fileURLToPath(import.meta.url));

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Test-only Merchant UPI — not for production. */
const TEST_UPI = "test-merchant@upi";

assert(isValidUpiId(TEST_UPI), "valid test VPA");
assert(!isValidUpiId(""), "empty invalid");
assert(!isValidUpiId("not-an-upi"), "missing @ invalid");
assert(!isValidUpiId("a@"), "short handle invalid");
assert(normalizeUpiId("  Test-Merchant@UPI  ") === TEST_UPI, "normalize lower/trim");
assert(formatUpiAmount(23360) === "23360", "integer amount");
assert(formatUpiAmount(23360.5) === "23360.50", "decimal amount");
assert(formatUpiAmount(-1) === null, "negative amount rejected");

const payload = buildMerchantUpiPayUrl({
  upiId: TEST_UPI,
  merchantName: "Test Mandi",
  amount: 23360,
});
assert(!!payload, "payload built");
assert(payload!.startsWith("upi://pay?"), "scheme");
assert(payload!.includes("pa=") && payload!.includes("test-merchant"), "pa present");
assert(/am=23360(\.00)?(&|$)/.test(payload!), "am=23360");
assert(payload!.includes("cu=INR"), "cu=INR");
assert(payload!.includes("pn="), "pn present");
assert(buildMerchantUpiPayUrl({ upiId: "", merchantName: "X", amount: 1 }) === null, "no invent VPA");

const profile = {
  shop_name: "Test Mandi",
  upi_id: TEST_UPI,
  upi_name: "Payee Display",
  bank_account_holder: "Test Mandi",
  bank_account_number: "1234567895",
  bank_ifsc: "HDFC0001234",
  bank_name: "HDFC Bank",
  bank_branch: "Vijayapura",
} as ShopProfile;

assert(merchantUpiDisplayName(profile) === "Payee Display", "upi_name preferred");
assert(merchantUpiDisplayName({ shop_name: "Shop Only" }) === "Shop Only", "shop_name fallback");

const bill = {
  id: "bill-1",
  bill_code: "VB-001",
  vendor_name: "Vendor One",
  date: "2026-09-25",
  goods_total: 22000,
  commission_total: 360,
  hamali: 1000,
  cess: 0,
  grand_total: 23360,
  paid: 0,
  balance: 23360,
  lines: [{ lot_no: "1/1", farmer_name: "F1", bags: 10, vendor_rate: 2200, amount: 22000 }],
} as unknown as VendorBill;

const doc = buildVendorBillPrintDocument(bill, profile, { paperMm: 80 });
assert(doc.balance_due === 23360, "balance_due");
assert(doc.merchant_upi_id === TEST_UPI, "doc upi id");
assert(/am=23360(\.00)?(&|$)/.test(doc.merchant_upi_payload), "doc payload amount");
assert(doc.merchant_upi_payload.includes("cu=INR"), "doc cu");

/** Mirror encodeVendorBillEscPos merchant UPI + bank + cut sequence. */
function encodeBillWithUpi(paperMm: number, upiId: string | null): string {
  const b = new EscPosBuilder(paperMm);
  b.shopHeader({ shop_name: "Test Mandi", mobile: "9999999999" } as any);
  b.docTitleAndNo("VENDOR BILL", bill.bill_code, "BILL");
  b.hr();
  b.vendorNameRow(bill.vendor_name);
  b.infoRow("DATE", bill.date, { valueBold: false });
  b.hr().tableHeader4().hr("-");
  for (const l of bill.lines) {
    b.itemRow4(l.lot_no, l.farmer_name, `${l.bags} x ${rupees(l.vendor_rate)}`, rupees(l.amount));
  }
  b.hr().kv("Lemon", rupees(bill.goods_total)).kv("Commission", rupees(bill.commission_total));
  b.normalState();
  b.vendorGrandTotalBox(rupees(bill.grand_total));
  b.normalState();
  b.kv("Paid", rupees(bill.paid));
  b.bold(true).kv("Balance Due", rupees(bill.balance)).bold(false);
  b.bankDetailsSection([
    "A/c Name: Test Mandi",
    "A/c No: 1234567895",
    "IFSC: HDFC0001234",
  ]);
  if (upiId) {
    const p = buildMerchantUpiPayUrl({
      upiId,
      merchantName: merchantUpiDisplayName(profile),
      amount: bill.balance,
    });
    if (p) b.merchantUpiQrSection(p, upiId, paperMm);
  }
  b.normalState();
  b.feed(b.contentClearanceFeed());
  b.cut();
  return b.toBase64();
}

function hasQrPrint(b64: string): boolean {
  const bin = Buffer.from(b64, "base64");
  for (let i = 0; i < bin.length - 7; i++) {
    if (
      bin[i] === 0x1d &&
      bin[i + 1] === 0x28 &&
      bin[i + 2] === 0x6b &&
      bin[i + 3] === 0x03 &&
      bin[i + 4] === 0x00 &&
      bin[i + 5] === 0x31 &&
      bin[i + 6] === 0x51
    ) {
      return true;
    }
  }
  return false;
}

for (const mm of [58, 80, 100] as const) {
  const b64 = encodeBillWithUpi(mm, TEST_UPI);
  const bin = Buffer.from(b64, "base64");
  const text = bin.toString("latin1");
  assert(text.includes("BANK DETAILS"), `${mm} bank before UPI`);
  assert(text.includes("PAY VIA UPI"), `${mm} PAY VIA UPI`);
  assert(text.includes("SCAN TO PAY"), `${mm} SCAN TO PAY`);
  assert(text.includes(`Merchant UPI: ${TEST_UPI}`), `${mm} caption`);
  assert(hasQrPrint(b64), `${mm} ESC/POS QR print command`);
  assert(bin.includes(Buffer.from("upi://pay?", "utf8")), `${mm} upi://pay in ESC/POS buffer`);
  assert(bin.includes(Buffer.from("am=23360", "utf8")), `${mm} am=23360 in ESC/POS buffer`);
  assert(bin.includes(Buffer.from("cu=INR", "utf8")), `${mm} cu=INR in ESC/POS buffer`);
  const bankIdx = text.indexOf("BANK DETAILS");
  const upiIdx = text.indexOf("PAY VIA UPI");
  assert(bankIdx >= 0 && upiIdx > bankIdx, `${mm} UPI after bank`);
}

const noUpi = { ...profile, upi_id: null } as ShopProfile;
const emptyDoc = buildVendorBillPrintDocument(bill, noUpi, { paperMm: 80 });
assert(!emptyDoc.merchant_upi_payload, "no payload without VPA");
const noUpiB64 = encodeBillWithUpi(80, null);
assert(!Buffer.from(noUpiB64, "base64").toString("latin1").includes("PAY VIA UPI"), "no UPI block without VPA");

const docs = readFileSync(join(__dirname, "../src/utils/thermal-escpos-docs.ts"), "utf8");
assert(docs.includes("merchantUpiQrSection"), "docs wire merchantUpiQrSection");
assert(docs.includes("buildMerchantUpiPayUrl"), "docs build UPI payload");
const vendorPrint = readFileSync(join(__dirname, "../src/utils/vendor-bill-print.ts"), "utf8");
assert(vendorPrint.includes("MERCHANT QR CODE") || vendorPrint.includes("SCAN TO PAY"), "HTML merchant QR");
const backend = readFileSync(join(__dirname, "../../backend/server.py"), "utf8");
assert(/upi_id:\s*Optional\[str\]/.test(backend) || backend.includes("upi_id"), "backend ShopProfile has upi_id");
assert(backend.includes("upi_qr_base64"), "backend ShopProfile has upi_qr_base64");
const shopUi = readFileSync(join(__dirname, "../app/shop-profile.tsx"), "utf8");
assert(shopUi.includes("isValidUpiId"), "Shop Profile validates Merchant UPI ID");
assert(shopUi.includes("valid Merchant UPI ID") || shopUi.includes("isValidUpiId"), "Shop Profile shows UPI validation error");
const apiTs = readFileSync(join(__dirname, "../src/api.ts"), "utf8");
assert(apiTs.includes("upi_name"), "frontend ShopProfile type keeps optional upi_name");

console.log("verify-merchant-upi: PASS");
console.log(
  JSON.stringify(
    {
      test_upi: TEST_UPI,
      sample_payload: payload,
      widths: [58, 80, 100],
      amount: 23360,
    },
    null,
    2,
  ),
);
