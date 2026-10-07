/**
 * Reports Driver/Vendor Details — Bluetooth thermal ESC/POS encoders.
 * Kept free of react-native / api imports so Node verify scripts can run offline.
 */
import { EscPosBuilder, rupees } from "@/src/utils/escpos";

/** Minimal driver row for the summary print (Driver Name | From | To | Bags | Bhada). */
export type DriverDetailsPrintRow = {
  driver_name: string;
  lot_from: string;
  lot_to: string;
  total_bags: number;
  total_bhada: number;
};

/** Minimal vendor bill row for the summary print. */
export type VendorDetailsPrintRow = {
  bill_code: string;
  vendor_name: string;
  total_bags: number;
  grand_total: number;
};

function thermalAscii(s: string): string {
  return String(s || "")
    .replace(/₹/g, "Rs ")
    .replace(/×/g, "x")
    .replace(/·/g, " - ")
    .replace(/…/g, "...")
    .replace(/—/g, "-")
    .replace(/–/g, "-");
}

function clipPad(s: string, n: number, align: "left" | "right" = "left"): string {
  const t = thermalAscii(s);
  if (t.length > n) return t.slice(0, Math.max(0, n - 1)) + (n > 0 ? "." : "");
  return align === "right" ? t.padStart(n, " ") : t.padEnd(n, " ");
}

function driverSummaryColWidths(cols: number): {
  wName: number;
  wFrom: number;
  wTo: number;
  wBags: number;
  wBhada: number;
} {
  const wFrom = cols <= 32 ? 4 : cols <= 48 ? 5 : 6;
  const wTo = wFrom;
  const wBags = cols <= 32 ? 4 : cols <= 48 ? 5 : 6;
  const wBhada = cols <= 32 ? 8 : cols <= 48 ? 11 : 14;
  const wName = Math.max(6, cols - wFrom - wTo - wBags - wBhada);
  return { wName, wFrom, wTo, wBags, wBhada };
}

function vendorDetailsColWidths(cols: number): {
  wBill: number;
  wName: number;
  wBags: number;
  wTotal: number;
} {
  const wBill = cols <= 32 ? 7 : cols <= 48 ? 10 : 12;
  const wBags = cols <= 32 ? 4 : cols <= 48 ? 5 : 6;
  const wTotal = cols <= 32 ? 8 : cols <= 48 ? 11 : 14;
  const wName = Math.max(6, cols - wBill - wBags - wTotal);
  return { wBill, wName, wBags, wTotal };
}

/**
 * Columns only: Driver Name | From | To | No. of Bags | Total Bhada
 */
export function encodeDriverDetailsReportEscPos(
  drivers: DriverDetailsPrintRow[],
  dateISO: string,
  shopName: string,
  paperMm: number,
): string {
  const b = new EscPosBuilder(paperMm);
  const { wName, wFrom, wTo, wBags, wBhada } = driverSummaryColWidths(b.cols);
  const header = () =>
    clipPad("DRIVER", wName) +
    clipPad("FROM", wFrom, "right") +
    clipPad("TO", wTo, "right") +
    clipPad("BAGS", wBags, "right") +
    clipPad("BHADA", wBhada, "right");
  const dataRow = (name: string, from: string, to: string, bags: string, bhada: string) => {
    const nums =
      clipPad(from, wFrom, "right") +
      clipPad(to, wTo, "right") +
      clipPad(bags, wBags, "right") +
      clipPad(bhada, wBhada, "right");
    const nameAsc = thermalAscii(name).trim() || "-";
    if (nameAsc.length <= wName) {
      b.line(clipPad(nameAsc, wName) + nums);
      return;
    }
    const chunks = b.wrap(nameAsc);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] || "";
      if (i === chunks.length - 1 && chunk.length <= wName) {
        b.line(clipPad(chunk, wName) + nums);
      } else {
        b.line(chunk.slice(0, b.cols));
        if (i === chunks.length - 1) b.line(clipPad("", wName) + nums);
      }
    }
  };

  let totalBags = 0;
  let totalBhada = 0;
  for (const d of drivers) {
    totalBags += d.total_bags || 0;
    totalBhada += d.total_bhada || 0;
  }

  b.init()
    .align("center")
    .bold(true)
    .size("tall")
    .line(thermalAscii((shopName || "LEMON MANDI").toUpperCase()))
    .size("normal")
    .line("DRIVER DETAILS")
    .bold(false)
    .hr()
    .align("left")
    .kv("Date", dateISO)
    .hr()
    .bold(true)
    .line(header())
    .bold(false)
    .hr("-");

  if (!drivers.length) {
    b.line("(No drivers)");
  } else {
    for (const d of drivers) {
      dataRow(
        d.driver_name || "-",
        d.lot_from || "-",
        d.lot_to || "-",
        String(d.total_bags ?? 0),
        rupees(d.total_bhada || 0),
      );
    }
  }

  b.hr()
    .kv("TOTAL BAGS", String(totalBags))
    .kv("TOTAL BHADA", rupees(totalBhada))
    .feed(1)
    .cut();
  return b.toBase64();
}

/**
 * Columns only: Bill No. | Vendor Name | No. of Bags | Grand Total
 */
export function encodeVendorDetailsReportEscPos(
  bills: VendorDetailsPrintRow[],
  dateISO: string,
  shopName: string,
  paperMm: number,
): string {
  const b = new EscPosBuilder(paperMm);
  const { wBill, wName, wBags, wTotal } = vendorDetailsColWidths(b.cols);
  const header = () =>
    clipPad("BILL NO", wBill) +
    clipPad("VENDOR", wName) +
    clipPad("BAGS", wBags, "right") +
    clipPad("TOTAL", wTotal, "right");

  const emitRow = (bill: string, name: string, bags: string, total: string) => {
    const nums = clipPad(bags, wBags, "right") + clipPad(total, wTotal, "right");
    const billCell = clipPad(bill, wBill);
    const nameAsc = thermalAscii(name).trim() || "-";
    if (nameAsc.length <= wName) {
      b.line(billCell + clipPad(nameAsc, wName) + nums);
      return;
    }
    const first = nameAsc.slice(0, wName);
    const rest = nameAsc.slice(wName);
    if (!rest) {
      b.line(billCell + clipPad(first, wName) + nums);
      return;
    }
    b.line(billCell + clipPad(first, wName) + clipPad("", wBags + wTotal));
    const chunks = b.wrap(rest);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] || "";
      const last = i === chunks.length - 1;
      if (last && chunk.length <= wName) {
        b.line(clipPad("", wBill) + clipPad(chunk, wName) + nums);
      } else {
        b.line(clipPad("", wBill) + chunk.slice(0, b.cols - wBill));
        if (last) b.line(clipPad("", wBill) + clipPad("", wName) + nums);
      }
    }
  };

  let totalBags = 0;
  let billAmount = 0;
  for (const bill of bills) {
    totalBags += bill.total_bags || 0;
    billAmount += bill.grand_total || 0;
  }

  b.init()
    .align("center")
    .bold(true)
    .size("tall")
    .line(thermalAscii((shopName || "LEMON MANDI").toUpperCase()))
    .size("normal")
    .line("VENDOR DETAILS")
    .bold(false)
    .hr()
    .align("left")
    .kv("Date", dateISO)
    .hr()
    .bold(true)
    .line(header())
    .bold(false)
    .hr("-");

  if (!bills.length) {
    b.line("(No vendor bills)");
  } else {
    for (const bill of bills) {
      emitRow(
        bill.bill_code || "-",
        bill.vendor_name || "-",
        String(bill.total_bags ?? 0),
        rupees(bill.grand_total || 0),
      );
    }
  }

  b.hr()
    .kv("TOTAL BAGS", String(totalBags))
    .kv("GRAND TOTAL", rupees(billAmount))
    .feed(1)
    .cut();
  return b.toBase64();
}
