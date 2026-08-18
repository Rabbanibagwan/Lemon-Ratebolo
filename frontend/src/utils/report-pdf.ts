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
    { key: "Farmer Name", w: 40 },
    { key: "Driver Name", w: 32 },
    { key: "Action", w: 24 },
    { key: "Date/Time", w: 38 },
    { key: "By", w: 28 },
  ];

  const tableRows = rows.map((r) => ({
    "Patti No.": `#${r.patti_no}`,
    "Lot No.": r.lot_no || "-",
    Bags: String(r.bags ?? 0),
    "Farmer Name": r.farmer_name || "",
    "Driver Name": r.driver_name || "-",
    Action: r.action || "",
    "Date/Time": auditWhenLabel(r.at),
    By: r.by || "",
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

/** Narrow thermal-width PDF (driver share on web). */
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
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [pageW, 200] });
  const marginX = 3;
  let y = 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(pdfSafeText((shopName || "LEMON MANDI").toUpperCase()), pageW / 2, y, { align: "center" });
  y += 5;
  doc.setFontSize(9);
  doc.text("DRIVER DETAILS", pageW / 2, y, { align: "center" });
  y += 3;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(marginX, y, pageW - marginX, y);
  y += 5;

  doc.setFontSize(8);
  const kv = (k: string, v: string) => {
    doc.setFont("helvetica", "bold");
    doc.text(pdfSafeText(k), marginX, y);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(pdfSafeText(v), pageW - marginX * 2 - 22);
    doc.text(lines[0] || "", pageW - marginX, y, { align: "right" });
    y += 4;
  };
  kv("Driver", d.driver_name || "");
  if (d.place) kv("Place", d.place);
  kv("Date", dateISO);
  kv("Lots", `${d.lot_from} - ${d.lot_to}`);
  doc.line(marginX, y, pageW - marginX, y);
  y += 4;

  const cols: Col[] = [
    { key: "PT", w: 8 },
    { key: "LOT", w: 12 },
    { key: "FARMER", w: 16 },
    { key: "BG", w: 8, align: "right" },
    { key: "BHADA", w: 14, align: "right" },
    { key: "PAY", w: 14, align: "right" },
    { key: "RECV", w: 14 },
  ];

  let totalBags = 0;
  let totalBhada = 0;
  let gross = 0;
  let received = 0;
  const rows = (d.pattis || []).map((p) => {
    const bags = p.total_bags || 0;
    const bhada = p.bhada_total || 0;
    const pay = p.net_payable || 0;
    const recv = p.status === "received";
    totalBags += bags;
    totalBhada += bhada;
    gross += pay;
    if (recv) received += pay;
    const lots = (p.lots || []).map((l) => l.lot_no).filter(Boolean).join(", ") || "-";
    return {
      PT: String(p.patti_no),
      LOT: lots,
      FARMER: p.farmer_name || "-",
      BG: String(bags),
      BHADA: fmtMoney(bhada),
      PAY: fmtMoney(pay),
      RECV: recv ? (p.receiver_name || "").trim() || "-" : "-",
    };
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  const usable = pageW - marginX * 2;
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  const widths = cols.map((c) => (c.w / totalW) * usable);
  let x = marginX;
  cols.forEach((c, i) => {
    doc.text(c.key, c.align === "right" ? x + widths[i] : x, y, {
      align: c.align === "right" ? "right" : "left",
    });
    x += widths[i];
  });
  y += 3;
  doc.line(marginX, y, pageW - marginX, y);
  y += 3;
  doc.setFont("helvetica", "normal");
  for (const row of rows) {
    if (y > 190) {
      doc.addPage([pageW, 200]);
      y = 8;
    }
    x = marginX;
    cols.forEach((c, i) => {
      const raw = pdfSafeText(row[c.key as keyof typeof row] ?? "");
      const text = doc.splitTextToSize(String(raw), widths[i] - 0.5)[0] || "";
      if (c.align === "right") doc.text(text, x + widths[i], y, { align: "right" });
      else doc.text(text, x, y);
      x += widths[i];
    });
    y += 4;
  }

  y += 2;
  doc.line(marginX, y, pageW - marginX, y);
  y += 5;
  kv("Total Bags", String(totalBags));
  kv("Total Bhada", fmtMoney(totalBhada));
  kv("Total Payable", fmtMoney(gross));
  kv("Received", fmtMoney(received));
  doc.setFillColor(20, 20, 20);
  doc.rect(marginX, y, usable, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("OUTSTANDING", marginX + 1.5, y + 5.2);
  doc.text(fmtMoney(gross - received), pageW - marginX - 1.5, y + 5.2, { align: "right" });

  return pdfToBytes(doc);
}
