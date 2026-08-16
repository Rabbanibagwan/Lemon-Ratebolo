import { storage } from "@/src/utils/storage";
import { clampPaperMm } from "@/src/utils/thermal-print";

export type PrinterConnectionType = "WIFI" | "BLUETOOTH";

const K_TYPE = "lm.printer.connectionType";
const K_ID = "lm.printer.printerId";
const K_NAME = "lm.printer.printerName";
const K_WIDTH = "lm.printer.paperWidth";

export type PrinterPrefs = {
  connectionType: PrinterConnectionType;
  printerId: string;
  printerName: string;
  paperWidth: number;
};

export async function loadPrinterPrefs(): Promise<PrinterPrefs> {
  const raw = String((await storage.getItem(K_TYPE, "WIFI")) as string);
  const paper = Number(await storage.getItem(K_WIDTH, 80));
  return {
    connectionType: raw === "BLUETOOTH" ? "BLUETOOTH" : "WIFI",
    printerId: (await storage.getItem(K_ID, "")) || "",
    printerName: (await storage.getItem(K_NAME, "")) || "",
    paperWidth: clampPaperMm(paper, 80),
  };
}

export async function savePrinterPrefs(patch: Partial<PrinterPrefs>): Promise<PrinterPrefs> {
  const cur = await loadPrinterPrefs();
  const next: PrinterPrefs = {
    connectionType: patch.connectionType ?? cur.connectionType,
    printerId: patch.printerId !== undefined ? patch.printerId : cur.printerId,
    printerName: patch.printerName !== undefined ? patch.printerName : cur.printerName,
    paperWidth: clampPaperMm(patch.paperWidth ?? cur.paperWidth, 80),
  };
  await storage.setItem(K_TYPE, next.connectionType);
  await storage.setItem(K_ID, next.printerId);
  await storage.setItem(K_NAME, next.printerName);
  await storage.setItem(K_WIDTH, next.paperWidth);
  return next;
}

/** Paper mm for a print job. Caller/shop setting wins; printer prefs fill in when omitted. */
export async function resolvePrintPaperMm(settingsMm?: number): Promise<number> {
  if (settingsMm != null && Number.isFinite(Number(settingsMm))) {
    return clampPaperMm(settingsMm);
  }
  const prefs = await loadPrinterPrefs();
  return clampPaperMm(prefs.paperWidth, 80);
}
