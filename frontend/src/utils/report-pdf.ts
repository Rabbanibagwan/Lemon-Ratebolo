/**
 * Canvas/jsPDF helpers for thermal-share fallbacks and optional byte PDFs.
 * Farmer/Vendor Reports Save/Share/Print on device use dedicated HTML → expo-print (see reports-export).
 * Keep this module free of imports from reports-export to avoid Metro circular graphs on Android.
 */
import { jsPDF } from "jspdf/dist/jspdf.es.min.js";

import type { Patti, PattiAuditLogEntry, VendorBill } from "@/src/api";

/** WinAnsi-safe money for jsPDF built-in fonts (₹ / fancy dashes break Android PDF streams). */
function fmtMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const num = v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "Rs. " + num;
}

function pdfSafeText(s: string): string {
  return String(s || "")
    .replace(/\u20B9/g, "Rs.")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u00B7/g, "|")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function lotLabel(p: Patti): string {
  const lots = p.lots || [];
  if (!lots.length) return "-";
  if (lots.length === 1) return lots[0].lot_no || "-";
  return lots.map((l) => l.lot_no).filter(Boolean).join(", ") || "-";
}

/** Auction-day driver range (kept local to avoid circular import with reports-export). */
export type PdfDriverRange = { range_from: number; range_to: number; name: string };

function pattiLotSerial(p: Patti): number | null {
  const lots = p.lots || [];
  if (!lots.length) return null;
  const n = Number(lots[0].lot_serial_no);
  if (Number.isFinite(n)) return n;
  const m = String(lots[0].lot_no || "").match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

function receiverForPdf(p: Patti, drivers?: PdfDriverRange[]): string {
  if (p.status === "received") return (p.receiver_name || "").trim() || "-";
  if (!drivers?.length) return "-";
  const driverName = (p.driver_name || "").trim();
  if (!driverName) return "-";
  const recv = (p.receiver_name || "").trim();
  if (recv && recv.toLowerCase() !== driverName.toLowerCase()) return "-";
  const serial = pattiLotSerial(p);
  if (serial == null) return "-";
  const key = driverName.toLowerCase();
  const hit = drivers.some((d) => {
    const n = (d.name || "").trim().toLowerCase();
    return n === key && serial >= Number(d.range_from) && serial <= Number(d.range_to);
  });
  return hit ? `Driver/${driverName}` : "-";
}

type Col = { key: string; w: number; align?: "left" | "right" | "center" };

function drawTable(
  doc: jsPDF,
  startY: number,
  cols: Col[],
  rows: Record<string, string>[],
  marginX: number,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usable = pageW - marginX * 2;
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  const scale = usable / totalW;
  const widths = cols.map((c) => c.w * scale);
  const rowH = 7;
  const bottom = pageH - 18;
  let y = startY;

  const paintHeader = () => {
    doc.setFillColor(20, 20, 20);
    doc.rect(marginX, y, usable, rowH, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    let x = marginX;
    cols.forEach((c, i) => {
      const t = pdfSafeText(c.key);
      const align = c.align || "left";
      const pad = 1.5;
      if (align === "right") doc.text(t, x + widths[i] - pad, y + 4.8, { align: "right" });
      else if (align === "center") doc.text(t, x + widths[i] / 2, y + 4.8, { align: "center" });
      else doc.text(t, x + pad, y + 4.8);
      x += widths[i];
    });
    y += rowH;
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
  };

  paintHeader();

  for (let ri = 0; ri < rows.length; ri++) {
    if (y + rowH > bottom) {
      doc.addPage();
      y = 16;
      paintHeader();
    }
    if (ri % 2 === 1) {
      doc.setFillColor(245, 245, 245);
      doc.rect(marginX, y, usable, rowH, "F");
    }
    doc.setDrawColor(200, 200, 200);
    doc.line(marginX, y + rowH, marginX + usable, y + rowH);
    let x = marginX;
    cols.forEach((c, i) => {
      const raw = pdfSafeText(rows[ri][c.key] ?? "");
      const align = c.align || "left";
      const pad = 1.5;
      const maxW = widths[i] - pad * 2;
      const text = doc.splitTextToSize(String(raw), maxW)[0] || "";
      if (align === "right") doc.text(text, x + widths[i] - pad, y + 4.8, { align: "right" });
      else if (align === "center") doc.text(text, x + widths[i] / 2, y + 4.8, { align: "center" });
      else doc.text(text, x + pad, y + 4.8);
      x += widths[i];
    });
    y += rowH;
  }
  return y;
}

function headerBlock(
  doc: jsPDF,
  shopName: string,
  title: string,
  dateISO: string,
  meta: string,
): number {
  const marginX = 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(pdfSafeText(shopName.toUpperCase()), marginX, 18);
  doc.setFontSize(11);
  doc.text(pdfSafeText(title), marginX, 26);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(pdfSafeText(`Date ${dateISO}  |  ${meta}`), marginX, 32);
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.line(marginX, 35, doc.internal.pageSize.getWidth() - marginX, 35);
  return 40;
}

function totalsBlock(
  doc: jsPDF,
  y: number,
  lines: { label: string; value: string; emph?: boolean }[],
): void {
  const marginX = 14;
  const pageW = doc.internal.pageSize.getWidth();
  let yy = y + 6;
  for (const line of lines) {
    if (yy > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      yy = 16;
    }
    if (line.emph) {
      doc.setFillColor(20, 20, 20);
      doc.rect(marginX, yy, pageW - marginX * 2, 10, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(pdfSafeText(line.label), marginX + 3, yy + 6.5);
      doc.text(pdfSafeText(line.value), pageW - marginX - 3, yy + 6.5, { align: "right" });
      doc.setTextColor(0, 0, 0);
      yy += 12;
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(90, 90, 90);
      doc.text(pdfSafeText(line.label), marginX, yy + 4);
      doc.setTextColor(0, 0, 0);
      doc.setFont("courier", "bold");
      doc.text(pdfSafeText(line.value), pageW - marginX, yy + 4, { align: "right" });
      yy += 7;
    }
  }
}

function pdfToBytes(doc: jsPDF): Uint8Array {
  const ab = doc.output("arraybuffer") as ArrayBuffer;
  return new Uint8Array(ab);
}

/**
 * Real A4 PDF bytes for Farmer Details (jsPDF — selectable text, multi-page).
 * Not a screenshot / not HTML print capture.
 */
export function buildFarmerDetailsPdfBytes(
  pattis: Patti[],
  dateISO: string,
  shopName: string,
  userName: string,
  drivers?: PdfDriverRange[],
): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const marginX = 14;
  let y = headerBlock(
    doc,
    shopName || "LEMON MANDI",
    "FARMER DETAILS",
    dateISO,
    `${pattis.length} patti${pattis.length === 1 ? "" : "s"}`,
  );

  const cols: Col[] = [
    { key: "Patti", w: 12 },
    { key: "Lot No.", w: 18 },
    { key: "Farmer", w: 24 },
    { key: "Bags", w: 10, align: "right" },
    { key: "Bhada", w: 16, align: "right" },
    { key: "Gross Total", w: 18, align: "right" },
    { key: "Payable", w: 18, align: "right" },
    { key: "Receiver", w: 20 },
  ];

  let totalBags = 0;
  let totalBhada = 0;
  let totalGross = 0;
  let totalPayable = 0;
  const rows = pattis.map((p) => {
    totalBags += p.total_bags || 0;
    totalBhada += p.bhada_total || 0;
    totalGross += p.farmer_gross || 0;
    totalPayable += p.net_payable || 0;
    return {
      Patti: `#${p.patti_no}`,
      "Lot No.": lotLabel(p),
      Farmer: p.farmer_name || "",
      Bags: String(p.total_bags ?? 0),
      Bhada: fmtMoney(p.bhada_total || 0),
      "Gross Total": fmtMoney(p.farmer_gross || 0),
      Payable: fmtMoney(p.net_payable || 0),
      Receiver: receiverForPdf(p, drivers),
    };
  });

  y = drawTable(doc, y, cols, rows, marginX);
  totalsBlock(doc, y, [
    { label: "TOTAL BAGS", value: String(totalBags) },
    { label: "TOTAL BHADA", value: fmtMoney(totalBhada) },
    { label: "TOTAL GROSS TOTAL", value: fmtMoney(totalGross) },
    { label: "TOTAL PAYABLE AMOUNT", value: fmtMoney(totalPayable), emph: true },
  ]);

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(
      pdfSafeText(
        `Generated by ${userName || "user"} | ${new Date().toLocaleString("en-IN")} | Page ${i}/${pageCount}`,
      ),
      marginX,
      pageH - 8,
    );
  }

  return pdfToBytes(doc);
}

/**
 * Real A4 PDF bytes for Vendor Details (jsPDF — selectable text, multi-page).
 * Not a screenshot / not HTML print capture.
 */
export function buildVendorDetailsPdfBytes(
  bills: VendorBill[],
  dateISO: string,
  shopName: string,
  userName: string,
): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const marginX = 14;
  let y = headerBlock(
    doc,
    shopName || "LEMON MANDI",
    "VENDOR DETAILS",
    dateISO,
    `${bills.length} bill${bills.length === 1 ? "" : "s"}`,
  );

  const cols: Col[] = [
    { key: "Bill No.", w: 28 },
    { key: "Vendor", w: 50 },
    { key: "Bags", w: 18, align: "right" },
    { key: "Bill Amount", w: 28, align: "right" },
  ];

  let totalBags = 0;
  let billAmount = 0;
  const rows = bills.map((b) => {
    totalBags += b.total_bags || 0;
    billAmount += b.grand_total || 0;
    return {
      "Bill No.": b.bill_code || "",
      Vendor: b.vendor_name || "",
      Bags: String(b.total_bags ?? 0),
      "Bill Amount": fmtMoney(b.grand_total || 0),
    };
  });

  y = drawTable(doc, y, cols, rows, marginX);
  totalsBlock(doc, y, [
    { label: "TOTAL BAGS", value: String(totalBags) },
    { label: "TOTAL BILL AMOUNT", value: fmtMoney(billAmount), emph: true },
  ]);

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(
      pdfSafeText(
        `Generated by ${userName || "user"} | ${new Date().toLocaleString("en-IN")} | Page ${i}/${pageCount}`,
      ),
      marginX,
      pageH - 8,
    );
  }

  return pdfToBytes(doc);
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

/**
 * Real A4 PDF bytes for Audit Log (jsPDF — selectable text, multi-page).
 * Not a screenshot / not HTML print capture.
 */
export function buildAuditLogPdfBytes(
  rows: PattiAuditLogEntry[],
  dateISO: string,
  shopName: string,
  userName: string,
): Uint8Array {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const marginX = 12;
  let y = headerBlock(
    doc,
    shopName || "LEMON MANDI",
    "AUDIT LOG",
    dateISO,
    `${rows.length} record${rows.length === 1 ? "" : "s"}`,
  );

  const cols: Col[] = [
    { key: "Patti No.", w: 18 },
    { key: "Lot No.", w: 22 },
    { key: "Bags", w: 14, align: "right" },
    { key: "Farmer", w: 36 },
    { key: "Action", w: 24 },
    { key: "Remark", w: 42 },
    { key: "User", w: 28 },
    { key: "Date/Time", w: 36 },
  ];

  const tableRows = rows.map((r) => ({
    "Patti No.": `#${r.patti_no}`,
    "Lot No.": r.lot_no || "-",
    Bags: String(r.bags ?? 0),
    Farmer: r.farmer_name || "",
    Action: r.action || "",
    Remark: r.remark || "-",
    User: r.by || "",
    "Date/Time": auditWhenLabel(r.at),
  }));

  y = drawTable(doc, y, cols, tableRows, marginX);

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(
      pdfSafeText(
        `Generated by ${userName || "user"} | ${new Date().toLocaleString("en-IN")} | Page ${i}/${pageCount}`,
      ),
      marginX,
      pageH - 8,
    );
  }

  return pdfToBytes(doc);
}

/** Narrow thermal-width PDF (driver share on web) — same 5-col layout as Print HTML. */
export function buildDriverThermalPdfBytes(
  d: {
    driver_name: string;
    place: string | null;
    lot_from: string;
    lot_to: string;
    pattis: Patti[];
  },
  dateISO: string,
  shopName: string,
  paperMm: number = 80,
): Uint8Array {
  const pageW = paperMm <= 58 ? 58 : paperMm <= 80 ? 80 : 100;
  const compact = paperMm <= 58;
  // Tall page so many compact rows fit; add pages if needed.
  const pageH = 400;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [pageW, pageH] });
  const marginX = 1.5;
  const usable = pageW - marginX * 2;
  let y = 4.5;
  let tableStarted = false;

  // Match HTML colgroup shares: PT / LOT / FARMER / NET PAY / RECV
  const gap = 0.6;
  const shares = [0.11, 0.13, 0.28, 0.23, 0.25];
  const widths = shares.map((s) => s * (usable - gap * 4));
  const colX: number[] = [];
  {
    let x = marginX;
    for (let i = 0; i < widths.length; i++) {
      colX.push(x);
      x += widths[i] + gap;
    }
  }

  const headFs = compact ? 6 : 6.5;
  const cellFs = compact ? 6.5 : 7;
  const payFs = compact ? 7.5 : 8;
  const lineH = compact ? 2.8 : 3.0;

  const fitText = (raw: string, maxW: number, size: number, style: "normal" | "bold" = "normal") => {
    doc.setFont("times", style);
    doc.setFontSize(size);
    let t = pdfSafeText(raw);
    if (doc.getTextWidth(t) <= maxW) return t;
    while (t.length > 1 && doc.getTextWidth(t + ".") > maxW) t = t.slice(0, -1);
    return t.length ? `${t}.` : "";
  };

  const wrapText = (raw: string, maxW: number, size: number, maxLines: number) => {
    doc.setFont("times", "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(pdfSafeText(raw), maxW) as string[];
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1] || "";
    while (last.length > 1 && doc.getTextWidth(last + ".") > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = last ? `${last}.` : ".";
    return kept;
  };

  const paintHeader = () => {
    doc.setFont("times", "bold");
    doc.setFontSize(headFs);
    const heads = ["PATTI", "LOT", "FARMER", "NET PAY", "RECV"];
    heads.forEach((h, i) => {
      const w = widths[i];
      const x = colX[i];
      if (i === 3) doc.text(fitText(h, w, headFs, "bold"), x + w, y, { align: "right" });
      else doc.text(fitText(h, w, headFs, "bold"), x, y);
    });
    y += 1.4;
    doc.setLineWidth(0.3);
    doc.line(marginX, y, pageW - marginX, y);
    y += 2.0;
  };

  const ensureSpace = (need: number) => {
    if (y + need <= pageH - 6) return;
    doc.addPage([pageW, pageH]);
    y = 6;
    if (tableStarted) paintHeader();
  };

  doc.setFont("times", "bold");
  doc.setFontSize(compact ? 10 : 11);
  doc.text(pdfSafeText((shopName || "LEMON MANDI").toUpperCase()), pageW / 2, y, { align: "center" });
  y += 3.8;
  doc.setFontSize(compact ? 8 : 8.5);
  doc.text("DRIVER DETAILS", pageW / 2, y, { align: "center" });
  y += 2.2;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.25);
  doc.line(marginX, y, pageW - marginX, y);
  y += 3.2;

  const kv = (k: string, v: string, opts?: { boldValue?: boolean; size?: number }) => {
    ensureSpace(5);
    const size = opts?.size || (compact ? 7.5 : 8);
    doc.setFontSize(size);
    doc.setFont("times", "bold");
    doc.text(pdfSafeText(k), marginX, y);
    doc.setFont("times", opts?.boldValue ? "bold" : "normal");
    const lines = wrapText(v, usable * 0.55, size, 2);
    doc.text(lines[0] || "", pageW - marginX, y, { align: "right" });
    y += 3.2;
    for (let i = 1; i < lines.length; i++) {
      ensureSpace(4);
      doc.text(lines[i], pageW - marginX, y, { align: "right" });
      y += 3;
    }
  };

  kv("Driver", d.driver_name || "", { boldValue: true, size: compact ? 9 : 10 });
  if (d.place) kv("Place", d.place);
  kv("Date", dateISO);
  kv("Lots", `${d.lot_from} - ${d.lot_to}`);
  doc.line(marginX, y, pageW - marginX, y);
  y += 2.8;

  tableStarted = true;
  ensureSpace(lineH + 2);
  paintHeader();

  let totalBags = 0;
  let totalBhada = 0;
  let gross = 0;
  let driverReceived = 0;
  const driverKey = (d.driver_name || "").trim().toLowerCase();

  for (const p of d.pattis || []) {
    const bags = p.total_bags || 0;
    const bhada = p.bhada_total || 0;
    const pay = p.net_payable || 0;
    totalBags += bags;
    totalBhada += bhada;
    gross += pay;
    const recvName = (p.receiver_name || "").trim();
    if (recvName && driverKey && recvName.toLowerCase() === driverKey) driverReceived += pay;
    const lots = (p.lots || []).map((l) => l.lot_no).filter(Boolean).join(", ") || "-";

    const farmLines = wrapText(p.farmer_name || "-", widths[2], cellFs, 2);
    const recvLines = wrapText(recvName || "-", widths[4], cellFs, 2);
    const rowLines = Math.max(1, farmLines.length, recvLines.length);
    const rowH = rowLines * lineH + 0.4;
    ensureSpace(rowH + 0.5);

    doc.setFont("times", "bold");
    doc.setFontSize(cellFs);
    doc.text(fitText(`#${p.patti_no}`, widths[0], cellFs, "bold"), colX[0], y);
    doc.setFont("times", "normal");
    doc.text(fitText(lots, widths[1], cellFs), colX[1], y);

    doc.setFont("times", "bold");
    doc.setFontSize(payFs);
    doc.text(fitText(fmtMoney(pay), widths[3], payFs, "bold"), colX[3] + widths[3], y, { align: "right" });

    doc.setFont("times", "normal");
    doc.setFontSize(cellFs);
    for (let li = 0; li < rowLines; li++) {
      const yy = y + li * lineH;
      if (farmLines[li]) doc.text(farmLines[li], colX[2], yy);
      if (recvLines[li]) doc.text(recvLines[li], colX[4], yy);
    }

    y += rowH;
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.15);
    doc.line(marginX, y - 0.3, pageW - marginX, y - 0.3);
    doc.setDrawColor(0, 0, 0);
  }

  y += 1.2;
  doc.setLineWidth(0.3);
  doc.line(marginX, y, pageW - marginX, y);
  y += 3.2;
  tableStarted = false;
  kv("TOTAL BAGS", String(totalBags), { boldValue: true });
  kv("TOTAL BHADA", fmtMoney(totalBhada), { boldValue: true });
  kv("TOTAL NET PAYABLE", fmtMoney(gross), { boldValue: true, size: compact ? 8.5 : 9 });
  kv("TOTAL NET PAYABLE RECEIVED BY DRIVER", fmtMoney(driverReceived), {
    boldValue: true,
    size: compact ? 8.5 : 9,
  });

  return pdfToBytes(doc);
}
