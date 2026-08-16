/**
 * Build a real A4 PDF (bytes) for Farmer / Vendor detail reports.
 * Used so Save/Share always produce an actual .pdf file (web + native).
 */
import { jsPDF } from "jspdf/dist/jspdf.es.min.js";

import type { Patti, VendorBill } from "@/src/api";

function fmtMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isReceived(p: Patti): boolean {
  return p.status === "received";
}

function receiverDisplay(p: Patti): string {
  if (!isReceived(p)) return "—";
  return (p.receiver_name || "").trim() || "—";
}

function lotLabel(p: Patti): string {
  const lots = p.lots || [];
  if (!lots.length) return "—";
  if (lots.length === 1) return lots[0].lot_no || "—";
  return lots.map((l) => l.lot_no).filter(Boolean).join(", ") || "—";
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
  let y = startY;

  const ensureSpace = (need: number) => {
    if (y + need > pageH - 16) {
      doc.addPage();
      y = 16;
    }
  };

  const paintHeader = () => {
    ensureSpace(rowH + 2);
    doc.setFillColor(20, 20, 20);
    doc.rect(marginX, y, usable, rowH, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    let x = marginX;
    cols.forEach((c, i) => {
      const t = c.key;
      const align = c.align || "left";
      const pad = 1.5;
      if (align === "right") doc.text(t, x + widths[i] - pad, y + 4.8, { align: "right" });
      else if (align === "center") doc.text(t, x + widths[i] / 2, y + 4.8, { align: "center" });
      else doc.text(t, x + pad, y + 4.8);
      x += widths[i];
    });
    y += rowH;
    doc.setTextColor(0, 0, 0);
  };

  paintHeader();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (let ri = 0; ri < rows.length; ri++) {
    ensureSpace(rowH);
    if (ri % 2 === 1) {
      doc.setFillColor(245, 245, 245);
      doc.rect(marginX, y, usable, rowH, "F");
    }
    doc.setDrawColor(200, 200, 200);
    doc.line(marginX, y + rowH, marginX + usable, y + rowH);
    let x = marginX;
    cols.forEach((c, i) => {
      const raw = rows[ri][c.key] ?? "";
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
  doc.text(shopName.toUpperCase(), marginX, 18);
  doc.setFontSize(11);
  doc.text(title, marginX, 26);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(`Date ${dateISO}  ·  ${meta}`, marginX, 32);
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
      doc.text(line.label, marginX + 3, yy + 6.5);
      doc.text(line.value, pageW - marginX - 3, yy + 6.5, { align: "right" });
      doc.setTextColor(0, 0, 0);
      yy += 12;
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(90, 90, 90);
      doc.text(line.label, marginX, yy + 4);
      doc.setTextColor(0, 0, 0);
      doc.setFont("courier", "bold");
      doc.text(line.value, pageW - marginX, yy + 4, { align: "right" });
      yy += 7;
    }
  }
}

function pdfToBytes(doc: jsPDF): Uint8Array {
  const ab = doc.output("arraybuffer") as ArrayBuffer;
  return new Uint8Array(ab);
}

export function buildFarmerDetailsPdfBytes(
  pattis: Patti[],
  dateISO: string,
  shopName: string,
  userName: string,
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
    { key: "Patti", w: 14 },
    { key: "Lot No.", w: 22 },
    { key: "Farmer", w: 28 },
    { key: "Bags", w: 12, align: "right" },
    { key: "Bhada", w: 18, align: "right" },
    { key: "Payable", w: 20, align: "right" },
    { key: "Receiver", w: 22 },
    { key: "Status", w: 16, align: "center" },
  ];

  let totalBags = 0;
  let totalBhada = 0;
  let totalPayable = 0;
  const rows = pattis.map((p) => {
    totalBags += p.total_bags || 0;
    totalBhada += p.bhada_total || 0;
    totalPayable += p.net_payable || 0;
    return {
      Patti: `#${p.patti_no}`,
      "Lot No.": lotLabel(p),
      Farmer: p.farmer_name || "",
      Bags: String(p.total_bags ?? 0),
      Bhada: fmtMoney(p.bhada_total || 0),
      Payable: fmtMoney(p.net_payable || 0),
      Receiver: receiverDisplay(p),
      Status: isReceived(p) ? "received" : "pending",
    };
  });

  y = drawTable(doc, y, cols, rows, marginX);
  totalsBlock(doc, y, [
    { label: "TOTAL BAGS", value: String(totalBags) },
    { label: "TOTAL BHADA", value: fmtMoney(totalBhada) },
    { label: "TOTAL PAYABLE", value: fmtMoney(totalPayable), emph: true },
  ]);

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(
    `Generated by ${userName || "user"} · ${new Date().toLocaleString("en-IN")}`,
    marginX,
    pageH - 8,
  );

  return pdfToBytes(doc);
}

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

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(
    `Generated by ${userName || "user"} · ${new Date().toLocaleString("en-IN")}`,
    marginX,
    pageH - 8,
  );

  return pdfToBytes(doc);
}

/** Thermal-width Driver Details PDF — same columns/content as the printed driver slip. */
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
  doc.text((shopName || "LEMON MANDI").toUpperCase(), pageW / 2, y, { align: "center" });
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
    doc.text(k, marginX, y);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(v, pageW - marginX * 2 - 22);
    doc.text(lines[0] || "", pageW - marginX, y, { align: "right" });
    y += 4;
  };
  kv("Driver", d.driver_name || "");
  if (d.place) kv("Place", d.place);
  kv("Date", dateISO);
  kv("Lots", `${d.lot_from} – ${d.lot_to}`);
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
    const lots = (p.lots || []).map((l) => l.lot_no).filter(Boolean).join(", ") || "—";
    return {
      PT: String(p.patti_no),
      LOT: lots,
      FARMER: p.farmer_name || "—",
      BG: String(bags),
      BHADA: fmtMoney(bhada),
      PAY: fmtMoney(pay),
      RECV: recv ? ((p.receiver_name || "").trim() || "—") : "—",
    };
  });

  // Compact header + rows for narrow paper
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
      const raw = row[c.key as keyof typeof row] ?? "";
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
