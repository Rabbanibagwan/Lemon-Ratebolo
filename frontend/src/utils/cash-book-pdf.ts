/**
 * Cash Book A4 PDF — Save / Share.
 * Uses the same day snapshot passed from the Cash Book screen (no duplicate data source).
 * Web: jsPDF bytes → real .pdf download / Web Share.
 * Native: HTML + expo-print → .pdf file → share / Save to Files.
 */

import { Platform } from "react-native";
import { jsPDF } from "jspdf/dist/jspdf.es.min.js";

import { exportPdf, exportPdfBytes, fmtMoney, escHtml } from "@/src/utils/reports-export";
import type { CashBookDay, CashBookEntry } from "@/src/utils/cash-book-store";

/** e.g. 2026-09-18 → 18-Sep-2026 */
export function cashBookPdfFileStamp(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((isoDate || "").trim());
  if (!m) return (isoDate || "date").replace(/[^\w.\-]+/g, "_");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])}-${months[Number(m[2]) - 1]}-${m[1]}`;
}

export function cashBookPdfFilename(isoDate: string): string {
  return `CashBook_${cashBookPdfFileStamp(isoDate)}.pdf`;
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

/** WinAnsi-safe money for jsPDF built-in fonts (same approach as other reports). */
function fmtMoneyPdf(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return "Rs. " + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sideTableHtml(title: string, rows: CashBookEntry[]): string {
  const body = rows.length
    ? rows
        .map(
          (r) => `<tr>
      <td class="mono right">${escHtml(fmtMoney(r.amount))}</td>
      <td>${escHtml(r.description)}</td>
    </tr>`,
        )
        .join("")
    : `<tr><td colspan="2" class="empty">No ${title.toLowerCase()} on this date</td></tr>`;
  return `
  <div class="col">
    <div class="col-title">${escHtml(title)}</div>
    <table>
      <thead><tr><th class="right" style="width:38%">Amount</th><th>Description</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

/** A4 HTML with ₹ — used on native via expo-print. */
export function renderCashBookPdfHtml(
  day: CashBookDay,
  displayDate: string,
  shopName?: string,
): string {
  const shop = (shopName || "LEMON MANDI").trim() || "LEMON MANDI";
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Cash Book — ${escHtml(displayDate)}</title>
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
    h1 { margin: 0 0 2px; font-size: 18px; font-weight: 900; letter-spacing: -0.3px; }
    .shop { font-size: 11px; font-weight: 800; letter-spacing: 0.6px; color: #374151; margin-bottom: 2px; }
    .sub { color: #374151; font-size: 12px; margin-bottom: 12px; font-weight: 700; }
    .grid { display: flex; gap: 12px; align-items: flex-start; }
    .col { flex: 1; min-width: 0; border: 2px solid #111827; padding: 8px; }
    .col-title {
      text-align: center; font-size: 12px; font-weight: 900; letter-spacing: 1.2px;
      margin-bottom: 6px; text-transform: uppercase;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead th {
      text-align: left; font-size: 8px; letter-spacing: 0.8px; color: #6B7280;
      padding: 5px 3px; border-bottom: 2px solid #111827; text-transform: uppercase; font-weight: 800;
    }
    thead th.right, td.right { text-align: right; }
    tbody td {
      padding: 5px 3px; border-bottom: 1px dashed #D1D5DB; font-size: 10.5px;
      vertical-align: top; word-break: break-word;
      page-break-inside: avoid;
    }
    .empty { color: #6B7280; font-style: italic; text-align: center; }
    .mono { font-family: "Courier New", Consolas, monospace; font-weight: 700; }
    .totals {
      margin-top: 12px; border: 2px solid #111827; padding: 10px 12px;
      page-break-inside: avoid;
    }
    .trow { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; }
    .trow .label { font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: #6B7280; }
    .trow .val { font-family: "Courier New", Consolas, monospace; font-weight: 800; }
    .net {
      margin-top: 8px; padding-top: 8px; border-top: 2px solid #111827;
      display: flex; justify-content: space-between; align-items: center;
    }
    .net .label { font-weight: 900; letter-spacing: 1px; text-transform: uppercase; }
    .net .val { font-family: "Courier New", Consolas, monospace; font-weight: 900; font-size: 15px; }
    .foot { margin-top: 14px; font-size: 9px; color: #6B7280; text-align: center; }
  </style></head><body>
  <div class="shop">${escHtml(shop.toUpperCase())}</div>
  <h1>CASH BOOK</h1>
  <div class="sub">Selected Date: ${escHtml(displayDate)}</div>
  <div class="grid">
    ${sideTableHtml("CREDIT", day.credits)}
    ${sideTableHtml("DEBIT", day.debits)}
  </div>
  <div class="totals">
    <div class="trow"><span class="label">Total Credit</span><span class="val">${escHtml(fmtMoney(day.totalCredit))}</span></div>
    <div class="trow"><span class="label">Total Debit</span><span class="val">${escHtml(fmtMoney(day.totalDebit))}</span></div>
    <div class="net">
      <span class="label">Net / Closing Balance</span>
      <span class="val">${escHtml(fmtMoney(day.net))}</span>
    </div>
  </div>
  <div class="foot">Cash Book · ${escHtml(displayDate)} · amounts in Indian Rupees (₹)</div>
  </body></html>`;
}

/**
 * Real A4 PDF bytes (jsPDF) for web Save/Share — selectable text, multi-page.
 * Amounts use Rs. prefix so built-in PDF fonts stay valid on all platforms.
 */
export function buildCashBookPdfBytes(
  day: CashBookDay,
  displayDate: string,
  shopName?: string,
): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const usable = pageW - marginX * 2;
  const gap = 4;
  const colW = (usable - gap) / 2;
  const leftX = marginX;
  const rightX = marginX + colW + gap;
  const bottom = pageH - 18;
  const rowH = 7;
  const shop = (shopName || "LEMON MANDI").trim() || "LEMON MANDI";

  let y = 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(pdfSafeText(shop.toUpperCase()), marginX, y);
  y += 7;
  doc.setFontSize(16);
  doc.text("CASH BOOK", marginX, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text(pdfSafeText(`Selected Date: ${displayDate}`), marginX, y);
  doc.setTextColor(0, 0, 0);
  y += 5;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageW - marginX, y);
  y += 6;

  const paintColHeader = (x: number, title: string) => {
    doc.setFillColor(20, 20, 20);
    doc.rect(x, y, colW, rowH, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(title, x + colW / 2, y + 4.8, { align: "center" });
    doc.setTextColor(0, 0, 0);
  };

  const paintSubHeader = (x: number, yy: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text("AMOUNT", x + colW * 0.38 - 1.5, yy + 4, { align: "right" });
    doc.text("DESCRIPTION", x + colW * 0.42, yy + 4);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.line(x, yy + rowH - 0.5, x + colW, yy + rowH - 0.5);
  };

  paintColHeader(leftX, "CREDIT");
  paintColHeader(rightX, "DEBIT");
  y += rowH;
  paintSubHeader(leftX, y);
  paintSubHeader(rightX, y);
  y += rowH;

  const maxRows = Math.max(day.credits.length, day.debits.length, 1);

  const drawEntry = (x: number, yy: number, entry: CashBookEntry | null, emptyLabel: string, zebra: boolean) => {
    if (zebra) {
      doc.setFillColor(245, 245, 245);
      doc.rect(x, yy, colW, rowH, "F");
    }
    doc.setDrawColor(210, 210, 210);
    doc.line(x, yy + rowH, x + colW, yy + rowH);
    doc.setFont("courier", "bold");
    doc.setFontSize(8);
    if (entry) {
      doc.text(pdfSafeText(fmtMoneyPdf(entry.amount)), x + colW * 0.38 - 1.5, yy + 4.8, { align: "right" });
      doc.setFont("helvetica", "normal");
      const desc = doc.splitTextToSize(pdfSafeText(entry.description), colW * 0.55)[0] || "";
      doc.text(desc, x + colW * 0.42, yy + 4.8);
    } else {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(emptyLabel, x + colW / 2, yy + 4.8, { align: "center" });
      doc.setTextColor(0, 0, 0);
    }
  };

  for (let i = 0; i < maxRows; i++) {
    if (y + rowH > bottom - 28) {
      doc.addPage();
      y = 16;
      paintColHeader(leftX, "CREDIT (cont.)");
      paintColHeader(rightX, "DEBIT (cont.)");
      y += rowH;
      paintSubHeader(leftX, y);
      paintSubHeader(rightX, y);
      y += rowH;
    }
    const credit = day.credits[i] || null;
    const debit = day.debits[i] || null;
    const showEmptyCredit = i === 0 && day.credits.length === 0;
    const showEmptyDebit = i === 0 && day.debits.length === 0;
    drawEntry(leftX, y, credit, showEmptyCredit ? "No credit on this date" : "", i % 2 === 1);
    drawEntry(rightX, y, debit, showEmptyDebit ? "No debit on this date" : "", i % 2 === 1);
    y += rowH;
  }

  if (y + 28 > bottom) {
    doc.addPage();
    y = 16;
  }
  y += 4;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.rect(marginX, y, usable, 28);
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text("TOTAL CREDIT", marginX + 3, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont("courier", "bold");
  doc.text(pdfSafeText(fmtMoneyPdf(day.totalCredit)), pageW - marginX - 3, y, { align: "right" });
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(90, 90, 90);
  doc.text("TOTAL DEBIT", marginX + 3, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont("courier", "bold");
  doc.text(pdfSafeText(fmtMoneyPdf(day.totalDebit)), pageW - marginX - 3, y, { align: "right" });
  y += 4;
  doc.setFillColor(20, 20, 20);
  doc.rect(marginX, y, usable, 10, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("NET / CLOSING BALANCE", marginX + 3, y + 6.5);
  doc.setFont("courier", "bold");
  doc.text(pdfSafeText(fmtMoneyPdf(day.net)), pageW - marginX - 3, y + 6.5, { align: "right" });
  doc.setTextColor(0, 0, 0);

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(
      pdfSafeText(`Cash Book | ${displayDate} | INR (Rs.) | Page ${i}/${pageCount}`),
      marginX,
      pageH - 8,
    );
  }

  const ab = doc.output("arraybuffer") as ArrayBuffer;
  return new Uint8Array(ab);
}

export async function exportCashBookPdf(
  day: CashBookDay,
  displayDate: string,
  mode: "save" | "share",
  shopName?: string,
): Promise<"shared" | "downloaded" | "printed"> {
  const filename = cashBookPdfFilename(day.date);
  const title = `Cash Book ${displayDate}`;

  // Web Preview (incl. iPhone Safari via tunnel): real PDF bytes so Save downloads
  // and Share can use the Web Share API with a .pdf file (not a screenshot).
  if (Platform.OS === "web") {
    const bytes = buildCashBookPdfBytes(day, displayDate, shopName);
    return exportPdfBytes(bytes, filename, title, mode);
  }

  // Native: HTML with ₹ → expo-print A4 PDF → system share / Save to Files.
  const html = renderCashBookPdfHtml(day, displayDate, shopName);
  return exportPdf(html, filename, title, mode);
}
