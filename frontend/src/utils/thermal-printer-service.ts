/**
 * Shared thermal printer API. Formatting is independent of Wi-Fi vs Bluetooth.
 */
import { LedgerDetail, Patti, ShopProfile, VendorBill } from "@/src/api";
import {
  bluetoothPrinterConnected,
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
} from "@/src/utils/bluetooth-printer";
import { encodeCashBookEscPos, encodeCashBookHtml, encodeTestPrint, type CashBookDoc } from "@/src/utils/thermal-escpos-docs";
import { printThermalDocument } from "@/src/utils/thermal-connection";
import { thermalPrintLedger } from "@/src/utils/ledger-print";
import { thermalPrintPatti } from "@/src/utils/patti-print";
import { loadPrinterPrefs, resolvePrintPaperMm } from "@/src/utils/printer-prefs";
import { thermalPrintVendorBill } from "@/src/utils/vendor-bill-print";

export const ThermalPrinterService = {
  async connect(printerId?: string): Promise<void> {
    const prefs = await loadPrinterPrefs();
    const id = printerId || prefs.printerId;
    if (!id) throw new Error("Select a Bluetooth printer in Settings → Printer.");
    await connectBluetoothPrinter(id);
  },

  async disconnect(): Promise<void> {
    await disconnectBluetoothPrinter();
  },

  async isConnected(): Promise<boolean> {
    return bluetoothPrinterConnected();
  },

  async testPrint(): Promise<void> {
    const prefs = await loadPrinterPrefs();
    if (prefs.connectionType !== "BLUETOOTH") {
      throw new Error("Select Bluetooth in Settings → Printer to send a Bluetooth test print.");
    }
    if (!prefs.printerId) throw new Error("Select a Bluetooth printer in Settings → Printer.");
    const on = await bluetoothPrinterConnected();
    if (!on) await connectBluetoothPrinter(prefs.printerId);
    const { writeEscPos } = await import("@/src/utils/bluetooth-printer");
    await writeEscPos(encodeTestPrint(prefs.paperWidth, prefs.printerName));
  },

  printFarmerPatti(p: Patti, profile: ShopProfile, paperMm?: number) {
    return thermalPrintPatti(p, profile, paperMm);
  },

  printVendorBill(b: VendorBill, profile: ShopProfile, paperMm?: number) {
    return thermalPrintVendorBill(b, profile, paperMm);
  },

  printAccountLedger(d: LedgerDetail, paperMm?: number) {
    return thermalPrintLedger(d, paperMm);
  },

  async printCashBook(doc: CashBookDoc, paperMm?: number) {
    const mm = await resolvePrintPaperMm(paperMm);
    await printThermalDocument({
      html: encodeCashBookHtml(doc, mm),
      escposBase64: encodeCashBookEscPos(doc, mm),
      paperMm: mm,
    });
  },
};

export type { CashBookDoc };
