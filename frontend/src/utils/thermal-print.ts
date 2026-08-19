/**
 * Shared thermal receipt print helpers.
 * Width = Settings paper mm (58/80/100). Height = measured / estimated content only.
 * Print layer is ALWAYS dedicated HTML — never a screenshot of the app UI.
 */
import * as Print from "expo-print";
import { Platform } from "react-native";

export const THERMAL_PAPER_PRESETS = [58, 80, 100] as const;
export type ThermalPaperPreset = (typeof THERMAL_PAPER_PRESETS)[number];

/** CSS px per mm at the standard 96dpi used by browsers / WebViews. */
export const MM_TO_CSS_PX = 96 / 25.4;

export function clampPaperMm(n: unknown, fallback = 80): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(40, Math.min(120, Math.round(v)));
}

/** Layout metrics that adapt when Settings → paper size changes (58 / 80 / 100 / custom). */
export function thermalMetrics(paperMm: number) {
  const w = clampPaperMm(paperMm);
  // Full paper width in CSS px — viewport + measurement must match @page width.
  const widthPx = Math.round(w * MM_TO_CSS_PX);
  // Near-zero side pad so content spans the roll; tiny Y pad for head/cut edge.
  const padX = 0;
  const padY = w <= 58 ? 2 : 3;
  return {
    w,
    widthPx,
    bodyFs: w <= 58 ? 10 : w <= 80 ? 12 : 14,
    bigFs: w <= 58 ? 13 : w <= 80 ? 16 : 19,
    hugeFs: w <= 58 ? 17 : w <= 80 ? 22 : 26,
    rowFs: w <= 58 ? 10 : w <= 80 ? 12 : 13,
    emphFs: w <= 58 ? 13 : w <= 80 ? 15 : 17,
    qrPx: w <= 58 ? 84 : w <= 80 ? 110 : 130,
    /** @deprecated use padX / padY — kept so older callers still compile */
    padPx: padY,
    padX,
    padY,
    // Column shares (percent of slip) — avoid fixed px mins that overflow narrow rolls
    lotPct: w <= 58 ? 20 : 18,
    midPct: w <= 58 ? 48 : 50,
    rightPct: w <= 58 ? 32 : 32,
    farmerFs: w <= 58 ? 17 : w <= 80 ? 22 : 26,
  };
}

export function thermalBaseCss(m: ReturnType<typeof thermalMetrics>): string {
  return `
    /* Exact paper width; height follows content. High contrast for thermal darkness. */
    @page { size: ${m.w}mm auto; margin: 0 !important; }
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
      min-width: ${m.w}mm !important;
      min-height: 0 !important;
      height: auto !important;
      background: #fff !important;
      color: #000 !important;
      font-family: 'Courier New', Courier, monospace;
      font-size: ${m.bodyFs}px;
      font-weight: 700;
      line-height: 1.25;
      overflow: visible !important;
      -webkit-text-stroke: 0.25px #000;
    }
    #slip {
      display: block;
      width: ${m.w}mm !important;
      max-width: ${m.w}mm !important;
      min-width: ${m.w}mm !important;
      padding: ${m.padY}px ${m.padX}px;
      margin: 0 !important;
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
      margin: 3px 0;
      height: 0;
    }
    /* Three columns fill 100% of the slip — no leftover side gutters, no fixed-px overflow */
    .row {
      display: grid;
      grid-template-columns: ${m.lotPct}% ${m.midPct}% ${m.rightPct}%;
      column-gap: 2px;
      align-items: baseline;
      width: 100%;
      max-width: 100%;
      padding: 1px 0;
      font-size: ${m.rowFs}px;
      font-weight: 700 !important;
    }
    .row .lot {
      min-width: 0;
      font-weight: 900 !important;
      overflow-wrap: anywhere;
    }
    .row .mid {
      min-width: 0;
      text-align: center;
      font-weight: 700 !important;
      font-size: ${m.rowFs}px !important;
      overflow-wrap: anywhere;
    }
    .row .right {
      min-width: 0;
      text-align: right;
      font-weight: 700 !important;
      font-size: ${m.rowFs}px !important;
      overflow-wrap: anywhere;
    }
    #slip.patti .row .lot,
    #slip.patti .row .bags {
      font-size: ${m.emphFs}px !important;
      font-weight: 900 !important;
    }
    .th { font-size: ${m.rowFs}px; font-weight: 900 !important; text-transform: uppercase; }
    .kv {
      display: flex; justify-content: space-between; gap: 4px; padding: 1px 0;
      font-weight: 700 !important; width: 100%; max-width: 100%;
    }
    .kv .k { text-transform: uppercase; flex-shrink: 0; font-weight: 800 !important; }
    .kv .v { text-align: right; font-weight: 900 !important; min-width: 0; }
    .kv.farmer, .kv.vendor {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 4px;
      padding: 3px 0;
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
      line-height: 1.12;
      -webkit-text-stroke: 0.35px #000;
      flex: 1;
      min-width: 0;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .netbox {
      border: 3px solid #000 !important;
      padding: 4px 4px; margin: 3px 0;
      display: flex; justify-content: space-between; align-items: center; gap: 4px;
      background: #fff !important;
      width: 100%;
      max-width: 100%;
    }
    .netbox .bold, .netbox .huge { font-weight: 900 !important; }
    img.qr {
      display: block; margin: 4px auto 2px;
      width: ${m.qrPx}px; height: ${m.qrPx}px;
      max-width: 100%;
      image-rendering: pixelated;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .foot {
      font-size: ${Math.max(8, m.bodyFs - 1)}px; font-weight: 700 !important;
      text-align: center; margin-top: 3px; margin-bottom: 0;
    }
    .no-print, button, [data-app-ui] { display: none !important; }
  `;
}

/** Content height in mm from the receipt HTML — tight, grows with rows only. */
export function estimateThermalHeightMm(html: string, paperMm: number): number {
  const m = thermalMetrics(paperMm);
  const pxToMm = 1 / MM_TO_CSS_PX;
  const rows = (html.match(/class="row\b/g) || []).length;
  const kvs = (html.match(/class="kv\b/g) || []).length;
  const hrs = (html.match(/class="hr"/g) || []).length;
  const nets = (html.match(/class="netbox"/g) || []).length;
  const centers = (html.match(/class="center\b/g) || []).length;
  const tableRows = rows > 0 ? 0 : (html.match(/<tr[\s>]/gi) || []).length;
  const hasQr = /class="qr"/i.test(html);
  const lineMm = (m.rowFs + 3) * pxToMm;
  const bigMm = (m.bigFs + 3) * pxToMm;
  const contentMm =
    m.padY * 2 * pxToMm +
    centers * bigMm +
    rows * lineMm +
    kvs * lineMm +
    tableRows * lineMm +
    hrs * 1.1 +
    nets * (m.hugeFs + 12) * pxToMm +
    (hasQr ? (m.qrPx + 14) * pxToMm : 0) +
    10; // safety buffer: Android WebView line-height rounding + tear margin
  return Math.max(28, Math.ceil(contentMm));
}

export function estimateThermalHeightPt(html: string, paperMm: number): number {
  return Math.round(estimateThermalHeightMm(html, paperMm) * 2.834645);
}

/** Replace @page auto / Letter defaults with selected width × content height. */
export function injectThermalPageSize(html: string, paperMm: number, heightMm: number): string {
  const w = clampPaperMm(paperMm);
  const h = Math.max(28, Math.round(heightMm));
  const css = `
    @page { size: ${w}mm ${h}mm; margin: 0 !important; }
    html, body {
      width: ${w}mm !important;
      max-width: ${w}mm !important;
      min-width: ${w}mm !important;
      height: auto !important;
      min-height: 0 !important;
      overflow: visible !important;
    }
    #slip {
      width: ${w}mm !important;
      max-width: ${w}mm !important;
      height: auto !important;
      min-height: 0 !important;
    }
  `;
  let out = html.replace(/@page\s*\{[^}]*\}/g, `@page { size: ${w}mm ${h}mm; margin: 0 !important; }`);
  if (out.includes("</style>")) {
    return out.replace("</style>", `${css}</style>`);
  }
  if (out.includes("<head>")) {
    return out.replace("<head>", `<head><style>${css}</style>`);
  }
  return `<style>${css}</style>${out}`;
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

function measureSlipHeightMm(doc: Document, paperMm: number): number {
  const w = clampPaperMm(paperMm);
  const slip = doc.getElementById("slip") || doc.body;
  // Force layout at the exact paper width before measuring.
  const htmlEl = doc.documentElement;
  const bodyEl = doc.body;
  if (htmlEl) {
    htmlEl.style.width = `${w}mm`;
    htmlEl.style.maxWidth = `${w}mm`;
  }
  if (bodyEl) {
    bodyEl.style.width = `${w}mm`;
    bodyEl.style.maxWidth = `${w}mm`;
  }
  if (slip instanceof HTMLElement) {
    slip.style.width = `${w}mm`;
    slip.style.maxWidth = `${w}mm`;
  }
  const heightPx = Math.ceil(
    Math.max(
      slip.scrollHeight || 0,
      slip instanceof HTMLElement ? slip.offsetHeight : 0,
      slip.getBoundingClientRect?.().height || 0,
    ),
  );
  // CSS px → mm; +2 mm tear margin only (no long blank tail).
  return Math.max(28, Math.ceil(heightPx / MM_TO_CSS_PX) + 2);
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
      `position:fixed;left:-10000px;top:0;width:${w}mm;height:1px;border:0;opacity:0;pointer-events:none;`;
    document.body.appendChild(iframe);

    const idoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!idoc) {
      iframe.remove();
      await printViaPopup(html, w);
      return;
    }

    idoc.open();
    idoc.write(html);
    idoc.close();

    try {
      await waitForDocImages(idoc);
      await new Promise((r) => setTimeout(r, 120));

      const heightMm = measureSlipHeightMm(idoc, w);

      const pageStyle = idoc.createElement("style");
      pageStyle.setAttribute("data-thermal-page", "1");
      pageStyle.textContent = `
        @page { size: ${w}mm ${heightMm}mm; margin: 0 !important; }
        html, body {
          width: ${w}mm !important;
          min-width: ${w}mm !important;
          max-width: ${w}mm !important;
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
        }
        #slip {
          width: ${w}mm !important;
          max-width: ${w}mm !important;
          height: auto !important;
        }
      `;
      idoc.head.appendChild(pageStyle);

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

  // Native: inject explicit @page WxH so Android Print does not expand to A4/Letter.
  const heightMm = estimateThermalHeightMm(html, w);
  const heightPt = Math.round(heightMm * 2.834645);
  const htmlPaged = injectThermalPageSize(html, w, heightMm);
  await Print.printAsync({
    html: htmlPaged,
    width: widthPt,
    height: heightPt,
  });
}

/** Merchant-facing print error — never leak canvas / WebView internals. */
export function thermalPrintUserMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const lower = raw.toLowerCase();
  if (lower.includes("pop-up") || lower.includes("popup")) {
    return raw;
  }
  if (
    /bluetooth is turned off|permission is required|printer disconnected|printing failed|select a bluetooth printer|not available in this preview|select bluetooth in settings/i.test(raw)
  ) {
    return raw;
  }
  return "Printing failed. Check the printer connection and try again.";
}

async function printViaPopup(html: string, w: number): Promise<void> {
  const popup = window.open("", "_blank", "noopener,noreferrer,width=400,height=600");
  if (!popup) throw new Error("Pop-up blocked — allow pop-ups to print the receipt.");
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  await waitForDocImages(popup.document);
  await new Promise((r) => setTimeout(r, 150));
  const heightMm = measureSlipHeightMm(popup.document, w);
  const style = popup.document.createElement("style");
  style.textContent = `
    @page { size: ${w}mm ${heightMm}mm; margin: 0 !important; }
    html, body {
      width: ${w}mm !important;
      max-width: ${w}mm !important;
      height: auto !important;
      min-height: 0 !important;
    }
  `;
  popup.document.head.appendChild(style);
  popup.focus();
  popup.print();
  setTimeout(() => { try { popup.close(); } catch { /* ignore */ } }, 1200);
}
