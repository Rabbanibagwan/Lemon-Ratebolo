/**
 * Merchant uploaded QR → ESC/POS GS v 0 raster on Vendor Bill (58/80/100).
 * Uses a generated test PNG (not a production QR).
 * Run: npx --yes tsx scripts/verify-merchant-qr-upload.ts
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { EscPosBuilder, rupees, thermalWidthConfig } from "../src/utils/escpos";
import { pngBase64ToMonoBitmap } from "../src/utils/png-mono";
import { qrDataUriThermal } from "../src/utils/qr";

const __dirname = dirname(fileURLToPath(import.meta.url));

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function hasRaster(b64: string): boolean {
  const bin = Buffer.from(b64, "base64");
  for (let i = 0; i < bin.length - 3; i++) {
    if (bin[i] === 0x1d && bin[i + 1] === 0x76 && bin[i + 2] === 0x30) return true;
  }
  return false;
}

async function main() {
  // Test-only PNG QR — not for production.
  const dataUri = await qrDataUriThermal(
    "upi://pay?pa=test-merchant@upi&pn=Test&am=23360&cu=INR",
    200,
  );
  const b64 = dataUri.replace(/^data:image\/png;base64,/, "");
  assert(b64.length > 100, "test png generated");

  for (const mm of [58, 80, 100] as const) {
    const cfg = thermalWidthConfig(mm);
    const maxDots = mm <= 58 ? 288 : mm <= 80 ? 384 : 480;
    const bmp = pngBase64ToMonoBitmap(b64, maxDots);
    assert(!!bmp, `${mm} mono decode`);
    assert(bmp!.width <= cfg.contentDots, `${mm} QR width ${bmp!.width} <= ${cfg.contentDots}`);
    assert(bmp!.height >= 64, `${mm} QR height`);

    const b = new EscPosBuilder(mm);
    b.init().align("center").bold(true).size("big").line("TEST MANDI").size("normal").bold(false);
    b.docTitleAndNo("VENDOR BILL", "VB-001", "BILL");
    b.hr();
    b.vendorNameRow("BASU PUJARI");
    b.vendorGrandTotalBox(rupees(23360));
    b.kv("Paid", rupees(0));
    b.bold(true).kv("Balance Due", rupees(23360)).bold(false);
    b.bankDetailsSection(["A/c Name: Test Mandi", "A/c No: 1234567895"]);
    b.merchantUploadedQrSection(b64, mm);
    b.normalState();
    b.feed(b.contentClearanceFeed());
    b.cut();
    const out = b.toBase64();
    const text = Buffer.from(out, "base64").toString("latin1");
    assert(text.includes("BANK DETAILS"), `${mm} bank before QR`);
    assert(text.includes("MERCHANT QR CODE"), `${mm} MERCHANT QR CODE`);
    assert(text.includes("SCAN TO PAY"), `${mm} SCAN TO PAY`);
    assert(hasRaster(out), `${mm} GS v 0 raster present`);
    const bankIdx = text.indexOf("BANK DETAILS");
    const qrIdx = text.indexOf("MERCHANT QR CODE");
    assert(bankIdx >= 0 && qrIdx > bankIdx, `${mm} uploaded QR after bank`);
    console.log(`${mm}mm: PASS raster w=${bmp!.width} h=${bmp!.height} contentDots=${cfg.contentDots}`);
  }

  const shop = readFileSync(join(__dirname, "../app/shop-profile.tsx"), "utf8");
  assert(shop.includes("ImagePicker"), "upload ImagePicker");
  assert(shop.includes("pf-upi-qr-gallery"), "gallery button");
  assert(shop.includes("pf-upi-qr-camera"), "camera button");
  assert(shop.includes("upi_qr_base64"), "persists upi_qr_base64");

  const docs = readFileSync(join(__dirname, "../src/utils/thermal-escpos-docs.ts"), "utf8");
  assert(docs.includes("merchantUploadedQrSection"), "docs use uploaded QR");
  assert(/upi_qr_base64/.test(docs), "docs check uploaded QR field");

  console.log("verify-merchant-qr-upload: PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
