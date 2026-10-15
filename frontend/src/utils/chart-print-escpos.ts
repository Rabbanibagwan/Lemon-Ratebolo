/**
 * Vendor Purchase Chart — pure ESC/POS + thermal HTML for one vendor column.
 * No React Native imports (safe for Node verify scripts).
 */
import type { ShopProfile } from "@/src/api";
import { EscPosBuilder, rupees } from "@/src/utils/escpos";
import {
  formatChartPurchaseLine,
  formatChartRate,
  type ChartVendorColumn,
} from "@/src/utils/vendor-purchase-chart";

/** Local metrics — avoid importing thermal-print (pulls React Native) into Node verify scripts. */
function paperMetrics(paperMm: number) {
  const w = Math.max(40, Math.min(120, Math.round(Number(paperMm) || 80)));
  return { w, padY: w <= 58 ? 2 : 3 };
}

function ascii(s: string): string {
  return String(s || "")
    .replace(/₹/g, "Rs ")
    .replace(/×/g, "x")
    .replace(/·/g, " - ")
    .replace(/…/g, "...")
    .replace(/—/g, "-")
    .replace(/–/g, "-");
}

function escHtml(s: string): string {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

/** ESC/POS for a single vendor column from the live Chart data. */
export function encodeVendorChartEscPos(
  col: ChartVendorColumn,
  dateISO: string,
  shopName: string,
  paperMm: number,
  profile?: ShopProfile | null,
): string {
  const b = new EscPosBuilder(paperMm);
  const shop = ascii((profile?.shop_name || shopName || "LEMON MANDI").toUpperCase());

  b.init();
  if (profile && (profile.shop_name || profile.address || profile.mobile)) {
    b.shopHeader(profile);
  } else {
    b.align("center").bold(true).size("big").line(shop).size("normal").bold(false);
  }

  b.align("center")
    .bold(true)
    .line("VENDOR CHART")
    .bold(false)
    .hr()
    .align("left")
    .applyPrintArea()
    .kv("Date", ascii(dateISO))
    .bold(true)
    .kvPreferValue("Vendor", ascii(col.vendor_name || "-"))
    .bold(false)
    .hr()
    .bold(true)
    .line(ascii("BAGS x RATE  FARMER / LOT"))
    .bold(false)
    .hr("-");

  for (const r of col.rows) {
    const line = formatChartPurchaseLine(r, { includeLot: true, maxLen: b.cols });
    b.wrapped(ascii(line));
  }

  b.hr()
    .kv("TOTAL BAGS", String(col.total_bags))
    .kv("TOTAL PURCHASE", rupees(col.total_amount))
    .bold(true)
    .kv("WEIGHTED AVG", `Rs ${formatChartRate(col.avg_rate)}`)
    .bold(false);

  b.normalState();
  b.feed(b.contentClearanceFeed());
  b.cut();
  return b.toBase64();
}

/** Thermal HTML preview — same single-vendor content as ESC/POS. */
export function renderVendorChartThermalHtml(
  col: ChartVendorColumn,
  dateISO: string,
  shopName: string,
  paperMm: number = 80,
): string {
  const m = paperMetrics(paperMm);
  const compact = m.w <= 58;
  const tdFs = compact ? 9 : m.w <= 80 ? 10 : 11;
  const headFs = compact ? 13 : m.w <= 80 ? 15 : 17;
  const rows = col.rows
    .map(
      (r) =>
        `<div class="line">${escHtml(formatChartPurchaseLine(r, { includeLot: true, maxLen: 42 }))}</div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
  <title>Chart ${escHtml(col.vendor_name)}</title>
  <style>
    @page { size: ${m.w}mm auto; margin: 0 !important; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html { background: #d4d4d4 !important; }
    body {
      width: ${m.w}mm !important;
      max-width: min(${m.w}mm, 100%) !important;
      margin: 0 auto !important;
      background: #fff !important;
      color: #000 !important;
      font-family: "Times New Roman", Times, serif;
      padding: ${m.padY}px 2px;
    }
    .hr { border-top: 1px solid #000; margin: 4px 0; }
    .shop { text-align:center; font-size:${headFs}px; font-weight:900; text-transform:uppercase; }
    .title { text-align:center; font-size:${tdFs + 1}px; font-weight:900; margin-top:2px; }
    .kv { display:flex; justify-content:space-between; gap:6px; font-size:${tdFs}px; font-weight:700; }
    .line { font-size:${tdFs}px; font-weight:700; font-family: ui-monospace, monospace; margin:2px 0; overflow-wrap:anywhere; }
    .tot { font-size:${tdFs}px; font-weight:800; }
    .emph { font-weight:900; }
  </style></head><body>
  <div id="slip">
    <div class="shop">${escHtml((shopName || "LEMON MANDI").toUpperCase())}</div>
    <div class="title">VENDOR CHART</div>
    <div class="hr"></div>
    <div class="kv"><span>Date</span><span>${escHtml(dateISO)}</span></div>
    <div class="kv"><span>Vendor</span><span class="emph">${escHtml(col.vendor_name)}</span></div>
    <div class="hr"></div>
    ${rows || `<div class="line">No purchases</div>`}
    <div class="hr"></div>
    <div class="kv tot"><span>TOTAL BAGS</span><span>${col.total_bags}</span></div>
    <div class="kv tot"><span>TOTAL PURCHASE</span><span>${escHtml(rupees(col.total_amount))}</span></div>
    <div class="kv tot emph"><span>WEIGHTED AVG</span><span>Rs ${escHtml(formatChartRate(col.avg_rate))}</span></div>
  </div>
  </body></html>`;
}
