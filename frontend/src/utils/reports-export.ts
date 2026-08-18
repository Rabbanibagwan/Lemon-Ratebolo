import { Platform, Share } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";

import type { DriverRange, Patti, PattiAuditLogEntry, Settings, VendorBill } from "@/src/api";
import { EscPosBuilder, rupees } from "@/src/utils/escpos";
import { printThermalDocument } from "@/src/utils/thermal-connection";
import { resolvePrintPaperMm } from "@/src/utils/printer-prefs";
import { thermalBaseCss, thermalMetrics, injectThermalPageSize, estimateThermalHeightMm, clampPaperMm } from "@/src/utils/thermal-print";
import { buildXlsxBytes, bytesToBase64 } from "@/src/utils/simple-xlsx";

/** Auction-day driver ranges used for Entry Book "driver receiving". */
export type DriverRangeRef = Pick<DriverRange, "range_from" | "range_to" | "name">;

/** Primary lot Sri / serial for a Patti (1 Patti = 1 Lot). */
export function pattiLotSerial(p: Patti): number | null {
  const lots = p.lots || [];
  if (!lots.length) return null;
  const n = Number(lots[0].lot_serial_no);
  if (Number.isFinite(n)) return n;
  const m = String(lots[0].lot_no || "").match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Driver receiving: receiver empty (or still default = driver name), driver assigned,
 * and lot Sri falls in that driver's FROM–TO range. Does not mutate Patti records.
 */
export function isDriverRangeReceived(p: Patti, drivers: DriverRangeRef[]): boolean {
  const driverName = (p.driver_name || "").trim();
  if (!driverName || !drivers.length) return false;
  const recv = (p.receiver_name || "").trim();
  // Representative name entered (different from driver) → not driver-auto-received.
  if (recv && recv.toLowerCase() !== driverName.toLowerCase()) return false;
  const serial = pattiLotSerial(p);
  if (serial == null) return false;
  const key = driverName.toLowerCase();
  return drivers.some((d) => {
    const n = (d.name || "").trim().toLowerCase();
    return n === key && serial >= Number(d.range_from) && serial <= Number(d.range_to);
  });
}

export function isPattiReceived(p: Patti, drivers?: DriverRangeRef[]): boolean {
  if (p.status === "received") return true;
  if (drivers && drivers.length) return isDriverRangeReceived(p, drivers);
  return false;
}

export function receiverDisplay(p: Patti, drivers?: DriverRangeRef[]): string {
  if (p.status === "received") {
    return (p.receiver_name || "").trim() || "—";
  }
  if (drivers && drivers.length && isDriverRangeReceived(p, drivers)) {
    const d = (p.driver_name || "").trim();
    return d ? `Driver/${d}` : "—";
  }
  return "—";
}

export function lotLabel(p: Patti): string {
  const lots = p.lots || [];
  if (!lots.length) return "—";
  if (lots.length === 1) return lots[0].lot_no || "—";
  return lots.map((l) => l.lot_no).filter(Boolean).join(", ") || "—";
}

function lotSerials(p: Patti): number[] {
  return (p.lots || [])
    .map((l) => Number(l.lot_serial_no))
    .filter((n) => Number.isFinite(n));
}

function lotNos(p: Patti): string[] {
  return (p.lots || []).map((l) => l.lot_no || "").filter(Boolean);
}

export type DriverSummary = {
  driver_name: string;
  place: string | null;
  lot_from: string;
  lot_to: string;
  total_bags: number;
  total_bhada: number;
  pattis: Patti[];
};

export type DriverDetailTotals = {
  total_bags: number;
  total_bhada: number;
  gross_payable: number;
  received_amount: number;
  outstanding: number;
};

export function groupDrivers(pattis: Patti[]): DriverSummary[] {
  const map = new Map<string, Patti[]>();
  for (const p of pattis) {
    const name = (p.driver_name || "").trim();
    if (!name) continue;
    const list = map.get(name) || [];
    list.push(p);
    map.set(name, list);
  }

  const out: DriverSummary[] = [];
  for (const [driver_name, rows] of map) {
    const serials: number[] = [];
    const nos: string[] = [];
    let total_bags = 0;
    let total_bhada = 0;
    let place: string | null = null;
    for (const p of rows) {
      total_bags += p.total_bags || 0;
      total_bhada += p.bhada_total || 0;
      if (!place && p.driver_place) place = p.driver_place;
      serials.push(...lotSerials(p));
      nos.push(...lotNos(p));
    }
    let lot_from = "—";
    let lot_to = "—";
    if (serials.length) {
      const min = Math.min(...serials);
      const max = Math.max(...serials);
      const bySerial = new Map<number, string>();
      for (const p of rows) {
        for (const l of p.lots || []) {
          if (Number.isFinite(Number(l.lot_serial_no))) {
            bySerial.set(Number(l.lot_serial_no), l.lot_no);
          }
        }
      }
      lot_from = bySerial.get(min) || String(min);
      lot_to = bySerial.get(max) || String(max);
    } else if (nos.length) {
      const sorted = [...nos].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      lot_from = sorted[0];
      lot_to = sorted[sorted.length - 1];
    }
    rows.sort((a, b) => a.patti_no - b.patti_no);
    out.push({
      driver_name,
      place,
      lot_from,
      lot_to,
      total_bags,
      total_bhada,
      pattis: rows,
    });
  }
  out.sort((a, b) => a.driver_name.localeCompare(b.driver_name));
  return out;
}

export function driverDetailTotals(pattis: Patti[], drivers?: DriverRangeRef[]): DriverDetailTotals {
  let total_bags = 0;
  let total_bhada = 0;
  let gross_payable = 0;
  let received_amount = 0;
  for (const p of pattis) {
    total_bags += p.total_bags || 0;
    total_bhada += p.bhada_total || 0;
    const pay = p.net_payable || 0;
    gross_payable += pay;
    if (isPattiReceived(p, drivers)) received_amount += pay;
  }
  return {
    total_bags,
    total_bhada,
    gross_payable,
    received_amount,
    outstanding: gross_payable - received_amount,
  };
}

export function farmerTotals(pattis: Patti[], drivers?: DriverRangeRef[]) {
  const base = driverDetailTotals(pattis, drivers);
  let total_gross = 0;
  for (const p of pattis) total_gross += p.farmer_gross || 0;
  return { ...base, total_gross };
}

export function vendorTotals(bills: VendorBill[]) {
  let total_bags = 0;
  let bill_amount = 0;
  for (const b of bills) {
    total_bags += b.total_bags || 0;
    bill_amount += b.grand_total || 0;
  }
  return { total_bags, bill_amount, count: bills.length };
}

export function fmtMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function escHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

/** A4 points (72 dpi) for expo-print printToFileAsync — must match @page size. */
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

/**
 * Print ONLY the provided HTML document (report content).
 * Never use expo-print on web — its web impl ignores `html` and runs window.print()
 * on the whole app (tabs/nav/garbage text outside the report).
 */
async function printDedicatedHtmlDocument(html: string): Promise<void> {
  if (typeof document === "undefined") {
    throw new Error("Print is only available in a browser or native app");
  }

  const frame = document.createElement("iframe");
  frame.setAttribute("title", "report-print");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(frame);

  const win = frame.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    try {
      document.body.removeChild(frame);
    } catch {
      /* ignore */
    }
    throw new Error("Could not create print frame");
  }

  doc.open();
  doc.write(html);
  doc.close();

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    if (doc.readyState === "complete") setTimeout(done, 30);
    else win.addEventListener("load", () => setTimeout(done, 30), { once: true });
  });

  try {
    win.focus();
    win.print();
  } finally {
    setTimeout(() => {
      try {
        document.body.removeChild(frame);
      } catch {
        /* ignore */
      }
    }, 1500);
  }
}

/**
 * Standalone A4 report document for Print / Save / Share.
 * Never includes app chrome, tabs, or debug text — only the report.
 */
function pdfShell(title: string, subtitle: string, body: string, foot: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escHtml(title)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm 12mm; }
    html, body {
      margin: 0; padding: 0; width: 100%;
      background: #ffffff !important; color: #111827;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    body {
      font-family: Arial, Helvetica, "Segoe UI", Roboto, sans-serif;
      font-size: 11px; line-height: 1.35;
    }
    h1 { margin: 0 0 4px; font-size: 18px; letter-spacing:-0.3px; font-weight: 900; }
    .sub { color:#374151; font-size:11px; margin-bottom: 10px; line-height: 1.4; }
    .card { border:2px solid #111827; padding: 10px 12px; }
    table { width:100%; border-collapse: collapse; table-layout: fixed; }
    thead th {
      text-align:left; font-size:8px; letter-spacing:0.8px; color:#6B7280; padding: 6px 3px;
      border-bottom:2px solid #111827; text-transform:uppercase; font-weight:800;
    }
    tbody td { padding: 5px 3px; border-bottom:1px dashed #D1D5DB; font-size: 10.5px; vertical-align: top; word-break: break-word; }
    .right { text-align: right; } .strong { font-weight: 800; } .mono { font-family: "Courier New", Consolas, monospace; }
    .strike { text-decoration: line-through; color: #6B7280; }
    .trow { display:flex; justify-content:space-between; padding: 3px 0; font-size:11px; }
    .net { background:#111827; color:#fff; padding: 9px 10px; display:flex; justify-content:space-between;
      align-items:center; margin-top:8px; }
    .netl { font-size:10px; font-weight:900; letter-spacing:1.2px; }
    .netv { font-family: "Courier New", Consolas, monospace; font-weight:900; font-size:16px; }
    .foot { margin-top: 12px; font-size:9px; color:#6B7280; text-align:center; }
  </style></head><body>
  <h1>${escHtml(title)}</h1>
  <div class="sub">${subtitle}</div>
  <div class="card">${body}</div>
  <div class="foot">${escHtml(foot)}</div>
  </body></html>`;
}

/** A4 PDF — Driver Details (also used for SHARE). Includes Farmer Name. */
export function renderDriverReportHtml(
  d: DriverSummary,
  dateISO: string,
  shopName: string,
  userName: string,
): string {
  const totals = driverDetailTotals(d.pattis);
  const rows = d.pattis
    .map((p) => {
      const recv = isPattiReceived(p);
      return `<tr>
      <td class="mono">#${p.patti_no}</td>
      <td class="mono">${escHtml(lotLabel(p))}</td>
      <td>${escHtml(p.farmer_name || "—")}</td>
      <td class="mono right">${p.total_bags}</td>
      <td class="mono right">${fmtMoney(p.bhada_total)}</td>
      <td class="mono right ${recv ? "strike" : "strong"}">${fmtMoney(p.net_payable)}</td>
      <td>${escHtml(receiverDisplay(p))}</td>
    </tr>`;
    })
    .join("");
  const body = `
    <table>
      <thead><tr>
        <th style="width:10%">PATTI</th>
        <th style="width:12%">LOT</th>
        <th style="width:18%">FARMER</th>
        <th class="right" style="width:10%">BAGS</th>
        <th class="right" style="width:14%">BHADA</th>
        <th class="right" style="width:16%">PAYABLE</th>
        <th style="width:20%">RECEIVER</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="7" style="text-align:center;color:#6B7280;padding:14px">No pattis</td></tr>`}</tbody>
    </table>
    <div style="margin-top:10px">
      <div class="trow"><span>Total bags</span><span class="mono strong">${totals.total_bags}</span></div>
      <div class="trow"><span>Total bhada</span><span class="mono strong">${fmtMoney(totals.total_bhada)}</span></div>
      <div class="trow"><span>Total payable</span><span class="mono strong">${fmtMoney(totals.gross_payable)}</span></div>
      <div class="trow"><span>Received deduction</span><span class="mono">${fmtMoney(totals.received_amount)}</span></div>
    </div>
    <div class="net"><div class="netl">OUTSTANDING</div><div class="netv">${fmtMoney(totals.outstanding)}</div></div>`;
  return pdfShell(
    `${shopName.toUpperCase()} — DRIVER DETAILS`,
    `Driver: <b>${escHtml(d.driver_name)}</b>${d.place ? " · " + escHtml(d.place) : ""} · Date ${escHtml(dateISO)} · Lots ${escHtml(d.lot_from)}–${escHtml(d.lot_to)}`,
    body,
    `Generated by ${userName} · ${new Date().toLocaleString("en-IN")}`,
  );
}

/** Compact 58/80/100 mm thermal receipt for Driver Details. */
export function renderDriverThermalHtml(
  d: DriverSummary,
  dateISO: string,
  shopName: string,
  paperMm: number = 80,
  drivers?: DriverRangeRef[],
): string {
  const m = thermalMetrics(paperMm);
  const totals = driverDetailTotals(d.pattis, drivers);
  const rows = d.pattis
    .map((p) => {
      const recv = isPattiReceived(p, drivers);
      const strike = recv ? "strike" : "";
      return `<tr class="row">
        <td>${p.patti_no}</td>
        <td class="wrap">${escHtml(lotLabel(p))}</td>
        <td class="wrap">${escHtml(p.farmer_name || "—")}</td>
        <td class="r">${p.total_bags}</td>
        <td class="r">${fmtMoney(p.bhada_total)}</td>
        <td class="r ${strike}">${fmtMoney(p.net_payable)}</td>
        <td class="wrap">${escHtml(receiverDisplay(p, drivers))}</td>
      </tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=${m.widthPx}, initial-scale=1, maximum-scale=1"/>
  <title>Driver ${escHtml(d.driver_name)}</title>
  <style>${thermalBaseCss(m)}
    table.drv { width:100%; border-collapse:collapse; table-layout:fixed; }
    table.drv th, table.drv td {
      font-size:${Math.max(8, m.rowFs - 2)}px; font-weight:800; padding:2px 1px; vertical-align:top;
      word-break:break-word;
    }
    table.drv th { text-align:left; border-bottom:1px solid #000; }
    table.drv td.r, table.drv th.r { text-align:right; }
    table.drv .strike { text-decoration:line-through; }
    table.drv col.c1 { width:9%; } table.drv col.c2 { width:12%; } table.drv col.c3 { width:18%; }
    table.drv col.c4 { width:9%; } table.drv col.c5 { width:16%; } table.drv col.c6 { width:18%; }
    table.drv col.c7 { width:18%; }
  </style></head><body>
  <div id="slip">
    <div class="center big bold wrap">${escHtml((shopName || "LEMON MANDI").toUpperCase())}</div>
    <div class="center bold">DRIVER DETAILS</div>
    <div class="hr"></div>
    <div class="kv"><span class="k">Driver</span><span class="bold wrap">${escHtml(d.driver_name)}</span></div>
    ${d.place ? `<div class="kv"><span class="k">Place</span><span class="wrap">${escHtml(d.place)}</span></div>` : ""}
    <div class="kv"><span class="k">Date</span><span>${escHtml(dateISO)}</span></div>
    <div class="kv"><span class="k">Lots</span><span>${escHtml(d.lot_from)} – ${escHtml(d.lot_to)}</span></div>
    <div class="hr"></div>
    <table class="drv">
      <colgroup>
        <col class="c1"/><col class="c2"/><col class="c3"/><col class="c4"/>
        <col class="c5"/><col class="c6"/><col class="c7"/>
      </colgroup>
      <thead>
        <tr class="row">
          <th>PT</th><th>LOT</th><th>FARMER</th><th class="r">BG</th>
          <th class="r">BHADA</th><th class="r">PAY</th><th>RECV</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="7" class="center">No pattis</td></tr>`}</tbody>
    </table>
    <div class="hr"></div>
    <div class="kv"><span>Total Bags</span><span>${totals.total_bags}</span></div>
    <div class="kv"><span>Total Bhada</span><span>${fmtMoney(totals.total_bhada)}</span></div>
    <div class="kv"><span>Total Payable</span><span>${fmtMoney(totals.gross_payable)}</span></div>
    <div class="kv"><span>Received</span><span>${fmtMoney(totals.received_amount)}</span></div>
    <div class="netbox"><span class="bold">OUTSTANDING</span><span class="huge">${fmtMoney(totals.outstanding)}</span></div>
    <div class="hr"></div>
  </div>
  </body></html>`;
}

export async function thermalPrintDriverReport(
  d: DriverSummary,
  dateISO: string,
  shopName: string,
  settings?: Settings | null,
  drivers?: DriverRangeRef[],
): Promise<void> {
  const mm = await resolvePrintPaperMm(settings?.thermal_paper_width_mm);
  const html = renderDriverThermalHtml(d, dateISO, shopName, mm, drivers);
  await printThermalDocument({
    html,
    escposBase64: encodeDriverReportEscPos(d, dateISO, shopName, mm, drivers),
    paperMm: mm,
  });
}

/**
 * Share Driver Details using the SAME thermal layout as Print (not a screenshot / not A4 HTML).
 * Produces a real PDF suitable for WhatsApp and other share targets.
 */
export async function shareDriverThermalReport(
  d: DriverSummary,
  dateISO: string,
  shopName: string,
  settings?: Settings | null,
  drivers?: DriverRangeRef[],
): Promise<"shared" | "downloaded" | "printed"> {
  const mm = await resolvePrintPaperMm(settings?.thermal_paper_width_mm);
  const html = renderDriverThermalHtml(d, dateISO, shopName, mm, drivers);
  const safeName = `driver-${(d.driver_name || "report").replace(/[^\w.\-]+/g, "_")}-${dateISO}.pdf`;
  const title = `Driver ${d.driver_name}`;

  if (Platform.OS === "web") {
    // Build a real PDF file from the same thermal report data/columns.
    const { buildDriverThermalPdfBytes } = await import("@/src/utils/report-pdf");
    const bytes = buildDriverThermalPdfBytes(d, dateISO, shopName, mm);
    return exportPdfBytes(bytes, safeName, title, "share");
  }

  const w = clampPaperMm(mm);
  const heightMm = estimateThermalHeightMm(html, w);
  const htmlPaged = injectThermalPageSize(html, w, heightMm);
  const { uri } = await Print.printToFileAsync({
    html: htmlPaged,
    width: Math.round(w * 2.834645),
    height: Math.round(heightMm * 2.834645),
  });
  if (!uri) throw new Error("Could not generate Driver PDF");
  return shareOrDownloadFile({
    uri,
    filename: safeName,
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle: title,
    mode: "share",
  });
}

export function encodeDriverReportEscPos(
  d: DriverSummary,
  dateISO: string,
  shopName: string,
  paperMm: number,
  drivers?: DriverRangeRef[],
): string {
  const b = new EscPosBuilder(paperMm);
  const totals = driverDetailTotals(d.pattis, drivers);
  b.init()
    .align("center")
    .bold(true)
    .size("tall")
    .line((shopName || "LEMON MANDI").toUpperCase())
    .size("normal")
    .line("DRIVER DETAILS")
    .bold(false)
    .hr()
    .align("left")
    .kv("Driver", d.driver_name);
  if (d.place) b.kv("Place", d.place);
  b.kv("Date", dateISO)
    .kv("Lots", `${d.lot_from} - ${d.lot_to}`)
    .hr()
    .line("PT LOT FARMER BG BHADA PAY RECV");
  for (const p of d.pattis) {
    const recv = isPattiReceived(p, drivers);
    const pay = rupees(p.net_payable);
    b.wrapped(`#${p.patti_no} ${lotLabel(p)} ${p.farmer_name || "—"}`);
    b.kv(
      `${p.total_bags}b  ${rupees(p.bhada_total)}${recv ? " *" : ""}`,
      recv ? `(${pay})` : pay,
    );
    b.line(`  Recv: ${receiverDisplay(p, drivers)}`);
  }
  b.hr()
    .kv("Total Bags", String(totals.total_bags))
    .kv("Total Bhada", rupees(totals.total_bhada))
    .kv("Total Payable", rupees(totals.gross_payable))
    .kv("Received", rupees(totals.received_amount))
    .bold(true)
    .size("tall")
    .kv("OUTSTANDING", rupees(totals.outstanding))
    .size("normal")
    .bold(false)
    .cut();
  return b.toBase64();
}

export function renderFarmerReportHtml(
  pattis: Patti[],
  dateISO: string,
  shopName: string,
  userName: string,
  drivers?: DriverRangeRef[],
): string {
  const totals = farmerTotals(pattis, drivers);
  const rows = pattis
    .map((p) => {
      const recv = isPattiReceived(p, drivers);
      return `<tr>
      <td class="mono">#${p.patti_no}</td>
      <td class="mono">${escHtml(lotLabel(p))}</td>
      <td>${escHtml(p.farmer_name || "—")}</td>
      <td class="mono right">${p.total_bags}</td>
      <td class="mono right">${fmtMoney(p.bhada_total)}</td>
      <td class="mono right">${fmtMoney(p.farmer_gross)}</td>
      <td class="mono right ${recv ? "strike" : "strong"}">${fmtMoney(p.net_payable)}</td>
      <td>${escHtml(receiverDisplay(p, drivers))}</td>
    </tr>`;
    })
    .join("");
  const body = `
    <table>
      <thead><tr>
        <th style="width:9%">PATTI</th>
        <th style="width:10%">LOT</th>
        <th style="width:14%">FARMER</th>
        <th class="right" style="width:8%">BAGS</th>
        <th class="right" style="width:12%">BHADA</th>
        <th class="right" style="width:14%">GROSS TOTAL</th>
        <th class="right" style="width:14%">PAYABLE</th>
        <th style="width:19%">RECEIVER</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="8" style="text-align:center;color:#6B7280;padding:14px">No pattis</td></tr>`}</tbody>
    </table>
    <div style="margin-top:10px">
      <div class="trow"><span>Total bags</span><span class="mono strong">${totals.total_bags}</span></div>
      <div class="trow"><span>Total bhada</span><span class="mono strong">${fmtMoney(totals.total_bhada)}</span></div>
      <div class="trow"><span>Total gross total</span><span class="mono strong">${fmtMoney(totals.total_gross)}</span></div>
      <div class="trow"><span>Total payable amount</span><span class="mono strong">${fmtMoney(totals.gross_payable)}</span></div>
    </div>`;
  return pdfShell(
    `${shopName.toUpperCase()} — FARMER DETAILS`,
    `Date ${escHtml(dateISO)} · ${pattis.length} patti${pattis.length === 1 ? "" : "s"}`,
    body,
    `Generated by ${userName} · ${new Date().toLocaleString("en-IN")}`,
  );
}

export function renderVendorReportHtml(
  bills: VendorBill[],
  dateISO: string,
  shopName: string,
  userName: string,
): string {
  const totals = vendorTotals(bills);
  const rows = bills
    .map(
      (b) => `<tr>
      <td class="mono">${escHtml(b.bill_code)}</td>
      <td>${escHtml(b.vendor_name)}</td>
      <td class="mono right">${b.total_bags}</td>
      <td class="mono right strong">${fmtMoney(b.grand_total)}</td>
    </tr>`,
    )
    .join("");
  const body = `
    <table>
      <thead><tr>
        <th style="width:24%">VENDOR BILL NO.</th>
        <th style="width:36%">VENDOR NAME</th>
        <th class="right" style="width:16%">TOTAL BAGS</th>
        <th class="right" style="width:24%">BILL AMOUNT</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="4" style="text-align:center;color:#6B7280;padding:14px">No vendor bills</td></tr>`}</tbody>
    </table>
    <div style="margin-top:10px">
      <div class="trow"><span>Total bags</span><span class="mono strong">${totals.total_bags}</span></div>
    </div>
    <div class="net"><div class="netl">TOTAL BILL AMOUNT</div><div class="netv">${fmtMoney(totals.bill_amount)}</div></div>`;
  return pdfShell(
    `${shopName.toUpperCase()} — VENDOR DETAILS`,
    `Date ${escHtml(dateISO)} · ${bills.length} bill${bills.length === 1 ? "" : "s"}`,
    body,
    `Generated by ${userName} · ${new Date().toLocaleString("en-IN")}`,
  );
}

export function farmerReportAoa(
  pattis: Patti[],
  dateISO: string,
  shopName: string,
  drivers?: DriverRangeRef[],
): (string | number)[][] {
  const rows: (string | number)[][] = [
    [shopName.toUpperCase(), "FARMER DETAILS"],
    ["Date", dateISO],
    [],
    ["Patti/Bill No.", "Lot No.", "Farmer Name", "Bags", "Bhada", "Gross Total", "Payable Amount", "Receiver Name"],
  ];
  for (const p of pattis) {
    rows.push([
      `#${p.patti_no}`,
      lotLabel(p),
      p.farmer_name || "",
      p.total_bags,
      p.bhada_total,
      p.farmer_gross,
      p.net_payable,
      receiverDisplay(p, drivers),
    ]);
  }
  const t = farmerTotals(pattis, drivers);
  rows.push([]);
  rows.push(["TOTAL BAGS", "", "", t.total_bags, "", "", "", ""]);
  rows.push(["TOTAL BHADA", "", "", "", t.total_bhada, "", "", ""]);
  rows.push(["TOTAL GROSS TOTAL", "", "", "", "", t.total_gross, "", ""]);
  rows.push(["TOTAL PAYABLE AMOUNT", "", "", "", "", "", t.gross_payable, ""]);
  return rows;
}

export function vendorReportAoa(bills: VendorBill[], dateISO: string, shopName: string): (string | number)[][] {
  const rows: (string | number)[][] = [
    [shopName.toUpperCase(), "VENDOR DETAILS"],
    ["Date", dateISO],
    [],
    ["Vendor Bill No.", "Vendor Name", "Total Bags", "Bill Amount"],
  ];
  for (const b of bills) {
    rows.push([b.bill_code, b.vendor_name, b.total_bags, b.grand_total]);
  }
  const t = vendorTotals(bills);
  rows.push([]);
  rows.push(["TOTAL BAGS", "", t.total_bags, ""]);
  rows.push(["TOTAL BILL AMOUNT", "", "", t.bill_amount]);
  return rows;
}

function auditWhenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "-";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function auditReportAoa(
  entries: PattiAuditLogEntry[],
  dateISO: string,
  shopName: string,
): (string | number)[][] {
  const rows: (string | number)[][] = [
    [shopName.toUpperCase(), "AUDIT LOG"],
    ["Date", dateISO],
    [],
    ["Patti No.", "Lot No.", "Bags", "Farmer", "Action", "Remark", "User", "Date/Time"],
  ];
  for (const r of entries) {
    rows.push([
      `#${r.patti_no}`,
      r.lot_no || "-",
      r.bags,
      r.farmer_name || "",
      r.action || "",
      r.remark || "",
      r.by || "",
      auditWhenLabel(r.at),
    ]);
  }
  return rows;
}

function downloadBytesWeb(bytes: Uint8Array, filename: string, mimeType: string): void {
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: mimeType,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function writeCacheFile(filename: string, base64: string): Promise<string> {
  const base = FileSystem.cacheDirectory;
  if (!base) throw new Error("No cache directory available for export");
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  const uri = `${base}${safe}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

async function shareOrDownloadFile(opts: {
  uri?: string;
  bytes?: Uint8Array;
  filename: string;
  mimeType: string;
  UTI: string;
  dialogTitle: string;
  mode: "save" | "share";
}): Promise<"shared" | "downloaded" | "printed"> {
  const { filename, mimeType, UTI, dialogTitle, mode } = opts;

  // Web: download (and Web Share when possible)
  if (Platform.OS === "web" && typeof document !== "undefined") {
    let bytes = opts.bytes;
    if (!bytes && opts.uri?.startsWith("blob:")) {
      const res = await fetch(opts.uri);
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    if (!bytes && opts.uri?.startsWith("data:")) {
      const b64 = opts.uri.split(",")[1] || "";
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
    if (!bytes) throw new Error("Could not prepare file for download");

    const nav = typeof navigator !== "undefined" ? navigator : null;
    if (
      mode === "share" &&
      nav &&
      typeof (nav as any).canShare === "function" &&
      typeof nav.share === "function"
    ) {
      try {
        const blob = new Blob(
          [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
          { type: mimeType },
        );
        const file = new File([blob], filename, { type: mimeType });
        if ((nav as any).canShare({ files: [file] })) {
          await nav.share({ files: [file], title: dialogTitle });
          return "shared";
        }
      } catch {
        /* fall through to download */
      }
    }
    downloadBytesWeb(bytes, filename, mimeType);
    return "downloaded";
  }

  // Native: write + system share sheet (Save to Files / Drive / WhatsApp / etc.)
  let uri = opts.uri;
  if (!uri && opts.bytes) {
    uri = await writeCacheFile(filename, bytesToBase64(opts.bytes));
  }
  if (!uri) throw new Error("Missing file URI");

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType, UTI, dialogTitle });
    return "shared";
  }
  await Share.share({ url: uri, title: dialogTitle });
  return "shared";
}

export async function printHtml(html: string): Promise<void> {
  if (Platform.OS === "web") {
    await printDedicatedHtmlDocument(html);
    return;
  }
  await Print.printAsync({ html, width: A4_WIDTH_PT, height: A4_HEIGHT_PT });
}

/** Save/share a real PDF from raw bytes (optional fallbacks). */
export async function exportPdfBytes(
  bytes: Uint8Array,
  filename: string,
  dialogTitle: string,
  mode: "save" | "share",
): Promise<"shared" | "downloaded" | "printed"> {
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  const name = safe.endsWith(".pdf") ? safe : `${safe}.pdf`;
  return shareOrDownloadFile({
    bytes,
    filename: name,
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle,
    mode,
  });
}

/**
 * Save / share / print an A4 PDF from dedicated report HTML only.
 * - Android/iOS: printToFileAsync(html) → real .pdf file (not jsPDF, not UI screenshot)
 * - Web Preview: iframe print of the same HTML only (expo-print web would print the whole app)
 */
export async function exportPdf(
  html: string,
  filename: string,
  dialogTitle: string,
  mode: "save" | "share",
): Promise<"shared" | "downloaded" | "printed"> {
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  const name = safe.endsWith(".pdf") ? safe : `${safe}.pdf`;

  if (Platform.OS === "web") {
    await printDedicatedHtmlDocument(html);
    return "printed";
  }

  const { uri } = await Print.printToFileAsync({
    html,
    width: A4_WIDTH_PT,
    height: A4_HEIGHT_PT,
  });
  if (!uri) throw new Error("PDF generation failed");
  return shareOrDownloadFile({
    uri,
    filename: name,
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle,
    mode,
  });
}

/** Share HTML-rendered PDF (driver reports / legacy). */
export async function sharePdf(html: string, dialogTitle: string): Promise<void> {
  await exportPdf(html, `${dialogTitle.replace(/\s+/g, "_")}.pdf`, dialogTitle, "share");
}

/** Write a real .xlsx and save/share it. */
export async function shareXlsx(
  rows: (string | number)[][],
  filename: string,
  dialogTitle: string,
  mode: "save" | "share" = "share",
): Promise<"shared" | "downloaded" | "printed"> {
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  const name = safe.endsWith(".xlsx") ? safe : `${safe}.xlsx`;
  const bytes = buildXlsxBytes(rows);
  return shareOrDownloadFile({
    bytes,
    filename: name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    UTI: "org.openxmlformats.spreadsheetml.sheet",
    dialogTitle,
    mode,
  });
}

export async function shareCsv(contents: string, filename: string, dialogTitle: string): Promise<void> {
  const base = FileSystem.cacheDirectory;
  if (!base) throw new Error("No cache directory available");
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  const uri = `${base}${safe.endsWith(".csv") ? safe : `${safe}.csv`}`;
  await FileSystem.writeAsStringAsync(uri, contents, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "text/csv",
      UTI: "public.comma-separated-values-text",
      dialogTitle,
    });
  } else if (Platform.OS !== "web") {
    await Share.share({ url: uri, title: dialogTitle });
  }
}
