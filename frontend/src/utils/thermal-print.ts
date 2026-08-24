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
  // Global Y pad for head/cut edge. Slip docs add horizontal margins via pattiPadX.
  const padX = 0;
  const padY = w <= 58 ? 2 : 3;
  /** Shared side inset (~1.5–2.5 mm) for Farmer Patti + Vendor Bill (not edge-to-edge). */
  const pattiPadX = w <= 58 ? 5 : w <= 80 ? 8 : 10;
  /** QR display px — slightly larger, still under (widthPx - 2*pattiPadX). */
  const qrPx = w <= 58 ? 108 : w <= 80 ? 140 : 168;
  return {
    w,
    widthPx,
    bodyFs: w <= 58 ? 10 : w <= 80 ? 12 : 14,
    bigFs: w <= 58 ? 13 : w <= 80 ? 16 : 19,
    hugeFs: w <= 58 ? 17 : w <= 80 ? 22 : 26,
    rowFs: w <= 58 ? 10 : w <= 80 ? 12 : 13,
    emphFs: w <= 58 ? 13 : w <= 80 ? 15 : 17,
    /** Lot no. — one step above emph, still below bigFs (safe on 58 mm). */
    lotFs: w <= 58 ? 14 : w <= 80 ? 16 : 18,
    /** Hamali / Bhada / Stationery — slightly under body. */
    deductFs: w <= 58 ? 9 : w <= 80 ? 11 : 13,
    /** TOTAL DEDUCTION — one step above deductFs, still below bodyFs. */
    deductTotalFs: w <= 58 ? 10 : w <= 80 ? 12 : 14,
    qrPx,
    /** @deprecated use padX / padY — kept so older callers still compile */
    padPx: padY,
    padX,
    padY,
    pattiPadX,
    // Column shares (percent of slip) — avoid fixed px mins that overflow narrow rolls
    lotPct: w <= 58 ? 20 : 18,
    midPct: w <= 58 ? 48 : 50,
    rightPct: w <= 58 ? 32 : 32,
    farmerFs: w <= 58 ? 20 : w <= 80 ? 24 : 28,
    /** Vendor name — one step under farmerFs, still bold/readable on the same row. */
    vendorFs: w <= 58 ? 16 : w <= 80 ? 18 : 22,
    /** Merchant shop name — largest header signal (Preview shopName ~20–24px). */
    shopFs: w <= 58 ? 18 : w <= 80 ? 24 : 28,
  };
}

/** Shared thermal layout. Farmer Patti adds Times/roman overrides via thermalPattiCss(). */
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
      font-family: "Times New Roman", Times, "Liberation Serif", Georgia, serif;
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
    .shop {
      font-size: ${m.shopFs}px !important;
      font-weight: 900 !important;
      line-height: 1.1;
      letter-spacing: -0.3px;
      -webkit-text-stroke: 0.4px #000;
      margin: 0 0 2px 0;
    }
    .addr {
      font-size: ${Math.max(8, m.bodyFs - 1)}px !important;
      font-weight: 400 !important;
      -webkit-text-stroke: 0 !important;
      line-height: 1.2;
    }
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
    #slip.patti .row .lot {
      font-size: ${m.lotFs}px !important;
      font-weight: 900 !important;
    }
    #slip.patti .row .bags {
      font-size: ${m.emphFs}px !important;
      font-weight: 900 !important;
    }
    /* Deduction lines: same Times family, slightly under body; amounts stay right. */
    #slip.patti .kv.deduct {
      font-size: ${m.deductFs}px !important;
      font-weight: 400 !important;
      -webkit-text-stroke: 0 !important;
      gap: 4px;
    }
    #slip.patti .kv.deduct > span:first-child {
      flex: 1 1 auto;
      min-width: 0;
      font-weight: 400 !important;
      overflow-wrap: anywhere;
    }
    #slip.patti .kv.deduct > span:last-child {
      flex: 0 0 auto;
      text-align: right !important;
      font-weight: 400 !important;
      white-space: nowrap;
    }
    /* Same family as deduct; one step larger; bold (still ≤ bodyFs). */
    #slip.patti .kv.deduct-total {
      font-size: ${m.deductTotalFs}px !important;
      font-weight: 900 !important;
      -webkit-text-stroke: 0 !important;
      gap: 4px;
      text-transform: none;
    }
    #slip.patti .kv.deduct-total > span:first-child {
      flex: 1 1 auto;
      min-width: 0;
      font-weight: 900 !important;
      overflow-wrap: anywhere;
    }
    #slip.patti .kv.deduct-total > span:last-child {
      flex: 0 0 auto;
      text-align: right !important;
      font-weight: 900 !important;
      white-space: nowrap;
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
    /* Farmer label + name must stay one row (label left, name right). */
    #slip.patti .kv.farmer {
      flex-wrap: nowrap;
      align-items: center;
      gap: 8px;
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
    /* Driver: reserve most of the line for the name; wrap value, never drop the row. */
    #slip.patti .kv.driver {
      flex-wrap: nowrap;
      align-items: baseline;
      gap: 8px;
    }
    #slip.patti .kv.driver .k {
      flex: 0 0 auto;
      max-width: 32%;
    }
    #slip.patti .kv.driver .v {
      flex: 1 1 auto;
      min-width: 60%;
      text-align: right !important;
      font-weight: 800 !important;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .netbox {
      border: 3px solid #000 !important;
      padding: 8px 6px; margin: 6px 0;
      display: flex; justify-content: space-between; align-items: center; gap: 6px;
      background: #000 !important;
      width: 100%;
      max-width: 100%;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    /* Must beat #slip * color:#000 or TOTAL text vanishes on the black fill. */
    #slip .netbox, #slip .netbox * { color: #fff !important; -webkit-text-stroke: 0 !important; }
    .netbox .bold {
      font-size: ${m.emphFs}px !important;
      font-weight: 900 !important;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .netbox .huge {
      font-size: ${m.hugeFs}px !important;
      font-weight: 900 !important;
    }
    /* Farmer Patti only: Times Roman + clearer Net Payable spacing (size unchanged). */
    #slip.patti,
    #slip.patti * {
      font-family: "Times New Roman", Times, "Liberation Serif", Georgia, serif !important;
    }
    /* Side margins so content is centered in the printable area (not edge-to-edge). */
    #slip.patti {
      padding-left: ${m.pattiPadX}px !important;
      padding-right: ${m.pattiPadX}px !important;
      box-sizing: border-box !important;
    }
    #slip.patti .netbox {
      padding: 12px 12px;
      gap: 14px;
    }
    #slip.patti .netbox .bold {
      letter-spacing: 0.1em;
      flex-shrink: 0;
      text-transform: none !important;
    }
    #slip.patti .netbox .huge {
      letter-spacing: 0.06em;
      font-variant-numeric: lining-nums tabular-nums;
      padding-left: 10px;
      white-space: nowrap;
      text-align: right;
    }
    /* Fixed labels: sentence case (override shared uppercase rules). Values keep user casing. */
    #slip.patti .kv .k,
    #slip.patti .th,
    #slip.patti .th .lot,
    #slip.patti .th .mid,
    #slip.patti .th .right {
      text-transform: none !important;
    }
    /* Patti number slightly larger than body, still bold. */
    #slip.patti .patti-no {
      font-size: ${m.emphFs}px !important;
      font-weight: 900 !important;
    }
    img.qr {
      display: block; margin: 4px auto 2px;
      width: ${m.qrPx}px; height: ${m.qrPx}px;
      max-width: 100%;
      image-rendering: pixelated;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    #slip.patti img.qr {
      width: ${m.qrPx}px !important;
      height: ${m.qrPx}px !important;
      max-width: calc(100% - 2px) !important;
      margin: 10px auto 4px !important;
    }
    /* Vendor Bill only: Times + printable side margins + same-row vendor name. */
    #slip.vendor,
    #slip.vendor * {
      font-family: "Times New Roman", Times, "Liberation Serif", Georgia, serif !important;
    }
    #slip.vendor {
      padding-left: ${m.pattiPadX}px !important;
      padding-right: ${m.pattiPadX}px !important;
      box-sizing: border-box !important;
    }
    /* Label left + name right on one row (not stacked). */
    #slip.vendor .kv.vendor {
      flex-wrap: nowrap;
      align-items: center;
      gap: 8px;
    }
    #slip.vendor .kv.vendor .k {
      flex: 0 0 auto;
      max-width: 32%;
    }
    #slip.vendor .kv.vendor .v {
      flex: 1 1 auto;
      min-width: 0;
      font-size: ${m.vendorFs}px !important;
      font-weight: 900 !important;
      text-align: right !important;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    #slip.vendor .netbox {
      padding: 10px 10px;
      gap: 12px;
    }
    #slip.vendor .netbox .bold,
    #slip.vendor .netbox .huge {
      color: #fff !important;
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
  const shops = (html.match(/class="[^"]*\bshop\b/g) || []).length;
  const drvItems = (html.match(/class="drv-item"/g) || []).length;
  const drvTr = (html.match(/class="drv-tr"/g) || []).length;
  const tableRows = rows > 0 || drvTr > 0 ? 0 : (html.match(/<tr[\s>]/gi) || []).length;
  const hasQr = /class="qr"/i.test(html);
  const lineMm = (m.rowFs + 3) * pxToMm;
  const compactRowMm = Math.max(2.4, (m.rowFs + 1) * pxToMm);
  const bigMm = (m.bigFs + 3) * pxToMm;
  const shopMm = (m.shopFs + 4) * pxToMm;
  const contentMm =
    m.padY * 2 * pxToMm +
    shops * shopMm +
    Math.max(0, centers - shops) * bigMm +
    rows * lineMm +
    kvs * lineMm +
    drvItems * (lineMm * 5) +
    drvTr * compactRowMm +
    tableRows * lineMm +
    hrs * 1.1 +
    nets * (m.hugeFs + 18) * pxToMm +
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

/** Open a visible preview tab during the click gesture (before any await). */
export function openThermalPreviewWindow(title: string): Window | null {
  if (typeof window === "undefined") return null;
  // Do NOT use noopener/noreferrer — modern browsers then return null and we cannot write HTML.
  const popup = window.open("about:blank", "_blank", "width=560,height=820");
  if (!popup) return null;
  try {
    popup.document.open();
    popup.document.write(
      `<!doctype html><html><head><meta charset="utf-8"/><title>${String(title || "Report").replace(/[<>&]/g, "")}</title></head>` +
        `<body style="margin:0;padding:16px;font-family:'Times New Roman',Times,serif;background:#fff;color:#000">` +
        `Preparing report…</body></html>`,
    );
    popup.document.close();
  } catch {
    /* ignore write errors; caller may still navigate later */
  }
  return popup;
}

/**
 * Write thermal HTML into an already-open preview window, size the page, and open print dialog.
 * Does not auto-close — user must see the report.
 */
export async function fillThermalPreviewAndPrint(
  popup: Window,
  html: string,
  paperMm: number,
): Promise<void> {
  const w = clampPaperMm(paperMm);
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  await waitForDocImages(popup.document);
  await new Promise((r) => setTimeout(r, 120));
  const heightMm = measureSlipHeightMm(popup.document, w);
  const style = popup.document.createElement("style");
  style.textContent = `
    @page { size: ${w}mm ${heightMm}mm; margin: 0 !important; }
    html, body {
      width: ${w}mm !important;
      max-width: ${w}mm !important;
      height: auto !important;
      min-height: 0 !important;
      margin: 0 auto !important;
      background: #fff !important;
    }
  `;
  popup.document.head?.appendChild(style);
  popup.focus();
  await new Promise((r) => setTimeout(r, 80));
  popup.print();
}

/** Browser-safe fallback when popups are blocked: full-screen HTML preview + Print. */
export function showInPageThermalPreview(html: string, title: string = "Print preview"): void {
  if (typeof document === "undefined") return;
  document.getElementById("lemon-thermal-preview-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "lemon-thermal-preview-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", title);
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.6);display:flex;flex-direction:column;padding:10px;box-sizing:border-box;";

  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#111;color:#fff;font-family:system-ui,sans-serif;border-radius:6px 6px 0 0;";
  const label = document.createElement("div");
  label.textContent = title;
  label.style.cssText = "font-weight:700;font-size:13px;";
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;";
  const printBtn = document.createElement("button");
  printBtn.type = "button";
  printBtn.textContent = "PRINT";
  printBtn.style.cssText =
    "padding:8px 12px;font-weight:800;border:0;border-radius:4px;background:#fff;color:#111;cursor:pointer;";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "CLOSE";
  closeBtn.style.cssText =
    "padding:8px 12px;font-weight:800;border:1px solid #fff;border-radius:4px;background:transparent;color:#fff;cursor:pointer;";
  actions.appendChild(printBtn);
  actions.appendChild(closeBtn);
  bar.appendChild(label);
  bar.appendChild(actions);

  const frame = document.createElement("iframe");
  frame.title = title;
  frame.style.cssText =
    "flex:1;width:100%;border:0;background:#fff;border-radius:0 0 6px 6px;min-height:0;";

  overlay.appendChild(bar);
  overlay.appendChild(frame);
  document.body.appendChild(overlay);

  const idoc = frame.contentDocument || frame.contentWindow?.document;
  if (idoc) {
    idoc.open();
    idoc.write(html);
    idoc.close();
  }

  const close = () => {
    try {
      overlay.remove();
    } catch {
      /* ignore */
    }
  };
  closeBtn.onclick = close;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  printBtn.onclick = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      /* ignore */
    }
  };
}

/** Open PDF bytes in a visible tab (or in-page iframe). Prefer an already-opened window. */
export function openPdfBytesPreviewWeb(
  bytes: Uint8Array,
  filename: string,
  existing?: Window | null,
): "shared" | "downloaded" {
  if (typeof document === "undefined") throw new Error("PDF preview requires a browser");
  const blob = new Blob(
    [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
    { type: "application/pdf" },
  );
  const url = URL.createObjectURL(blob);

  if (existing && !existing.closed) {
    try {
      existing.location.href = url;
      existing.focus();
      return "shared";
    } catch {
      /* fall through */
    }
  }

  const opened = typeof window !== "undefined" ? window.open(url, "_blank") : null;
  if (opened) {
    try {
      opened.focus();
    } catch {
      /* ignore */
    }
    return "shared";
  }

  // Popup blocked: in-page PDF preview
  document.getElementById("lemon-pdf-preview-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "lemon-pdf-preview-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.6);display:flex;flex-direction:column;padding:10px;box-sizing:border-box;";
  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;background:#111;color:#fff;font-family:system-ui,sans-serif;border-radius:6px 6px 0 0;";
  const label = document.createElement("div");
  label.textContent = filename || "Driver report PDF";
  label.style.cssText = "font-weight:700;font-size:13px;";
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;";
  const dl = document.createElement("a");
  dl.href = url;
  dl.download = filename || "report.pdf";
  dl.textContent = "DOWNLOAD";
  dl.style.cssText =
    "padding:8px 12px;font-weight:800;border-radius:4px;background:#fff;color:#111;text-decoration:none;";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "CLOSE";
  closeBtn.style.cssText =
    "padding:8px 12px;font-weight:800;border:1px solid #fff;border-radius:4px;background:transparent;color:#fff;cursor:pointer;";
  actions.appendChild(dl);
  actions.appendChild(closeBtn);
  bar.appendChild(label);
  bar.appendChild(actions);
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = filename || "PDF";
  frame.style.cssText =
    "flex:1;width:100%;border:0;background:#fff;border-radius:0 0 6px 6px;min-height:0;";
  overlay.appendChild(bar);
  overlay.appendChild(frame);
  document.body.appendChild(overlay);
  closeBtn.onclick = () => {
    try {
      overlay.remove();
    } catch {
      /* ignore */
    }
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return "shared";
}

/**
 * Send ONLY the receipt HTML to the printer.
 * Page size = (paperWidth mm) × (measured content height mm) — never A4 / fixed long page.
 */
export async function printThermalHtmlOnly(html: string, paperMm: number): Promise<void> {
  const w = clampPaperMm(paperMm);
  const widthPt = Math.round(w * 2.834645);

  if (Platform.OS === "web" && typeof document !== "undefined") {
    // Prefer an already-visible preview path: open sync window, then print.
    // If blocked, show in-page preview (browser-safe).
    const preview = openThermalPreviewWindow("Print preview");
    if (preview) {
      await fillThermalPreviewAndPrint(preview, html, w);
      return;
    }
    showInPageThermalPreview(html, "Print preview");
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
  // Kept for compatibility; prefer openThermalPreviewWindow + fillThermalPreviewAndPrint.
  const popup = openThermalPreviewWindow("Print preview");
  if (!popup) {
    showInPageThermalPreview(html, "Print preview");
    return;
  }
  await fillThermalPreviewAndPrint(popup, html, w);
}
