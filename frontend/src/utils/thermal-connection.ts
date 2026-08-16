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
}): Promise<void> {
  const prefs = await loadPrinterPrefs();
  const mm = clampPaperMm(opts.paperMm);
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
