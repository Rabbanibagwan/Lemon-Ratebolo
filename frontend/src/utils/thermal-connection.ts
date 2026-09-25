/**
 * Connection layer: formatted document → Wi-Fi (HTML / expo-print) OR Bluetooth (ESC/POS).
 * Paper mm must match the document that was already generated — never re-layout here.
 */
import {
  bluetoothHardwareAvailable,
  bluetoothPrinterConnected,
  connectBluetoothPrinter,
  writeEscPos,
} from "@/src/utils/bluetooth-printer";
import { loadPrinterPrefs } from "@/src/utils/printer-prefs";
import { clampPaperMm, printThermalHtmlOnly } from "@/src/utils/thermal-print";

export async function printThermalDocument(opts: {
  html: string;
  escposBase64: string;
  paperMm: number;
  /** When true, always use the HTML thermal layout (previous Farmer Patti format + QR). */
  preferHtml?: boolean;
  /**
   * When true, print only via the connected Bluetooth ESC/POS path.
   * Never opens the OS/system print dialog (used by Driver Details PRINT).
   */
  requireBluetooth?: boolean;
}): Promise<void> {
  const prefs = await loadPrinterPrefs();
  const mm = clampPaperMm(opts.paperMm);

  if (opts.requireBluetooth) {
    if (prefs.connectionType !== "BLUETOOTH") {
      throw new Error("Select Bluetooth in Settings → Printer.");
    }
    if (!prefs.printerId) {
      throw new Error("Select a Bluetooth printer in Settings → Printer.");
    }
    if (!bluetoothHardwareAvailable()) {
      throw new Error(
        "Bluetooth printing is not available in this preview. Use the Android app after it is built.",
      );
    }
    const on = await bluetoothPrinterConnected();
    if (!on) {
      await connectBluetoothPrinter(prefs.printerId);
    }
    await writeEscPos(opts.escposBase64);
    return;
  }

  const useBt =
    !opts.preferHtml &&
    prefs.connectionType === "BLUETOOTH" &&
    bluetoothHardwareAvailable() &&
    !!prefs.printerId;

  if (useBt) {
    const on = await bluetoothPrinterConnected();
    if (!on) {
      await connectBluetoothPrinter(prefs.printerId);
    }
    await writeEscPos(opts.escposBase64);
    return;
  }

  if (prefs.connectionType === "BLUETOOTH" && !bluetoothHardwareAvailable()) {
    // Expo Go / preview: same HTML receipt as Wi-Fi (native SPP is not in this runtime).
  }

  await printThermalHtmlOnly(opts.html, mm);
}
