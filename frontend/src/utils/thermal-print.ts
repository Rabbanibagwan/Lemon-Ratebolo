/**
 * Shared thermal receipt print helpers.
 * Width = Settings paper mm (58/80/100). Height = measured content only (never A4 / fixed long page).
 * Print layer is ALWAYS dedicated HTML — never a screenshot of the app UI.
 */
import * as Print from "expo-print";
import { Platform } from "react-native";

export const THERMAL_PAPER_PRESETS = [58, 80, 100] as const;
export type ThermalPaperPreset = (typeof THERMAL_PAPER_PRESETS)[number];

export function clampPaperMm(n: unknown, fallback = 80): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(40, Math.min(120, Math.round(v)));
}

/** Layout metrics that adapt when Settings → paper size changes (58 / 80 / 100 / custom). */
export function thermalMetrics(paperMm: number) {
  const w = clampPaperMm(paperMm);
  // Slightly larger type for thermal darkness/legibility (not screen UI).
  return {
    w,
    bodyFs: w <= 58 ? 10 : w <= 80 ? 12 : 14,
    bigFs: w <= 58 ? 13 : w <= 80 ? 16 : 19,
    hugeFs: w <= 58 ? 17 : w <= 80 ? 22 : 26,
    rowFs: w <= 58 ? 10 : w <= 80 ? 12 : 13,
    // Lot No + Bags: below Net/Farmer, above Rate/Amount
    emphFs: w <= 58 ? 13 : w <= 80 ? 15 : 17,
    qrPx: w <= 58 ? 84 : w <= 80 ? 110 : 130,
    padPx: w <= 58 ? 3 : w <= 80 ? 5 : 8,
    rightMin: w <= 58 ? 50 : w <= 80 ? 68 : 84,
    lotMin: w <= 58 ? 28 : 40,
    // Farmer name matches NET PAYABLE amount (.huge)
    farmerFs: w <= 58 ? 17 : w <= 80 ? 22 : 26,
  };
}

export function thermalBaseCss(m: ReturnType<typeof thermalMetrics>): string {
  return `
    /* Width fixed to printer; height from content. High contrast for thermal darkness. */
    @page { size: ${m.w}mm auto; margin: 0; }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: ${m.w}mm !important;
      max-width: ${m.w}mm !important;
      min-height: 0 !important;
      height: auto !important;
      background: #fff !important;
      color: #000 !important;
      font-family: 'Courier New', Courier, monospace;
      font-size: ${m.bodyFs}px;
      font-weight: 700;
      line-height: 1.3;
      overflow: visible !important;
      /* Slight stroke thickens glyphs on thermal without bleed */
      -webkit-text-stroke: 0.25px #000;
    }
    #slip {
      display: block;
      width: 100%;
      max-width: ${m.w}mm;
      padding: ${m.padPx}px;
      margin: 0;
      height: auto !important;
      min-height: 0 !important;
      color: #000 !important;
    }
    #slip, #slip * { color: #000 !important; }
    .wrap { word-break: break-word; overflow-wrap: anywhere; }
    .center { text-align: center; }
    .bold { font-weight: 900 !important; }
    .big { font-size: ${m.bigFs}px; font-weight: 900 !important; }
    .huge { font-size: ${m.hugeFs}px; font-weight: 900 !important; -webkit-text-stroke: 0.35px #000; }
    .hr {
      border: 0;
      border-top: 2px solid #000 !important;
      margin: 4px 0;
      height: 0;
    }
    .row {
      display: flex; justify-content: space-between; align-items: baseline; gap: 4px;
      padding: 2px 0; font-size: ${m.rowFs}px; font-weight: 700 !important;
    }
    .row .lot {
      min-width: ${m.lotMin}px; flex-shrink: 0;
      font-weight: 900 !important;
    }
    .row .mid { flex: 1; text-align: center; font-weight: 700 !important; font-size: ${m.rowFs}px !important; }
    .row .right { text-align: right; min-width: ${m.rightMin}px; flex-shrink: 0; font-weight: 700 !important; font-size: ${m.rowFs}px !important; }
    /* Farmer Patti only: Lot No + Bags one step below Net/Farmer */
    #slip.patti .row .lot {
      font-size: ${m.emphFs}px !important;
      font-weight: 900 !important;
    }
    #slip.patti .row .bags {
      font-size: ${m.emphFs}px !important;
      font-weight: 900 !important;
    }
    .th { font-size: ${m.rowFs}px; font-weight: 900 !important; text-transform: uppercase; }
    .kv { display: flex; justify-content: space-between; gap: 6px; padding: 2px 0; font-weight: 700 !important; }
    .kv .k { text-transform: uppercase; flex-shrink: 0; font-weight: 800 !important; }
    .kv .v { text-align: right; font-weight: 900 !important; }
    .kv.farmer, .kv.vendor {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 6px;
      padding: 4px 0;
    }
    .kv.farmer .k, .kv.vendor .k {
      font-size: ${m.bodyFs}px;
      font-weight: 800 !important;
      text-align: left;
      flex-shrink: 0;
    }
    .kv.farmer .v, .kv.vendor .v {
      font-size: ${m.farmerFs}px !important;
      font-weight: 900 !important;
      text-align: right !important;
      line-height: 1.15;
      -webkit-text-stroke: 0.35px #000;
      flex: 1;
      min-width: 0;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .netbox {
      border: 3px solid #000 !important;
      padding: 5px 6px; margin: 4px 0;
      display: flex; justify-content: space-between; align-items: center; gap: 6px;
      background: #fff !important;
    }
    .netbox .bold, .netbox .huge { font-weight: 900 !important; }
    img.qr {
      display: block; margin: 6px auto 2px;
      width: ${m.qrPx}px; height: ${m.qrPx}px;
      image-rendering: pixelated;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .foot { font-size: ${Math.max(8, m.bodyFs - 1)}px; font-weight: 700 !important; text-align: center; margin-top: 4px; margin-bottom: 0; }
    .no-print, button, [data-app-ui] { display: none !important; }
  `;
}

/** Estimate page height in points from HTML structure (native / fallback). Tight — no long blank canvas. */
export function estimateThermalHeightPt(html: string, paperMm: number): number {
  const m = thermalMetrics(paperMm);
  const blocks = (html.match(/class="(row|kv|hr|netbox|center|foot|big)/g) || []).length;
  const hasQr = /<img[^>]+class="qr"|class="qr"/i.test(html) || /<img /i.test(html);
  // ~96 CSS px ≈ 25.4 mm
  const contentPx = m.padPx * 2 + Math.max(12, blocks) * (m.rowFs + 4) + (hasQr ? m.qrPx + 28 : 8) + 12;
  const heightMm = Math.max(50, Math.ceil((contentPx * 25.4) / 96) + 3);
  return Math.round(heightMm * 2.834645);
}

function waitForDocImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images || []);
  if (!imgs.length) return Promise.resolve();
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          setTimeout(() => resolve(), 800);
        }),
    ),
  ).then(() => undefined);
}

/**
 * Send ONLY the receipt HTML to the printer.
 * Page size = (paperWidth mm) × (measured content height mm) — never A4 / fixed long page.
 */
export async function printThermalHtmlOnly(html: string, paperMm: number): Promise<void> {
  const w = clampPaperMm(paperMm);
  const widthPt = Math.round(w * 2.834645);

  if (Platform.OS === "web" && typeof document !== "undefined") {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("title", "thermal-print");
    iframe.style.cssText =
      "position:fixed;left:-10000px;top:0;width:" + w + "mm;height:1px;border:0;opacity:0;pointer-events:none;";
    document.body.appendChild(iframe);

    const idoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!idoc) {
      iframe.remove();
      // Fallback: popup path
      await printViaPopup(html, w);
      return;
    }

    idoc.open();
    idoc.write(html);
    idoc.close();

    try {
      await waitForDocImages(idoc);
      // Allow layout to settle
      await new Promise((r) => setTimeout(r, 120));

      const slip = idoc.getElementById("slip") || idoc.body;
      const heightPx = Math.ceil(Math.max(slip.scrollHeight, slip.getBoundingClientRect().height));
      // Content height in mm + 2 mm feed/cut margin (no large blank).
      const heightMm = Math.max(40, Math.ceil((heightPx * 25.4) / 96) + 2);

      const pageStyle = idoc.createElement("style");
      pageStyle.setAttribute("data-thermal-page", "1");
      pageStyle.textContent = `
        @page { size: ${w}mm ${heightMm}mm; margin: 0 !important; }
        html, body { width: ${w}mm !important; height: ${heightMm}mm !important; min-height: 0 !important; max-height: ${heightMm}mm !important; overflow: hidden !important; }
        #slip { height: auto !important; }
      `;
      idoc.head.appendChild(pageStyle);

      // Size iframe for accurate print layout
      iframe.style.width = `${w}mm`;
      iframe.style.height = `${heightMm}mm`;

      await new Promise((r) => setTimeout(r, 50));
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        try { iframe.remove(); } catch { /* ignore */ }
      }, 1200);
    }
    return;
  }

  // Native expo-print: pass tight content-based height (not Letter / not 900pt blank).
  const heightPt = estimateThermalHeightPt(html, w);
  await Print.printAsync({ html, width: widthPt, height: heightPt });
}

async function printViaPopup(html: string, w: number): Promise<void> {
  const popup = window.open("", "_blank", "noopener,noreferrer,width=400,height=600");
  if (!popup) throw new Error("Pop-up blocked — allow pop-ups to print the receipt.");
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  await waitForDocImages(popup.document);
  await new Promise((r) => setTimeout(r, 150));
  const slip = popup.document.getElementById("slip") || popup.document.body;
  const heightPx = Math.ceil(slip.scrollHeight);
  const heightMm = Math.max(40, Math.ceil((heightPx * 25.4) / 96) + 2);
  const style = popup.document.createElement("style");
  style.textContent = `@page { size: ${w}mm ${heightMm}mm; margin: 0; } html, body { height: auto !important; min-height: 0 !important; }`;
  popup.document.head.appendChild(style);
  popup.focus();
  popup.print();
  setTimeout(() => { try { popup.close(); } catch { /* ignore */ } }, 1200);
}
